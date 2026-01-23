// Extensão do TradeExecutor para suportar Real Trading
import { Pool } from 'pg';
import { PancakeSwapExecutor } from './blockchain/PancakeSwapExecutor';
import { WalletManager } from './blockchain/wallet-manager';
import { ethers } from 'ethers';

export class RealTradingService {
    private pool: Pool;
    private walletManager: WalletManager;
    private static cachedBNBPrice: number | null = null;

    constructor(pool: Pool) {
        this.pool = pool;
        this.walletManager = new WalletManager(pool);
    }

    /**
     * Busca o preço atual do BNB via CoinGecko ou fallback do env
     */
    private async getBNBPrice(): Promise<number> {
        try {
            const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd');
            const data: any = await response.json();
            if (data && data.binancecoin && typeof data.binancecoin.usd === 'number') {
                RealTradingService.cachedBNBPrice = data.binancecoin.usd;
                return data.binancecoin.usd;
            }
        } catch (e) {
            console.error('[RealTradingService] Failed to fetch BNB price from CoinGecko:', e);
        }

        // Usar cache se disponível, senão fallback do env ou valor fixo
        if (RealTradingService.cachedBNBPrice !== null) {
            console.log(`[RealTradingService] 🔄 Using cached BNB price: $${RealTradingService.cachedBNBPrice}`);
            return RealTradingService.cachedBNBPrice;
        }

        return Number(process.env.BNB_PRICE || 600);
    }

    /**
     * Verifica se usuário tem real trading habilitado
     */
    async isRealTradingEnabled(userId: string): Promise<boolean> {
        // 1. Bypass automático para o Administrador
        const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
        const userResult = await this.pool.query('SELECT email FROM users WHERE id = $1', [userId]);
        const userEmail = (userResult.rows[0]?.email || '').trim().toLowerCase();

        if (adminEmail && userEmail === adminEmail) {
            console.log(`[RealTradingService] 🛡️ Admin bypass: User ${userEmail} is allowed to trade in LIVE mode by default.`);
            return true;
        }

        // 2. Lógica normal para outros usuários via banco de dados
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

            // 4. Converter USD para BNB usando preço real
            const bnbPrice = await this.getBNBPrice();
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
        // Se for o admin, retornar o balanço residual da blockchain
        const residualBalance = await this.getAdminResidualBalance(userId);
        if (residualBalance !== null) {
            return residualBalance;
        }

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

    /**
     * Calcula o saldo residual para o administrador
     * Saldo Residual = Saldo Real (BNB) na Carteira - Soma dos Saldos Reais dos outros usuários
     */
    async getAdminResidualBalance(userId: string): Promise<number | null> {
        const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();

        if (!adminEmail) {
            console.warn('[RealTradingService] ⚠️ ADMIN_EMAIL not defined in .env! Admin identification will fail.');
        }

        // Buscar email do usuário para confirmar se é admin
        const userResult = await this.pool.query('SELECT email FROM users WHERE id = $1', [userId]);
        const userEmail = (userResult.rows[0]?.email || '').trim().toLowerCase();

        console.log(`[RealTradingService] 🔍 admin check: DB(${userEmail}) vs ENV(${adminEmail})`);

        if (userEmail !== adminEmail) {
            console.log(`[RealTradingService] ❌ User ${userEmail} is NOT admin. Skipping residual calculation.`);
            return null;
        }

        const botAddress = process.env.BOT_DEPOSIT_ADDRESS;
        const rpcUrl = process.env.BSC_RPC_URL;

        if (!botAddress || !rpcUrl) {
            console.error('[RealTradingService] [Balance] BOT_DEPOSIT_ADDRESS or BSC_RPC_URL not defined');
            return null;
        }

        try {
            // Fetch live BNB price
            const bnbPrice = await this.getBNBPrice();

            const provider = new ethers.JsonRpcProvider(rpcUrl);
            const bnbBalanceBigInt = await provider.getBalance(botAddress);
            const bnbBalance = Number(ethers.formatEther(bnbBalanceBigInt));
            const totalWalletValueUSD = bnbBalance * bnbPrice;

            // Somar saldo virtual de todos os OUTROS usuários (excluindo paper trading)
            const otherUsersResult = await this.pool.query(
                `SELECT 
                    COALESCE(SUM(CASE WHEN entry_type IN ('deposit', 'trade_profit') THEN amount_usd ELSE 0 END), 0) -
                    COALESCE(SUM(CASE WHEN entry_type IN ('withdrawal', 'trade_loss', 'fee', 'gas') THEN ABS(amount_usd) ELSE 0 END), 0) AS total_other_balances
                 FROM ledger_entries
                 WHERE user_id != $1
                   AND description NOT ILIKE '%paper%'`,
                [userId]
            );

            const otherUsersBalanceUSD = Number(otherUsersResult.rows[0]?.total_other_balances ?? 0);
            const residualBalance = Math.max(0, totalWalletValueUSD - otherUsersBalanceUSD);

            console.log(`[RealTradingService] [Balance] Admin Residual Balance: $${residualBalance.toFixed(2)} (Wallet: $${totalWalletValueUSD.toFixed(2)}, Others: $${otherUsersBalanceUSD.toFixed(2)})`);
            return residualBalance;
        } catch (error: any) {
            console.error('[RealTradingService] [Balance] Error calculating residual balance:', error.message);
            return null;
        }
    }
}
