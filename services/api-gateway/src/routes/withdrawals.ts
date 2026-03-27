import { Router, Response } from 'express';
import { pool } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

/**
 * POST /api/withdrawals/request - Solicitar saque isolado por rede
 */
router.post('/request', authenticate, async (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;

    if (!userId) {
        return res.status(401).json({
            success: false,
            error: { code: 'UNAUTHORIZED', message: 'Invalid user context' },
            timestamp: new Date(),
        });
    }

    try {
        const { amount_usd, wallet_address, chain } = req.body;
        const targetChain = (chain || 'BSC').toUpperCase();

        // Validacoes básicas
        if (!amount_usd || amount_usd <= 0) {
            return res.status(400).json({
                success: false,
                error: { code: 'INVALID_AMOUNT', message: 'Valor inválido' },
                timestamp: new Date(),
            });
        }

        if (!wallet_address) {
            return res.status(400).json({
                success: false,
                error: { code: 'MISSING_WALLET', message: 'Endereço da wallet obrigatório' },
                timestamp: new Date(),
            });
        }

        // Mapear coluna de saldo
        const balanceCol = targetChain === 'SOLANA' || targetChain === 'SOL' ? 'balance_solana' : 
                          targetChain === 'BASE' ? 'balance_base' : 'balance_bsc';

        // 1. Verificar saldo na chain específica (Source of Truth)
        const userRes = await pool.query(
            `SELECT ${balanceCol}, email FROM users WHERE id = $1`,
            [userId]
        );

        if (userRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: { message: 'Usuário não encontrado' } });
        }

        const currentBalance = Number(userRes.rows[0][balanceCol] || 0);

        if (amount_usd > currentBalance) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'INSUFFICIENT_BALANCE',
                    message: `Saldo insuficiente na rede ${targetChain}. Disponível: $${currentBalance.toFixed(2)}`,
                },
                timestamp: new Date(),
            });
        }

        // 2. Transação Atômica: Deduzir saldo + Criar Saque + Ledger
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Deduzir do saldo virtual da chain
            await client.query(
                `UPDATE users SET ${balanceCol} = ${balanceCol} - $1 WHERE id = $2`,
                [amount_usd, userId]
            );

            // Criar registro na fila de saques
            const withdrawalResult = await client.query(
                `INSERT INTO withdrawals (user_id, amount_usd, wallet_address, chain, status)
                 VALUES ($1, $2, $3, $4, 'pending')
                 RETURNING *`,
                [userId, amount_usd, wallet_address, targetChain]
            );

            const withdrawal = withdrawalResult.rows[0];

            // Registrar no Ledger Histórico (para transparência)
            await client.query(
                `INSERT INTO ledger_entries (user_id, type, amount_usd, description, chain) 
                 VALUES ($1, 'WITHDRAWAL', $2, $3, $4)`,
                [userId, -amount_usd, `Solicitação de saque via ${targetChain} para ${wallet_address.substring(0, 8)}...`, targetChain]
            );

            // Notificar sistema
            await client.query(
                `INSERT INTO bot_notifications (user_id, notification_type, severity, title, message, data)
                 VALUES ($1, 'withdrawal_requested', 'info', 'Saque solicitado', $2, $3::jsonb)`,
                [
                    userId,
                    `Solicitação de saque de $${amount_usd} USD criada na rede ${targetChain}.`,
                    JSON.stringify({
                        withdrawal_id: withdrawal.id,
                        amount: amount_usd,
                        wallet: wallet_address,
                        chain: targetChain,
                    }),
                ]
            );

            await client.query('COMMIT');

            res.json({
                success: true,
                data: {
                    withdrawal_id: withdrawal.id,
                    amount_usd: withdrawal.amount_usd,
                    wallet_address: withdrawal.wallet_address,
                    chain: withdrawal.chain,
                    status: withdrawal.status,
                    created_at: withdrawal.created_at,
                },
                timestamp: new Date(),
            });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }

    } catch (error: any) {
        console.error('[Withdrawals] Request error:', error);
        res.status(500).json({
            success: false,
            error: { code: 'WITHDRAWAL_ERROR', message: error.message },
            timestamp: new Date(),
        });
    }
});

/**
 * GET /api/withdrawals/history - Histórico de saques do usuário
 */
router.get('/history', authenticate, async (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;

    if (!userId) return res.status(401).json({ success: false });

    try {
        const result = await pool.query(
            `SELECT id, amount_usd, wallet_address, chain, status, tx_hash, created_at
             FROM withdrawals
             WHERE user_id = $1
             ORDER BY created_at DESC
             LIMIT 50`,
            [userId]
        );

        res.json({
            success: true,
            data: {
                withdrawals: result.rows.map(w => ({
                    ...w,
                    amount_usd: Number(w.amount_usd)
                }))
            },
            timestamp: new Date(),
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
