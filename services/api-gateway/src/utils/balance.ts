
import { Pool } from 'pg';
import { ethers } from 'ethers';

const getAdminEmail = () => {
    const email = process.env.ADMIN_EMAIL;
    if (!email) {
        console.warn('[BalanceUtil] ⚠️ ADMIN_EMAIL not defined in .env! Admin identification will fail.');
    }
    return email || '';
};

// Cache global para o preço do BNB para evitar fallbacks fixos
let cachedBNBPrice: number | null = null;

export interface AdminBalanceData {
    total_balance_usd: number;
    other_users_total_usd: number;
    wallet_real_bnb: number;
    wallet_real_usd: number;
}

/**
 * Calcula o saldo residual para o administrador
 * Saldo Residual = Saldo Real (BNB) na Carteira - Soma dos Saldos Reais dos outros usuários
 */
export async function getAdminBalance(pool: Pool, userId: string, userEmail: string): Promise<AdminBalanceData | null> {
    const adminEmail = getAdminEmail().trim().toLowerCase();
    const currentEmail = userEmail.trim().toLowerCase();

    console.log(`[BalanceUtil] 🔍 Identification: JWT(${currentEmail}) vs ENV(${adminEmail})`);

    // 1. Verificar se é o administrador
    if (currentEmail !== adminEmail) {
        console.log(`[BalanceUtil] ❌ User ${currentEmail} is NOT admin.`);
        return null;
    }

    const botAddress = process.env.BOT_DEPOSIT_ADDRESS;
    const rpcUrl = process.env.BSC_RPC_URL;

    if (!botAddress || !rpcUrl) {
        console.error('[BalanceUtil] FALHA: BOT_DEPOSIT_ADDRESS ou BSC_RPC_URL não definidos no .env');
        return null;
    }

    try {
        // Fetch live BNB price
        const bnbPrice = await (async () => {
            try {
                const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd');
                const data: any = await response.json();
                if (data && data.binancecoin && typeof data.binancecoin.usd === 'number') {
                    cachedBNBPrice = data.binancecoin.usd;
                    return data.binancecoin.usd;
                }
            } catch (e) {
                console.error('[BalanceUtil] Failed to fetch BNB price from CoinGecko:', e);
            }

            // Usar cache se disponível, senão fallback do env ou valor fixo (último caso)
            if (cachedBNBPrice !== null) {
                console.log(`[BalanceUtil] 🔄 Using cached BNB price: $${cachedBNBPrice}`);
                return cachedBNBPrice;
            }

            return Number(process.env.BNB_PRICE || 600);
        })();

        console.log(`[BalanceUtil] Current BNB price USD: $${bnbPrice}`);

        // 2. Buscar saldo real na blockchain
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const bnbBalanceBigInt = await provider.getBalance(botAddress);
        const bnbBalance = Number(ethers.formatEther(bnbBalanceBigInt));
        const totalWalletValueUSD = bnbBalance * bnbPrice;

        // 3. Somar saldo virtual de todos os OUTROS usuários (excluindo paper trading)
        const otherUsersResult = await pool.query(
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

        console.log(`[BalanceUtil] Admin balance: $${residualBalance.toFixed(2)} (Wallet: $${totalWalletValueUSD.toFixed(2)}, Others: $${otherUsersBalanceUSD.toFixed(2)})`);

        return {
            total_balance_usd: residualBalance,
            other_users_total_usd: otherUsersBalanceUSD,
            wallet_real_bnb: bnbBalance,
            wallet_real_usd: totalWalletValueUSD
        };
    } catch (error: any) {
        console.error('[BalanceUtil] Error calculating admin balance:', error.message);
        return null;
    }
}
