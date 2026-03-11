import { Connection, Keypair, VersionedTransaction, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import axios from 'axios';
import { Pool } from 'pg';
import { TradeExecutor, BuyParams, SellParams, TradeResult } from './types';
import bs58 from 'bs58';

const JUPITER_API = process.env.JUPITER_API_URL || 'https://quote-api.jup.ag/v6';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

export class JupiterExecutor implements TradeExecutor {
    private connection: Connection;
    private pool: Pool;

    constructor(rpcUrl: string, pool: Pool) {
        this.connection = new Connection(rpcUrl, 'confirmed');
        this.pool = pool;
    }

    async buyToken(params: BuyParams): Promise<TradeResult> {
        try {
            const { privateKey, tokenAddress, amountIn, slippage = 5 } = params;
            const amountLamports = Math.floor(parseFloat(amountIn) * LAMPORTS_PER_SOL);
            const keypair = this.getKeypair(privateKey);

            // 0. Pre-flight balance check
            const balance = await this.connection.getBalance(keypair.publicKey);
            const priorityFee = 100000; // prioritizeFeeLamports from swapBody

            if (balance < (amountLamports + priorityFee + 5000)) { // 5000 as buffer for base fee
                throw new Error(`Insufficient SOL balance. Have: ${balance / LAMPORTS_PER_SOL} SOL, Need: ${(amountLamports + priorityFee + 5000) / LAMPORTS_PER_SOL} SOL`);
            }

            // 1. Get Quote
            const quote = await this.getQuote({
                inputMint: SOL_MINT,
                outputMint: tokenAddress,
                amount: amountLamports,
                slippageBps: Math.floor(slippage * 100),
                swapMode: 'ExactIn'
            });

            if (!quote) throw new Error('Failed to get quote from Jupiter');

            // 2. Get Swap Transaction
            const swapBody = {
                quoteResponse: quote,
                userPublicKey: keypair.publicKey.toString(),
                wrapAndUnwrapSol: true,
                priorityFee: {
                    prioritizationFeeLamports: 100000 // Dynamic fee strategy would be better
                }
            };

            const { swapTransaction } = await axios.post(`${JUPITER_API}/swap`, swapBody).then((res: any) => res.data);

            // 3. Deserialize and Sign
            const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
            const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
            transaction.sign([keypair]);

            // 4. Send and Confirm
            const rawTransaction = transaction.serialize();
            const txid = await this.connection.sendRawTransaction(rawTransaction, {
                skipPreflight: true,
                maxRetries: 2
            });

            const confirmation = await this.connection.confirmTransaction(txid, 'confirmed');

            if (confirmation.value.err) {
                throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
            }

            return {
                txHash: txid,
                amountIn,
                amountOut: (parseInt(quote.outAmount) / (10 ** 6)).toString(), // Assuming 6 decimals for most stats (simplified)
                success: true
            };

        } catch (error: any) {
            console.error('[Jupiter] Buy failed:', error);
            return {
                txHash: '',
                amountIn: params.amountIn,
                amountOut: '0',
                success: false,
                error: error.message
            };
        }
    }

    async sellToken(params: SellParams): Promise<TradeResult> {
        try {
            const { privateKey, tokenAddress, amountIn, slippage = 5 } = params;
            const keypair = this.getKeypair(privateKey);

            // 0. Pre-flight SOL balance check for fees
            const solBalance = await this.connection.getBalance(keypair.publicKey);
            const priorityFee = 100000;
            if (solBalance < (priorityFee + 5000)) {
                throw new Error(`Insufficient SOL for transaction fees. Need at least 0.000105 SOL`);
            }

            // Need to fetch decimals to convert amountIn
            const decimals = await this.getTokenDecimals(tokenAddress);
            const amountUnits = Math.floor(parseFloat(amountIn) * (10 ** decimals));

            // Token balance check
            const tokenBalanceStr = await this.getBalance(keypair.publicKey.toString(), tokenAddress);
            if (parseFloat(tokenBalanceStr) < parseFloat(amountIn)) {
                throw new Error(`Insufficient token balance to sell. Have: ${tokenBalanceStr}, Need: ${amountIn}`);
            }

            // 1. Get Quote
            const quote = await this.getQuote({
                inputMint: tokenAddress,
                outputMint: SOL_MINT,
                amount: amountUnits,
                slippageBps: Math.floor(slippage * 100),
                swapMode: 'ExactIn'
            });

            if (!quote) throw new Error('Failed to get quote from Jupiter');

            // 2. Get Swap Transaction
            const swapBody = {
                quoteResponse: quote,
                userPublicKey: keypair.publicKey.toString(),
                wrapAndUnwrapSol: true,
                priorityFee: {
                    prioritizationFeeLamports: priorityFee
                }
            };

            const { swapTransaction } = await axios.post(`${JUPITER_API}/swap`, swapBody).then((res: any) => res.data);

            // 3. Deserialize and Sign
            const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
            const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
            transaction.sign([keypair]);

            // 4. Send and Confirm
            const rawTransaction = transaction.serialize();
            const txid = await this.connection.sendRawTransaction(rawTransaction, {
                skipPreflight: true,
                maxRetries: 2
            });

            const confirmation = await this.connection.confirmTransaction(txid, 'confirmed');

            if (confirmation.value.err) {
                throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
            }

            return {
                txHash: txid,
                amountIn,
                amountOut: (parseInt(quote.outAmount) / LAMPORTS_PER_SOL).toString(),
                success: true
            };

        } catch (error: any) {
            console.error('[Jupiter] Sell failed:', error);
            return {
                txHash: '',
                amountIn: params.amountIn,
                amountOut: '0',
                success: false,
                error: error.message
            };
        }
    }

    async estimateBuyOutput(tokenAddress: string, amountIn: string): Promise<string> {
        try {
            const amountLamports = Math.floor(parseFloat(amountIn) * LAMPORTS_PER_SOL);
            const quote = await this.getQuote({
                inputMint: SOL_MINT,
                outputMint: tokenAddress,
                amount: amountLamports,
                slippageBps: 100,
                swapMode: 'ExactIn'
            });

            // We don't verify decimals here efficiently, so returning raw units might be misleading
            // But adhering to interface contract. Ideally needs decimals.
            // For estimation we can return the raw amount from quote if caller handles decimals,
            // or try to fetch decimals.
            return quote ? quote.outAmount : '0';
        } catch {
            return '0';
        }
    }

    async getBalance(walletAddress: string, tokenAddress?: string): Promise<string> {
        try {
            const pubkey = new PublicKey(walletAddress);

            if (!tokenAddress || tokenAddress === SOL_MINT) {
                const balance = await this.connection.getBalance(pubkey);
                return (balance / LAMPORTS_PER_SOL).toString();
            } else {
                const response = await this.connection.getParsedTokenAccountsByOwner(pubkey, {
                    mint: new PublicKey(tokenAddress)
                });

                let balance = 0;
                response.value.forEach((accountInfo) => {
                    balance += accountInfo.account.data.parsed.info.tokenAmount.uiAmount || 0;
                });
                return balance.toString();
            }
        } catch (error) {
            console.error('[Jupiter] Get balance failed', error);
            return '0';
        }
    }

    private getKeypair(privateKey: string): Keypair {
        try {
            // Try base58 first (common on Solana)
            return Keypair.fromSecretKey(bs58.decode(privateKey));
        } catch {
            try {
                // Try hex (if saved as hex in DB)
                return Keypair.fromSecretKey(Buffer.from(privateKey, 'hex'));
            } catch {
                // Try JSON array (e.g. [1,2,3...])
                return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(privateKey)));
            }
        }
    }

    private async getQuote(params: any) {
        try {
            const response = await axios.get(`${JUPITER_API}/quote`, { params });
            return response.data;
        } catch (error: any) {
            console.warn('[Jupiter] Quote failed:', error.response?.data || error.message);
            return null;
        }
    }

    private async getTokenDecimals(mint: string): Promise<number> {
        // Ideally cache this or use a token list
        try {
            const info = await this.connection.getParsedAccountInfo(new PublicKey(mint));
            const data = info.value?.data;
            if (data && 'parsed' in data) {
                return data.parsed.info.decimals;
            }
            return 9; // Default usually 9 or 6 on Solana
        } catch {
            return 9;
        }
    }
}
