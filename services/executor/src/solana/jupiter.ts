import {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    clusterApiUrl,
    sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import crypto from 'crypto';

// Jupiter Aggregator para melhores preços de swap
const JUPITER_API = 'https://quote-api.jup.ag/v6';

export interface JupiterSwapConfig {
    rpcUrl: string;
    privateKey: string; // Encrypted
    slippageBps?: number; // Basis points (100 = 1%)
}

interface JupiterQuoteResponse {
    outAmount: string;
    error?: string;
}

interface JupiterSwapResponse {
    swapTransaction: string;
}

export interface SwapResult {
    success: boolean;
    signature?: string;
    amountOut?: string;
    error?: string;
}

export class JupiterExecutor {
    private connection: Connection;
    private wallet: Keypair;
    private config: JupiterSwapConfig;

    constructor(config: JupiterSwapConfig) {
        this.config = {
            slippageBps: 100, // 1% default
            ...config,
        };

        this.connection = new Connection(this.config.rpcUrl || clusterApiUrl('mainnet-beta'), 'confirmed');

        // Descriptografar private key
        const decryptedKey = this.decryptPrivateKey(this.config.privateKey);
        const secretKey = Uint8Array.from(Buffer.from(decryptedKey, 'hex'));
        this.wallet = Keypair.fromSecretKey(secretKey);
    }

    /**
     * Descriptografa a chave privada
     */
    private decryptPrivateKey(encryptedKey: string): string {
        const encryptionKey = process.env.ENCRYPTION_KEY;
        if (!encryptionKey) {
            throw new Error('ENCRYPTION_KEY not found');
        }

        try {
            const [ivHex, encryptedHex] = encryptedKey.split(':');
            const iv = Buffer.from(ivHex, 'hex');
            const encrypted = Buffer.from(encryptedHex, 'hex');

            const decipher = crypto.createDecipheriv(
                'aes-256-gcm',
                Buffer.from(encryptionKey, 'hex'),
                iv
            );

            let decrypted = decipher.update(encrypted);
            decrypted = Buffer.concat([decrypted, decipher.final()]);

            return decrypted.toString('utf8');
        } catch (error: any) {
            throw new Error('Failed to decrypt private key: ' + error.message);
        }
    }

    /**
     * Compra tokens com SOL usando Jupiter
     */
    async executeBuy(
        tokenMint: string,
        amountSol: number,
        slippageBps?: number
    ): Promise<SwapResult> {
        try {
            console.log(`[Jupiter] Executing BUY: ${amountSol} SOL for token ${tokenMint}`);

            const slippage = slippageBps || this.config.slippageBps || 100;

            // SOL mint address (wrapped SOL)
            const SOL_MINT = 'So11111111111111111111111111111111111111112';

            // Converter SOL para lamports (1 SOL = 1e9 lamports)
            const amountLamports = Math.floor(amountSol * 1e9);

            // 1. Obter quote do Jupiter
            const quoteResponse = await fetch(
                `${JUPITER_API}/quote?` +
                `inputMint=${SOL_MINT}&` +
                `outputMint=${tokenMint}&` +
                `amount=${amountLamports}&` +
                `slippageBps=${slippage}`
            );

            if (!quoteResponse.ok) {
                throw new Error('Failed to get Jupiter quote');
            }

            const quoteData = await quoteResponse.json() as JupiterQuoteResponse;

            if (!quoteData || quoteData.error) {
                throw new Error(`Jupiter quote error: ${quoteData.error || 'Unknown'}`);
            }

            console.log(`[Jupiter] Quote received: ${quoteData.outAmount} tokens`);

            // 2. Obter instruções de swap
            const swapResponse = await fetch(`${JUPITER_API}/swap`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    quoteResponse: quoteData,
                    userPublicKey: this.wallet.publicKey.toString(),
                    wrapAndUnwrapSol: true,
                }),
            });

            if (!swapResponse.ok) {
                throw new Error('Failed to get swap transaction');
            }

            const swapData = await swapResponse.json() as JupiterSwapResponse;

            // 3. Deserializar e assinar transação
            const swapTransactionBuf = Buffer.from(swapData.swapTransaction, 'base64');
            const transaction = Transaction.from(swapTransactionBuf);

            // 4. Enviar e confirmar
            const signature = await sendAndConfirmTransaction(
                this.connection,
                transaction,
                [this.wallet],
                { commitment: 'confirmed' }
            );

            console.log(`[Jupiter] ✅ Swap confirmed: ${signature}`);

            return {
                success: true,
                signature,
                amountOut: quoteData.outAmount,
            };
        } catch (error: any) {
            console.error('[Jupiter] BUY failed:', error.message);
            return {
                success: false,
                error: error.message || 'Unknown error during buy',
            };
        }
    }

    /**
     * Vende tokens por SOL usando Jupiter
     */
    async executeSell(
        tokenMint: string,
        amountTokens: string,
        slippageBps?: number
    ): Promise<SwapResult> {
        try {
            console.log(`[Jupiter] Executing SELL: ${amountTokens} tokens for SOL`);

            const slippage = slippageBps || this.config.slippageBps || 100;
            const SOL_MINT = 'So11111111111111111111111111111111111111112';

            // 1. Obter quote
            const quoteResponse = await fetch(
                `${JUPITER_API}/quote?` +
                `inputMint=${tokenMint}&` +
                `outputMint=${SOL_MINT}&` +
                `amount=${amountTokens}&` +
                `slippageBps=${slippage}`
            );

            if (!quoteResponse.ok) {
                throw new Error('Failed to get Jupiter quote');
            }

            const quoteData = await quoteResponse.json() as JupiterQuoteResponse;

            if (!quoteData || quoteData.error) {
                throw new Error(`Jupiter quote error: ${quoteData.error || 'Unknown'}`);
            }

            const solAmount = parseInt(quoteData.outAmount) / 1e9;
            console.log(`[Jupiter] Quote received: ${solAmount.toFixed(6)} SOL`);

            // 2. Obter instruções de swap
            const swapResponse = await fetch(`${JUPITER_API}/swap`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    quoteResponse: quoteData,
                    userPublicKey: this.wallet.publicKey.toString(),
                    wrapAndUnwrapSol: true,
                }),
            });

            if (!swapResponse.ok) {
                throw new Error('Failed to get swap transaction');
            }

            const swapData = await swapResponse.json() as JupiterSwapResponse;

            // 3. Deserializar e assinar
            const swapTransactionBuf = Buffer.from(swapData.swapTransaction, 'base64');
            const transaction = Transaction.from(swapTransactionBuf);

            // 4. Enviar e confirmar
            const signature = await sendAndConfirmTransaction(
                this.connection,
                transaction,
                [this.wallet],
                { commitment: 'confirmed' }
            );

            console.log(`[Jupiter] ✅ Swap confirmed: ${signature}`);

            return {
                success: true,
                signature,
                amountOut: quoteData.outAmount,
            };
        } catch (error: any) {
            console.error('[Jupiter] SELL failed:', error.message);
            return {
                success: false,
                error: error.message || 'Unknown error during sell',
            };
        }
    }

    /**
     * Retorna o endereço da wallet
     */
    getWalletAddress(): string {
        return this.wallet.publicKey.toString();
    }

    /**
     * Retorna o saldo de SOL
     */
    async getBalance(): Promise<number> {
        const balance = await this.connection.getBalance(this.wallet.publicKey);
        return balance / 1e9; // Converter lamports para SOL
    }

    /**
     * Retorna o saldo de um token específico
     */
    async getTokenBalance(tokenMint: string): Promise<number> {
        try {
            const mintPubkey = new PublicKey(tokenMint);
            const tokenAccount = await getAssociatedTokenAddress(
                mintPubkey,
                this.wallet.publicKey
            );

            const balance = await this.connection.getTokenAccountBalance(tokenAccount);
            return parseFloat(balance.value.uiAmount?.toString() || '0');
        } catch {
            return 0;
        }
    }
}
