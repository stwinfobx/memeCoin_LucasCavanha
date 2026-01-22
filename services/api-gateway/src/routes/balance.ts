import { Router, Response } from 'express';
import { Pool } from 'pg';
import { authenticate, AuthRequest } from '../middleware/auth';
import { ethers } from 'ethers';

// E-mail do administrador para o cálculo residual de saldo
const getAdminEmail = () => process.env.ADMIN_EMAIL || 'mulack.zuguenberg@gmail.com';

/**
 * Calcula o saldo residual para o administrador
 * Saldo Residual = Saldo Real (BNB) na Carteira - Soma dos Saldos Reais dos outros usuários
 */
async function getAdminBalance(pool: Pool, userId: string, userEmail: string) {
    const adminEmail = getAdminEmail();
    console.log(`[Balance] Checking admin status for: ${userEmail} (Admin is: ${adminEmail})`);

    // 1. Verificar se é o administrador
    if (userEmail.toLowerCase() !== adminEmail.toLowerCase()) {
        console.log(`[Balance] User ${userEmail} is NOT admin. Skipping residual calculation.`);
        return null;
    }

    const botAddress = process.env.BOT_DEPOSIT_ADDRESS;
    console.log(`[Balance] Admin detected! Starting residual calculation for ${botAddress}...`);

    try {
        const rpcUrl = process.env.BSC_RPC_URL;
        const bnbPrice = Number(process.env.BNB_PRICE || 600);

        if (!botAddress || !rpcUrl) {
            console.error('[Balance] FALHA: BOT_DEPOSIT_ADDRESS ou BSC_RPC_URL não definidos no .env');
            console.log('[Balance] Env check:', { botAddress: !!botAddress, rpcUrl: !!rpcUrl });
            return null;
        }

        // 2. Buscar saldo real na blockchain (BNB)
        console.log(`[Balance] Fetching on-chain balance for ${botAddress} via ${rpcUrl}`);
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const bnbBalanceBigInt = await provider.getBalance(botAddress);
        const bnbBalance = Number(ethers.formatEther(bnbBalanceBigInt));
        const totalWalletValueUSD = bnbBalance * bnbPrice;
        console.log(`[Balance] On-chain result: ${bnbBalance} BNB (~$${totalWalletValueUSD.toFixed(2)})`);

        // 3. Somar saldo virtual de todos os OUTROS usuários
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
        console.log(`[Balance] Other users total virtual balance: $${otherUsersBalanceUSD.toFixed(2)}`);

        // 4. Saldo residual (tudo que está na carteira e não pertence aos outros)
        const residualBalance = Math.max(0, totalWalletValueUSD - otherUsersBalanceUSD);
        console.log(`[Balance] FINAL Residual Balance for Admin: $${residualBalance.toFixed(2)}`);

        return {
            total_balance_usd: residualBalance,
            other_users_total_usd: otherUsersBalanceUSD,
            wallet_real_bnb: bnbBalance,
            wallet_real_usd: totalWalletValueUSD
        };
    } catch (error: any) {
        console.error('[Balance] ERRO CRÍTICO no cálculo de saldo admin:', error.message);
        return null;
    }
}

