import { Router, Response } from 'express';
import { Pool } from 'pg';
import { authenticate, AuthRequest } from '../middleware/auth';
import { ethers } from 'ethers';

export function initDepositRoutes(pool: Pool): Router {
    const router = Router();

    // POST /api/deposits/create - Registrar depósito
    router.post('/create', authenticate, async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId;
            const { tx_hash, chain, token_symbol } = req.body;

            if (!tx_hash || !chain || !token_symbol) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'MISSING_FIELDS', message: 'tx_hash, chain, and token_symbol are required' },
                    timestamp: new Date(),
                });
            }

            // Validar formato do tx_hash
            if (!tx_hash.match(/^0x[a-fA-F0-9]{64}$/)) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'INVALID_TX_HASH', message: 'Invalid transaction hash format' },
                    timestamp: new Date(),
                });
            }

            // Verificar se já existe
            const existing = await pool.query(
                'SELECT id, status FROM deposits WHERE tx_hash = $1',
                [tx_hash.toLowerCase()]
            );

            if (existing.rows.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: {
                        code: 'DUPLICATE_DEPOSIT',
                        message: 'Deposit with this tx_hash already exists',
                        existing_status: existing.rows[0].status,
                    },
                    timestamp: new Date(),
                });
            }

            // Buscar wallet address do usuário
            const walletResult = await pool.query(
                'SELECT wallet_address FROM user_profiles WHERE user_id = $1',
                [userId]
            );

            if (walletResult.rows.length === 0 || !walletResult.rows[0].wallet_address) {
                return res.status(404).json({
                    success: false,
                    error: { code: 'WALLET_NOT_FOUND', message: 'User must connect wallet first via /api/wallet/connect' },
                    timestamp: new Date(),
                });
            }

            const wallet_address = walletResult.rows[0].wallet_address;

            // Inserir depósito pendente
            const result = await pool.query(
                `INSERT INTO deposits (
          user_id, wallet_address, chain, tx_hash, 
          amount_crypto, amount_usd, token_symbol, 
          status, confirmations
        )
        VALUES ($1, $2, $3, $4, 0, 0, $5, 'pending', 0)
        RETURNING id, status, created_at`,
                [userId, wallet_address, chain, tx_hash.toLowerCase(), token_symbol]
            );

            console.log(`[Deposits] 📝 Registered deposit for user ${userId} | TX: ${tx_hash.substring(0, 10)}...`);

            res.json({
                success: true,
                data: {
                    depositId: result.rows[0].id,
                    status: result.rows[0].status,
                    tx_hash,
                    message: 'Deposit registered successfully. Waiting for blockchain confirmations (3+ blocks)...',
                },
                timestamp: new Date(),
            });
        } catch (error: any) {
            console.error('[Deposits] Create error:', error);
            res.status(500).json({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: error.message },
                timestamp: new Date(),
            });
        }
    });

    // GET /api/deposits/status/:txHash - Verificar status
    router.get('/status/:txHash', authenticate, async (req: AuthRequest, res: Response) => {
        try {
            const { txHash } = req.params;
            const userId = req.user?.userId;

            const result = await pool.query(
                `SELECT id, status, confirmations, amount_crypto, amount_usd, token_symbol, chain, created_at, confirmed_at
         FROM deposits
         WHERE tx_hash = $1 AND user_id = $2`,
                [txHash.toLowerCase(), userId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: { code: 'DEPOSIT_NOT_FOUND', message: 'Deposit not found' },
                    timestamp: new Date(),
                });
            }

            const deposit = result.rows[0];

            res.json({
                success: true,
                data: {
                    ...deposit,
                    message: deposit.status === 'pending'
                        ? `Waiting for confirmations (${deposit.confirmations}/3)`
                        : deposit.status === 'confirmed'
                            ? 'Deposit confirmed and credited'
                            : 'Deposit failed',
                },
                timestamp: new Date(),
            });
        } catch (error: any) {
            console.error('[Deposits] Status error:', error);
            res.status(500).json({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: error.message },
                timestamp: new Date(),
            });
        }
    });

    // GET /api/deposits/history - Histórico de depósitos
    router.get('/history', authenticate, async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId;
            const limit = Math.min(Number(req.query.limit) || 50, 100);

            const result = await pool.query(
                `SELECT 
          id, tx_hash, chain, token_symbol, 
          amount_crypto, amount_usd, status, confirmations, 
          created_at, confirmed_at
         FROM deposits
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
                [userId, limit]
            );

            // Calcular estatísticas
            const stats = await pool.query(
                `SELECT 
          COUNT(*) as total_deposits,
          COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed_deposits,
          COALESCE(SUM(amount_usd) FILTER (WHERE status = 'confirmed'), 0) as total_deposited_usd
         FROM deposits
         WHERE user_id = $1`,
                [userId]
            );

            res.json({
                success: true,
                data: {
                    deposits: result.rows,
                    stats: {
                        total: Number(stats.rows[0].total_deposits),
                        confirmed: Number(stats.rows[0].confirmed_deposits),
                        total_usd: Number(stats.rows[0].total_deposited_usd),
                    },
                },
                timestamp: new Date(),
            });
        } catch (error: any) {
            console.error('[Deposits] History error:', error);
            res.status(500).json({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: error.message },
                timestamp: new Date(),
            });
        }
    });

    return router;
}

export default initDepositRoutes;
