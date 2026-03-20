import '../env';
import { Connection, PublicKey, ParsedAccountData } from '@solana/web3.js';
import { getMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import axios from 'axios';
import {
    ChainProvider,
    SupportedChain,
    TokenInfo,
    MarketData,
    ValidationContext
} from './types';
import { heliusClient } from '../providers/helius';

const GECKO_BASE_URL = process.env.GECKOTERMINAL_BASE_URL || 'https://api.geckoterminal.com/api/v2';
const SOLANA_COMMITMENT = (process.env.SOLANA_COMMITMENT || 'confirmed') as any;

/**
 * Solana Chain Provider
 * Implements ChainProvider interface for Solana blockchain
 */
export class SolanaChainProvider implements ChainProvider {
    private connection: Connection;
    public readonly chainId = SupportedChain.SOLANA;
    public readonly nativeToken = 'SOL';

    constructor(rpcUrl: string) {
        this.connection = new Connection(rpcUrl, SOLANA_COMMITMENT);
    }

    isValidAddress(address: string): boolean {
        try {
            new PublicKey(address);
            return true;
        } catch {
            return false;
        }
    }

    normalizeAddress(address: string): string {
        return address;
    }

    async getTokenInfo(address: string): Promise<TokenInfo> {
        try {
            const mintPubkey = new PublicKey(address);

            let decimals = 6;
            let supply = '0';
            let symbol = 'UNKNOWN';
            let name = 'Unknown Token';

            try {
                const mintInfo = await getMint(this.connection, mintPubkey);
                decimals = mintInfo.decimals;
                supply = mintInfo.supply.toString();
            } catch (mintErr: any) {
                console.warn(`[Solana] getMint failed for ${address}, returning fallback metadata (Pump Fun protection): ${mintErr.message}`);
                decimals = 6;
                supply = '1000000000000000';
            }

            // Try Helius DAS first for metadata (more reliable for Pump.fun tokens)
            const heliusMeta = await heliusClient.getTokenMetadata(address);
            if (heliusMeta && heliusMeta.symbol !== 'UNKNOWN') {
                symbol = heliusMeta.symbol;
                name = heliusMeta.name;
            } else {
                // Fallback to on-chain Metaplex metadata
                try {
                    const metadata = await this.getTokenMetadata(mintPubkey);
                    if (metadata) {
                        symbol = metadata.symbol || symbol;
                        name = metadata.name || name;
                    }
                } catch {
                }
            }

            return {
                address,
                symbol,
                name,
                decimals: decimals,
                totalSupply: supply
            };
        } catch (error: any) {
            throw new Error(`Failed to get Solana token info: ${error.message}`);
        }
    }

    private async getTokenMetadata(mint: PublicKey): Promise<{ name: string; symbol: string } | null> {
        try {
            const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
            const [metadataPDA] = PublicKey.findProgramAddressSync(
                [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
                METADATA_PROGRAM_ID
            );

            const accountInfo = await this.connection.getAccountInfo(metadataPDA);
            if (!accountInfo) return null;

            const data = accountInfo.data;
            let offset = 1 + 32 + 32;

            const nameLength = data.readUInt32LE(offset);
            offset += 4;
            const name = data.slice(offset, offset + nameLength).toString('utf8').replace(/\0/g, '').trim();
            offset += nameLength;

            const symbolLength = data.readUInt32LE(offset);
            offset += 4;
            const symbol = data.slice(offset, offset + symbolLength).toString('utf8').replace(/\0/g, '').trim();

            return { name, symbol };
        } catch {
            return null;
        }
    }

    /**
     * Enhanced honeypot detection:
     * 1. Check freeze authority (can freeze token accounts)
     * 2. Check mint authority via Helius (can inflate supply)
     */
    async checkHoneypot(address: string): Promise<boolean> {
        try {
            // Check 1: Freeze authority via on-chain
            const mintPubkey = new PublicKey(address);
            try {
                const mintInfo = await getMint(this.connection, mintPubkey);
                if (mintInfo.freezeAuthority !== null) {
                    console.log(`[Solana] ⚠️ Freeze authority active for ${address}`);
                    return true;
                }
            } catch {
                // getMint failed — could be a Pump.fun token, not necessarily honeypot
            }

            // Check 2: Mint authority via Helius (can the dev print more tokens?)
            const mintAuth = await heliusClient.getMintAuthority(address);
            if (mintAuth && !mintAuth.isMintRenounced) {
                console.log(`[Solana] ⚠️ Mint authority NOT renounced for ${address} (owner: ${mintAuth.mintAuthority})`);
                // Mint authority active is a strong red flag but not always honeypot
                // For Pump.fun tokens during bonding curve, mint authority is the program
                const isPumpFun = address.endsWith('pump');
                if (!isPumpFun) {
                    return true;  // Non-pump token with active mint = honeypot
                }
                // Pump.fun: mint authority is expected during bonding curve phase
            }

            return false;
        } catch (error: any) {
            return false;
        }
    }

    async checkLiquidityLocked(address: string): Promise<boolean> {
        return false;
    }

    async getMarketData(address: string, context?: ValidationContext): Promise<MarketData> {
        let holdersCount = 0;
        try {
            // Attempt to get holders from Helius (fast fallback)
            holdersCount = await heliusClient.getHoldersCount(address);
        } catch {}

        try {
            if (context?.rawListing) {
                const listing = context.rawListing;
                return {
                    liquidity: listing.liquidityUsd || 0,
                    volume24h: listing.volume24hUsd || 0,
                    price: listing.priceUsd || 0,
                    holdersCount: holdersCount || 0,
                    pairAddress: listing.pairAddress || context.pairAddress,
                    dexId: listing.dexId
                };
            }

            const url = `${GECKO_BASE_URL}/networks/solana/tokens/${address}`;
            const response = await axios.get(url, {
                timeout: 5000,
                headers: { 'Accept': 'application/json', 'User-Agent': 'TradingBotValidator/1.0' }
            });
            const geckoData = response.data?.data?.attributes || {};

            const marketData: MarketData = {
                liquidity: Number(geckoData.fdv_usd || 0),
                volume24h: Number(geckoData.volume_usd?.h24 || 0),
                price: Number(geckoData.price_usd || 0),
                holdersCount: holdersCount || 0,
                pairAddress: context?.pairAddress
            };

            if (marketData.price === 0 || marketData.liquidity === 0) {
                const dsUrl = `https://api.dexscreener.com/latest/dex/tokens/${address}`;
                const dsResp = await axios.get(dsUrl, { timeout: 5000 });
                const pair = dsResp.data?.pairs?.[0];
                if (pair) {
                    marketData.liquidity = Number(pair.liquidity?.usd || marketData.liquidity);
                    marketData.volume24h = Number(pair.volume?.h24 || marketData.volume24h);
                    marketData.price = Number(pair.priceUsd || marketData.price);
                    marketData.pairAddress = pair.pairAddress || marketData.pairAddress;
                    marketData.dexId = pair.dexId;
                }
            }
            return marketData;
        } catch (error: any) {
            try {
                const dsUrl = `https://api.dexscreener.com/latest/dex/tokens/${address}`;
                const dsResp = await axios.get(dsUrl, { timeout: 5000 });
                const pair = dsResp.data?.pairs?.[0];
                if (pair) {
                    return {
                        liquidity: Number(pair.liquidity?.usd || 0),
                        volume24h: Number(pair.volume?.h24 || 0),
                        price: Number(pair.priceUsd || 0),
                        holdersCount: holdersCount || 0,
                        pairAddress: pair.pairAddress || context?.pairAddress,
                        dexId: pair.dexId
                    };
                }
            } catch (dsErr) { }
            return { liquidity: 0, volume24h: 0, price: 0, holdersCount: holdersCount || 0 };
        }
    }

    async getNativeBalance(address: string): Promise<string> {
        try {
            const pubkey = new PublicKey(address);
            const balance = await this.connection.getBalance(pubkey);
            return (balance / 1e9).toFixed(9);
        } catch (error: any) {
            throw new Error(`Failed to get SOL balance: ${error.message}`);
        }
    }

    async getTokenBalance(walletAddress: string, tokenAddress: string): Promise<string> {
        try {
            const walletPubkey = new PublicKey(walletAddress);
            const mintPubkey = new PublicKey(tokenAddress);
            const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
                walletPubkey,
                { mint: mintPubkey }
            );

            if (tokenAccounts.value.length === 0) {
                return '0';
            }

            let totalBalance = 0n;
            for (const accountInfo of tokenAccounts.value) {
                const parsedData = accountInfo.account.data as ParsedAccountData;
                const balance = BigInt(parsedData.parsed.info.tokenAmount.amount);
                totalBalance += balance;
            }

            const mintInfo = await getMint(this.connection, mintPubkey);
            const decimals = mintInfo.decimals;
            return (Number(totalBalance) / (10 ** decimals)).toFixed(decimals);
        } catch (error: any) {
            throw new Error(`Failed to get token balance: ${error.message}`);
        }
    }
}
