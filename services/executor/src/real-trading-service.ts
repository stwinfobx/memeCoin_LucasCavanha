// Extensão do TradeExecutor para suportar Real Trading
import { Pool } from 'pg';
import { PancakeSwapExecutor } from './blockchain/PancakeSwapExecutor';
import { WalletManager } from './blockchain/wallet-manager';

export class RealTradingService {
    private pool: Pool;
    private walletManager: WalletManager;

    constructor(pool: Pool) {
        this.pool = pool;
        this.walletManager = new WalletManager(pool);
    }

    /**
     * Verifica se usuário tem real trading habilitado
     */
    async isRealTradingEnabled(userId: string): Promise<boolean> {
        const result = await this.pool.query(
            'SELECT real_trading_enabled FROM user_profiles WHERE user_id = $1',
            [userId]
        );
        return result.rows[0]?.real_trading_enabled ?? false;
    }

    /**
     * Executa compra REAL usando PancakeSwap
     */
    async executeRealBuy(
        userId: string,
        tokenAddress: string,
        tokenSymbol: string,
        amountUSD: number
    ): Promise<{ success: boolean; txHash?: string; error?: string }> {
        try {
            console.log(`[RealTrading] 🔥 Executing REAL BUY for user ${userId}`);

            // 1. Buscar wallet gerenciada do usuário
            const wallet = await this.walletManager.getWallet(userId, 'BSC');
            if (!wallet) {
                throw new Error('User does not have a BSC wallet. Create one via /api/wallet/create');
            }

            // 2. Descriptografar private key
            const privateKey = await this.walletManager.decryptPrivateKey(wallet.encrypted_private_key);

            // 3. Inicializar PancakeSwap Executor
            const rpcUrl = process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org';
            const pancake = new PancakeSwapExecutor(rpcUrl, this.pool);

            // 4. Converter USD para BNB
            // TODO: Buscar preço real via API (CoinGecko, etc)
            const bnbPrice = Number(process.env.BNB_PRICE) || 600;
            const amountBNB = (amountUSD / bnbPrice).toFixed(6);

            console.log(`[RealTrading] 💱 Converting: $${amountUSD} = ${amountBNB} BNB @ $${bnbPrice}/BNB`);

            // 5. Executar swap BNB → Token
            const swapResult = await pancake.buyTokenWithBNB(
                privateKey,
                tokenAddress,
                amountBNB,
                1 // 1% slippage
            );

            console.log(`[RealTrading] ✅ REAL BUY executed! TX: ${swapResult.txHash}`);
            console.log(`[RealTrading] 💰 Received ${swapResult.amountOut} tokens`);

            return {
                success: true,
                txHash: swapResult.txHash,
            };
        } catch (error: any) {
            console.error(`[RealTrading] ❌ Real BUY failed:`, error.message);
            return {
                success: false,
                error: error.message,
            };
        }
    }

    /**
     * Executa venda REAL usando PancakeSwap
     */
    async executeRealSell(
        userId: string,
        tokenAddress: string,
        tokenSymbol: string,
        amountTokens: string
    ): Promise<{ success: boolean; txHash?: string; error?: string }> {
        try {
            console.log(`[RealTrading] 🔥 Executing REAL SELL for user ${userId}`);

            // 1. Buscar wallet
            const wallet = await this.walletManager.getWallet(userId, 'BSC');
            if (!wallet) {
                throw new Error('User does not have a BSC wallet');
            }

            // 2. Descriptografar private key
            const privateKey = await this.walletManager.decryptPrivateKey(wallet.encrypted_private_key);

            // 3. Inicializar PancakeSwap
            const rpcUrl = process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org';
            const pancake = new PancakeSwapExecutor(rpcUrl, this.pool);

            // 4. Executar swap Token → BNB
            const swapResult = await pancake.sellTokenForBNB(
                privateKey,
                tokenAddress,
                amountTokens,
                1 // 1% slippage
            );

            console.log(`[RealTrading] ✅ REAL SELL executed! TX: ${swapResult.txHash}`);
            console.log(`[RealTrading] 💰 Received ${swapResult.amountOut} BNB`);

            return {
                success: true,
                txHash: swapResult.txHash,
            };
        } catch (error: any) {
            console.error(`[RealTrading] ❌ Real SELL failed:`, error.message);
            return {
                success: false,
                error: error.message,
            };
        }
    }

    /**
     * Calcula saldo real disponível (depósitos confirmados - posições abertas)
     */
    async getRealBalance(userId: string): Promise<number> {
        const result = await this.pool.query(
            `SELECT 
         COALESCE(SUM(CASE WHEN entry_type IN ('deposit', 'trade_profit') THEN amount_usd ELSE 0 END), 0) AS credits,
         COALESCE(SUM(CASE WHEN entry_type IN ('withdrawal', 'trade_loss', 'fee', 'gas') THEN ABS(amount_usd) ELSE 0 END), 0) AS debits
       FROM ledger_entries
       WHERE user_id = $1
         AND description NOT LIKE 'Initial paper trading%'`,
            [userId]
        );

        const credits = Number(result.rows[0]?.credits ?? 0);
        const debits = Number(result.rows[0]?.debits ?? 0);
        return Math.max(0, credits - debits);
    }
}