export function initBalanceRoutes(pool: Pool): Router {
    const router = Router();

    // GET /api/balance/real - Saldo real em USD (não inclui paper trading)
    router.get('/real', authenticate, async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId;
            const userEmail = req.user?.email || '';

            // Verificar se é Admin e calcular residual
            const adminData = await getAdminBalance(pool, userId!, userEmail);

            let balance: number;
            let credits: number = 0;
            let debits: number = 0;

            if (adminData) {
                balance = adminData.total_balance_usd;
                // Para o admin, o "credits" é o saldo residual e debits é 0 para simplificar no dash
                credits = balance;
                debits = 0;
            } else {
                // Lógica normal para usuários comuns
                const result = await pool.query(
                    `SELECT 
               COALESCE(SUM(CASE WHEN entry_type IN ('deposit', 'trade_profit') THEN amount_usd ELSE 0 END), 0) AS credits,
               COALESCE(SUM(CASE WHEN entry_type IN ('withdrawal', 'trade_loss', 'fee', 'gas') THEN ABS(amount_usd) ELSE 0 END), 0) AS debits
             FROM ledger_entries
             WHERE user_id = $1
               AND description NOT ILIKE '%paper%'`,
                    [userId]
                );

                credits = Number(result.rows[0]?.credits ?? 0);
                debits = Number(result.rows[0]?.debits ?? 0);
                balance = Math.max(0, credits - debits);
            }

            // Buscar total investido em posições abertas
            const positionsResult = await pool.query(
                `SELECT COALESCE(SUM(invested_amount_usd), 0) as total_invested
         FROM positions
         WHERE user_id = $1 AND status = 'open'`,
                [userId]
            );

            const totalInvested = Number(positionsResult.rows[0]?.total_invested ?? 0);
            const availableBalance = Math.max(0, balance - totalInvested);

            res.json({
                success: true,
                data: {
                    total_balance_usd: balance,
                    available_balance_usd: availableBalance,
                    invested_in_positions_usd: totalInvested,
                    credits_usd: credits,
                    debits_usd: debits,
                    is_admin_residual: !!adminData
                },
                timestamp: new Date(),
            });
        } catch (error: any) {
            console.error('[Balance] Real balance error:', error);
            res.status(500).json({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: error.message },
                timestamp: new Date(),
            });
        }
    });

    // GET /api/balance/paper - Saldo de paper trading (simulação)
    router.get('/paper', authenticate, async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId;

            // Calcular saldo de paper trading
            const result = await pool.query(
                `SELECT 
           COALESCE(SUM(CASE WHEN entry_type IN ('deposit', 'trade_profit') THEN amount_usd ELSE 0 END), 0) AS credits,
           COALESCE(SUM(CASE WHEN entry_type IN ('withdrawal', 'trade_loss', 'fee', 'gas') THEN ABS(amount_usd) ELSE 0 END), 0) AS debits
         FROM ledger_entries
         WHERE user_id = $1`,
                [userId]
            );

            const credits = Number(result.rows[0]?.credits ?? 0);
            const debits = Number(result.rows[0]?.debits ?? 0);
            const balance = Math.max(0, credits - debits);

            res.json({
                success: true,
                data: {
                    balance_usd: balance,
                    credits_usd: credits,
                    debits_usd: debits,
                    note: 'This includes both paper trading and real deposits. Use /api/balance/real for real balance only.',
                },
                timestamp: new Date(),
            });
        } catch (error: any) {
            console.error('[Balance] Paper balance error:', error);
            res.status(500).json({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: error.message },
                timestamp: new Date(),
            });
        }
    });

    // GET /api/balance/summary - Resumo completo do saldo
    router.get('/summary', authenticate, async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId;
            const userEmail = req.user?.email || '';

            // Verificar se é Admin e calcular residual
            const adminData = await getAdminBalance(pool, userId!, userEmail);

            let realBalanceUSD: number;

            if (adminData) {
                realBalanceUSD = adminData.total_balance_usd;
            } else {
                const realBalance = await pool.query(
                    `SELECT 
               COALESCE(SUM(CASE WHEN entry_type IN ('deposit', 'trade_profit') THEN amount_usd ELSE 0 END), 0) AS credits,
               COALESCE(SUM(CASE WHEN entry_type IN ('withdrawal', 'trade_loss', 'fee', 'gas') THEN ABS(amount_usd) ELSE 0 END), 0) AS debits
             FROM ledger_entries
             WHERE user_id = $1
               AND description NOT ILIKE '%paper%'`,
                    [userId]
                );

                const realCredits = Number(realBalance.rows[0]?.credits ?? 0);
                const realDebits = Number(realBalance.rows[0]?.debits ?? 0);
                realBalanceUSD = Math.max(0, realCredits - realDebits);
            }

            // 2. Total de depósitos confirmados
            const deposits = await pool.query(
                `SELECT 
          COUNT(*) as count,
          COALESCE(SUM(amount_usd), 0) as total_usd
         FROM deposits
         WHERE user_id = $1 AND status = 'confirmed'`,
                [userId]
            );

            // 3. Posições abertas
            const positions = await pool.query(
                `SELECT 
          COUNT(*) as count,
          COALESCE(SUM(invested_amount_usd), 0) as invested_usd
         FROM positions
         WHERE user_id = $1 AND status = 'open'`,
                [userId]
            );

            res.json({
                success: true,
                data: {
                    real_balance: {
                        total_usd: realBalanceUSD,
                        available_usd: Math.max(0, realBalanceUSD - Number(positions.rows[0].invested_usd)),
                        locked_in_positions_usd: Number(positions.rows[0].invested_usd),
                        is_admin_residual: !!adminData
                    },
                    deposits: {
                        count: Number(deposits.rows[0].count),
                        total_usd: Number(deposits.rows[0].total_usd),
                    },
                    positions: {
                        open_count: Number(positions.rows[0].count),
                        invested_usd: Number(positions.rows[0].invested_usd),
                    },
                },
                timestamp: new Date(),
            });
        } catch (error: any) {
            console.error('[Balance] Summary error:', error);
            res.status(500).json({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: error.message },
                timestamp: new Date(),
            });
        }
    });

    // GET /api/balance - Alias para /api/balance/real (usado pelo frontend)
    router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId;
            const userEmail = req.user?.email || '';

            // Verificar se é Admin e calcular residual
            const adminData = await getAdminBalance(pool, userId!, userEmail);

            let balance: number;
            let credits: number = 0;
            let debits: number = 0;

            if (adminData) {
                balance = adminData.total_balance_usd;
                credits = balance;
                debits = 0;
            } else {
                const result = await pool.query(
                    `SELECT 
               COALESCE(SUM(CASE WHEN entry_type IN ('deposit', 'trade_profit') THEN amount_usd ELSE 0 END), 0) AS credits,
               COALESCE(SUM(CASE WHEN entry_type IN ('withdrawal', 'trade_loss', 'fee', 'gas') THEN ABS(amount_usd) ELSE 0 END), 0) AS debits
             FROM ledger_entries
             WHERE user_id = $1
               AND description NOT ILIKE '%paper%'`,
                    [userId]
                );

                credits = Number(result.rows[0]?.credits ?? 0);
                debits = Number(result.rows[0]?.debits ?? 0);
                balance = Math.max(0, credits - debits);
            }

            const positionsResult = await pool.query(
                `SELECT COALESCE(SUM(invested_amount_usd), 0) as total_invested
         FROM positions
         WHERE user_id = $1 AND status = 'open'`,
                [userId]
            );

            const totalInvested = Number(positionsResult.rows[0]?.total_invested ?? 0);
            const availableBalance = Math.max(0, balance - totalInvested);

            res.json({
                success: true,
                data: {
                    total_balance_usd: balance,
                    available_balance_usd: availableBalance,
                    invested_in_positions_usd: totalInvested,
                    credits_usd: credits,
                    debits_usd: debits,
                    is_admin_residual: !!adminData
                },
                timestamp: new Date(),
            });
        } catch (error: any) {
            console.error('[Balance] Default route error:', error);
            res.status(500).json({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: error.message },
                timestamp: new Date(),
            });
        }
    });

    return router;
}

export default initBalanceRoutes;
