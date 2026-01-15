import { Router, Response } from 'express';
import { pool } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// POST /api/withdrawals/request - Solicitar saque
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

        // Validacoes
        if (!amount_usd || amount_usd <= 0) {
            return res.status(400).json({
                success: false,
                error: { code: 'INVALID_AMOUNT', message: 'Valor invalido' },
                timestamp: new Date(),
            });
        }

        if (!wallet_address) {
            return res.status(400).json({
                success: false,
                error: { code: 'MISSING_WALLET', message: 'Endereco da wallet obrigatorio' },
                timestamp: new Date(),
            });
        }

        // Calcular saldo disponivel
        const balanceResult = await pool.query(
            `SELECT 
         COALESCE(SUM(CASE WHEN entry_type IN ('deposit', 'trade_profit') THEN amount_usd ELSE 0 END), 0) AS credits,
         COALESCE(SUM(CASE WHEN entry_type IN ('withdrawal', 'trade_loss', 'fee', 'gas') THEN ABS(amount_usd) ELSE 0 END), 0) AS debits
       FROM ledger_entries
       WHERE user_id = $1`,
            [userId]
        );

        const credits = Number(balanceResult.rows[0]?.credits ?? 0);
        const debits = Number(balanceResult.rows[0]?.debits ?? 0);
        const availableBalance = Math.max(0, credits - debits);

        // Verificar se tem saldo suficiente
        if (amount_usd > availableBalance) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'INSUFFICIENT_BALANCE',
                    message: `Saldo insuficiente. Disponivel: $${availableBalance.toFixed(2)}`,
                },
                timestamp: new Date(),
            });
        }

        // Criar registro de saque
        const withdrawalResult = await pool.query(
            `INSERT INTO withdrawals (user_id, amount_usd, wallet_address, chain, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING *`,
            [userId, amount_usd, wallet_address, chain || 'BSC']
        );

        const withdrawal = withdrawalResult.rows[0];

        // Criar notificacao
        await pool.query(
            `INSERT INTO bot_notifications (user_id, notification_type, severity, title, message, data)
       VALUES ($1, 'withdrawal_requested', 'info', 'Saque solicitado', $2, $3::jsonb)`,
            [
                userId,
                `Solicitacao de saque de $${amount_usd} USD foi criada e esta aguardando aprovacao.`,
                JSON.stringify({
                    withdrawal_id: withdrawal.id,
                    amount: amount_usd,
                    wallet: wallet_address,
                    chain: chain || 'BSC',
                }),
            ]
        );

        res.json({
            success: true,
            data: {
                withdrawal_id: withdrawal.id,
                amount_usd: withdrawal.amount_usd,
                wallet_address: withdrawal.wallet_address,
                status: withdrawal.status,
                created_at: withdrawal.created_at,
            },
            timestamp: new Date(),
        });
    } catch (error: any) {
        console.error('[Withdrawals] request error:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'WITHDRAWAL_REQUEST_ERROR',
                message: error.message || 'Erro ao solicitar saque',
            },
            timestamp: new Date(),
        });
    }
});

// GET /api/withdrawals/history - Historico de saques
router.get('/history', authenticate, async (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;

    if (!userId) {
        return res.status(401).json({
            success: false,
            error: { code: 'UNAUTHORIZED', message: 'Invalid user context' },
            timestamp: new Date(),
        });
    }

    try {
        const result = await pool.query(
            `SELECT id, amount_usd, wallet_address, chain, status, tx_hash, 
              approved_at, processed_at, rejection_reason, created_at
       FROM withdrawals
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
            [userId]
        );

        res.json({
            success: true,
            data: {
                withdrawals: result.rows.map((w) => ({
                    id: w.id,
                    amount_usd: Number(w.amount_usd),
                    wallet_address: w.wallet_address,
                    chain: w.chain,
                    status: w.status,
                    tx_hash: w.tx_hash,
                    approved_at: w.approved_at,
                    processed_at: w.processed_at,
                    rejection_reason: w.rejection_reason,
                    created_at: w.created_at,
                })),
            },
            timestamp: new Date(),
        });
    } catch (error: any) {
        console.error('[Withdrawals] history error:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'WITHDRAWAL_HISTORY_ERROR',
                message: error.message || 'Erro ao buscar historico',
            },
            timestamp: new Date(),
        });
    }
});

export default router;
