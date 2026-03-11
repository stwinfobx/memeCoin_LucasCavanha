import '../env';
import { ethers } from 'ethers';
import axios from 'axios';
import {
    ChainProvider,
    SupportedChain,
    TokenInfo,
    MarketData,
    ValidationContext
} from './types';

const ERC20_ABI = [
    'function totalSupply() view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function name() view returns (string)',
    'function balanceOf(address) view returns (uint256)'
];

const GECKO_BASE_URL = process.env.GECKOTERMINAL_BASE_URL || 'https://api.geckoterminal.com/api/v2';

/**
 * Generic EVM Chain Provider
 * Works for BSC, Base, Ethereum, and any EVM-compatible chain
 */
export class EVMChainProvider implements ChainProvider {
    protected provider: ethers.JsonRpcProvider;
    public readonly chainId: SupportedChain;
    public readonly nativeToken: string;
    private readonly networkLabel: string;

    constructor(rpcUrl: string, chainId: SupportedChain, networkLabel: string, nativeToken: string) {
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        this.chainId = chainId;
        this.networkLabel = networkLabel;
        this.nativeToken = nativeToken;
    }

    isValidAddress(address: string): boolean {
        return ethers.isAddress(address);
    }

    normalizeAddress(address: string): string {
        return address.toLowerCase();
    }

    async getTokenInfo(address: string): Promise<TokenInfo> {
        try {
            const contract = new ethers.Contract(address, ERC20_ABI, this.provider);

            const [symbol, name, decimals, totalSupply] = await Promise.all([
                contract.symbol().catch(() => 'UNKNOWN'),
                contract.name().catch(() => 'Unknown Token'),
                contract.decimals().catch(() => 18),
                contract.totalSupply().catch(() => 0n)
            ]);

            return {
                address: this.normalizeAddress(address),
                symbol: String(symbol),
                name: String(name),
                decimals: Number(decimals),
                totalSupply: totalSupply.toString()
            };
        } catch (error: any) {
            throw new Error(`Failed to get token info for ${address}: ${error.message}`);
        }
    }

    async checkHoneypot(address: string): Promise<boolean> {
        try {
            // Simular uma transferência de 0.0001 token
            const contract = new ethers.Contract(address, ERC20_ABI, this.provider);
            const decimals = await contract.decimals().catch(() => 18);
            const amount = BigInt(10 ** (decimals - 4)); // 0.0001 tokens

            // Tentar estimar gas para transferência
            // Honeypots geralmente falham aqui ou retornam gas absurdo
            const testAddress = '0x000000000000000000000000000000000000dead';

            try {
                await contract.transfer.estimateGas(testAddress, amount);
                return false; // Conseguiu estimar = não é honeypot
            } catch {
                return true; // Falhou = provável honeypot
            }
        } catch {
            // Em caso de erro, assumir que pode ser honeypot
            return true;
        }
    }

    async checkLiquidityLocked(address: string): Promise<boolean> {
        // TODO: Implementar verificação de lock em contratos específicos
        // Por enquanto retornar false (não verificado)
        return false;
    }

    async getMarketData(address: string, context?: ValidationContext): Promise<MarketData> {
        try {
            // Se já temos dados do rawListing, usar eles
            if (context?.rawListing) {
                const listing = context.rawListing;
                return {
                    liquidity: listing.liquidityUsd || 0,
                    volume24h: listing.volume24hUsd || 0,
                    price: listing.priceUsd || 0,
                    holdersCount: 0, // Não disponível no GeckoTerminal
                    pairAddress: listing.pairAddress || context.pairAddress,
                    dexId: listing.dexId
                };
            }

            // Buscar do GeckoTerminal
            const url = `${GECKO_BASE_URL}/networks/${this.networkLabel}/tokens/${address}`;
            const response = await axios.get(url, {
                timeout: 10000,
                headers: { 'Accept': 'application/json', 'User-Agent': 'TradingBotValidator/1.0' }
            });
            const geckoData = response.data?.data?.attributes || {};

            const marketData: MarketData = {
                liquidity: Number(geckoData.fdv_usd || 0),
                volume24h: Number(geckoData.volume_usd?.h24 || 0),
                price: Number(geckoData.price_usd || 0),
                holdersCount: 0,
                pairAddress: context?.pairAddress
            };

            // Se Gecko retornou zerado, tenta DexScreener (mais rápido para lançamentos)
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
            // Se falhou Gecko, tenta DexScreener como último recurso
            try {
                const dsUrl = `https://api.dexscreener.com/latest/dex/tokens/${address}`;
                const dsResp = await axios.get(dsUrl, { timeout: 5000 });
                const pair = dsResp.data?.pairs?.[0];
                if (pair) {
                    return {
                        liquidity: Number(pair.liquidity?.usd || 0),
                        volume24h: Number(pair.volume?.h24 || 0),
                        price: Number(pair.priceUsd || 0),
                        holdersCount: 0,
                        pairAddress: pair.pairAddress || context?.pairAddress,
                        dexId: pair.dexId
                    };
                }
            } catch (dsErr) { }
            return { liquidity: 0, volume24h: 0, price: 0, holdersCount: 0 };
        }
    }

    async getNativeBalance(address: string): Promise<string> {
        try {
            const balance = await this.provider.getBalance(address);
            return ethers.formatEther(balance);
        } catch (error: any) {
            throw new Error(`Failed to get native balance: ${error.message}`);
        }
    }

    async getTokenBalance(walletAddress: string, tokenAddress: string): Promise<string> {
        try {
            const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
            const balance = await contract.balanceOf(walletAddress);
            const decimals = await contract.decimals();
            return ethers.formatUnits(balance, decimals);
        } catch (error: any) {
            throw new Error(`Failed to get token balance: ${error.message}`);
        }
    }
}

/**
 * Factory function to create EVM providers for different chains
 */
export function createEVMProvider(chain: SupportedChain): EVMChainProvider | null {
    switch (chain) {
        case SupportedChain.BSC:
            return new EVMChainProvider(
                process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org',
                SupportedChain.BSC,
                'bsc',
                'BNB'
            );

        case SupportedChain.BASE:
            return new EVMChainProvider(
                process.env.BASE_RPC_URL || 'https://mainnet.base.org',
                SupportedChain.BASE,
                'base',
                'ETH'
            );

        case SupportedChain.ETH:
            return new EVMChainProvider(
                process.env.ETH_RPC_URL || 'https://eth.llamarpc.com',
                SupportedChain.ETH,
                'eth',
                'ETH'
            );

        default:
            return null;
    }
}
