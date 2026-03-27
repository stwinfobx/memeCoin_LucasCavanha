import { Router, Response } from 'express';
import { Pool } from 'pg';
import { authenticate, AuthRequest } from '../middleware/auth';
import { ethers } from 'ethers';
// Node 18+ includes global fetch; if using older Node, ensure node-fetch is installed.


import { getAdminBalance } from '../utils/balance';

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
                res.json({
                    success: true,
                    data: {
                        total_balance_usd: balance,
                        available_balance_usd: balance, // Admin has total liquid capital
                        invested_in_positions_usd: 0, 
                        is_admin_residual: true,
                        chains: adminData.chains
                    },
                    timestamp: new Date(),
                });
                return;
            } else {
                // Lógica Multi-Chain para usuários comuns
                const result = await pool.query(
                    `SELECT 
                        chain,
                        COALESCE(SUM(CASE WHEN entry_type IN ('deposit', 'trade_profit') THEN amount_usd ELSE 0 END), 0) -
                        COALESCE(SUM(CASE WHEN entry_type IN ('withdrawal', 'trade_loss', 'fee', 'gas') THEN ABS(amount_usd) ELSE 0 END), 0) AS balance
                     FROM ledger_entries
                     WHERE user_id = $1 AND description NOT ILIKE '%paper%'
                     GROUP BY chain`,
                    [userId]
                );

                const chainBalances: any = {
                    bsc: { balance_usd: 0 },
                    base: { balance_usd: 0 },
                    solana: { balance_usd: 0 }
                };

                let totalBalance = 0;
                result.rows.forEach(row => {
                    const c = row.chain.toLowerCase();
                    if (chainBalances[c]) {
                        chainBalances[c].balance_usd = Number(row.balance);
                        totalBalance += Number(row.balance);
                    }
                });

                res.json({
                    success: true,
                    data: {
                        total_balance_usd: totalBalance,
                        available_balance_usd: totalBalance, // Simplificado, descontar abertos na UI ou via CTE
                        is_admin_residual: false,
                        chains: chainBalances
                    },
                    timestamp: new Date(),
                });
                return;
            }
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
