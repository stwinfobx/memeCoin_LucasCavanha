import { Pool } from 'pg';
import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';

const router = Router();

/**
 * GET /api/stats/advanced
 * Retorna métricas avançadas de trading
 */
router.get('/advanced', authenticate, async (req: Request, res: Response) => {
    const pool: Pool = (req as any).pool;
    const userId = (req as any).userId;

    try {
        // Buscar todos os trades completados
        const tradesResult = await pool.query(
            `SELECT 
        o.id,
        o.order_type,
        o.amount_usd,
        o.price_usd,
        o.created_at,
        o.executed_at,
        p.invested_usd,
        p.avg_buy_price,
        p.token_balance,
        p.status as position_status,
        CASE 
          WHEN o.order_type = 'SELL' AND p.avg_buy_price > 0 
          THEN ((o.price_usd - p.avg_buy_price) / p.avg_buy_price) * 100
          ELSE 0
        END as return_percent
       FROM orders o
       LEFT JOIN positions p ON o.token_id = p.token_id AND o.user_id = p.user_id
       WHERE o.user_id = $1 
       AND o.status = 'completed'
       ORDER BY o.created_at ASC`,
            [userId]
        );

        const trades = tradesResult.rows;

        if (trades.length === 0) {
            return res.json({
                success: true,
                data: {
                    totalTrades: 0,
                    sharpeRatio: 0,
                    maxDrawdown: 0,
                    profitFactor: 0,
                    averageHoldTime: 0,
                    bestTrade: null,
                    worstTrade: null,
                    winRate: 0,
                },
            });
        }

        // Calcular retornos
        const returns = trades
            .filter((t) => t.order_type === 'SELL' && t.return_percent !== 0)
            .map((t) => t.return_percent);

        // 1. Sharpe Ratio
        // Sharpe Ratio = (Média dos Retornos - Taxa Livre de Risco) / Desvio Padrão dos Retornos
        // Assumindo taxa livre de risco = 0
        const avgReturn = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
        const variance =
            returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length || 1);
        const stdDev = Math.sqrt(variance);
        const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;

        // 2. Max Drawdown
        // Rastrear o pico e calcular a maior queda
        let peak = 0;
        let maxDrawdown = 0;
        let cumulative = 0;

        returns.forEach((r) => {
            cumulative += r;
            if (cumulative > peak) {
                peak = cumulative;
            }
            const drawdown = peak - cumulative;
            if (drawdown > maxDrawdown) {
                maxDrawdown = drawdown;
            }
        });

        // 3. Profit Factor
        // Profit Factor = Soma de Ganhos / Soma de Perdas
        const gains = returns.filter((r) => r > 0).reduce((a, b) => a + b, 0);
        const losses = Math.abs(returns.filter((r) => r < 0).reduce((a, b) => a + b, 0));
        const profitFactor = losses > 0 ? gains / losses : gains > 0 ? Infinity : 0;

        // 4. Average Hold Time
        const holdTimes = trades
            .filter((t) => t.executed_at && t.created_at)
            .map((t) => {
                const start = new Date(t.created_at).getTime();
                const end = new Date(t.executed_at).getTime();
                return (end - start) / 1000 / 60; // minutos
            });
        const avgHoldTime =
            holdTimes.length > 0 ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length : 0;

        // 5. Best/Worst Trade
        const sellTrades = trades.filter((t) => t.order_type === 'SELL' && t.return_percent !== 0);
        const bestTrade =
            sellTrades.length > 0
                ? sellTrades.reduce((best, trade) =>
                    trade.return_percent > best.return_percent ? trade : best
                )
                : null;
        const worstTrade =
            sellTrades.length > 0
                ? sellTrades.reduce((worst, trade) =>
                    trade.return_percent < worst.return_percent ? trade : worst
                )
                : null;

        // 6. Win Rate
        const wins = returns.filter((r) => r > 0).length;
        const winRate = returns.length > 0 ? (wins / returns.length) * 100 : 0;

        res.json({
            success: true,
            data: {
                totalTrades: trades.length,
                sharpeRatio: Math.round(sharpeRatio * 100) / 100,
                maxDrawdown: Math.round(maxDrawdown * 100) / 100,
                profitFactor: Math.round(profitFactor * 100) / 100,
                averageHoldTime: Math.round(avgHoldTime * 10) / 10,
                bestTrade: bestTrade
                    ? {
                        id: bestTrade.id,
                        returnPercent: Math.round(bestTrade.return_percent * 100) / 100,
                        amountUsd: bestTrade.amount_usd,
                        executedAt: bestTrade.executed_at,
                    }
                    : null,
                worstTrade: worstTrade
                    ? {
                        id: worstTrade.id,
                        returnPercent: Math.round(worstTrade.return_percent * 100) / 100,
                        amountUsd: worstTrade.amount_usd,
                        executedAt: worstTrade.executed_at,
                    }
                    : null,
                winRate: Math.round(winRate * 100) / 100,
                returns: returns.map((r) => Math.round(r * 100) / 100),
            },
        });
    } catch (error: any) {
        console.error('[StatsRoutes] Error getting advanced stats:', error);
        res.status(500).json({
            success: false,
            error: { message: 'Erro ao buscar métricas avançadas', details: error.message },
        });
    }
});

export default router;
