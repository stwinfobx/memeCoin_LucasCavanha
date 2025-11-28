import { Router, Response } from 'express';
import { pool } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/positions - Lista posições abertas com ganhos/perdas em tempo real
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid user context',
        },
        timestamp: new Date(),
      });
    }

    const result = await pool.query(
      `SELECT 
         p.id,
         p.token_id,
         p.invested_amount_usd,
         p.buy_price_usd,
         p.buy_time,
         p.current_price_usd,
         p.token_balance,
         p.hold_time_hours,
         t.symbol,
         t.name,
         t.price_usd as latest_price,
         s.signal_type,
         s.confidence_score,
         s.potential_multiplier,
         CASE 
           WHEN p.current_price_usd IS NOT NULL AND p.invested_amount_usd > 0 
           THEN (p.current_price_usd * p.token_balance) - p.invested_amount_usd
           ELSE 0
         END as unrealized_pnl,
         CASE 
           WHEN p.current_price_usd IS NOT NULL AND p.invested_amount_usd > 0 
           THEN ((p.current_price_usd * p.token_balance) - p.invested_amount_usd) / p.invested_amount_usd * 100
           ELSE 0
         END as unrealized_pnl_percent
       FROM positions p
       JOIN tokens t ON p.token_id = t.id
       LEFT JOIN signals s ON p.token_id = s.token_id AND s.is_active = true
       WHERE p.user_id = $1 AND p.status = 'open'
       ORDER BY p.created_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      data: result.rows,
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[Positions] open error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'POSITIONS_ERROR',
        message: 'Failed to load open positions',
      },
      timestamp: new Date(),
    });
  }
});

// GET /api/positions/closed - Lista posições fechadas com ganhos/perdas finais
router.get('/closed', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid user context',
        },
        timestamp: new Date(),
      });
    }

    const result = await pool.query(
      `SELECT 
         p.id,
         p.token_id,
         p.invested_amount_usd,
         p.buy_price_usd,
         p.buy_time,
         p.closed_at,
         p.profit_loss_usd,
         p.profit_loss_percent,
         p.hold_time_hours,
         t.symbol,
         t.name,
         s.signal_type,
         s.confidence_score
       FROM positions p
       JOIN tokens t ON p.token_id = t.id
       LEFT JOIN signals s ON p.token_id = s.token_id AND s.is_active = true
       WHERE p.user_id = $1 AND p.status = 'closed'
       ORDER BY p.closed_at DESC
       LIMIT 50`,
      [userId]
    );

    res.json({
      success: true,
      data: result.rows,
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[Positions] closed error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'POSITIONS_CLOSED_ERROR',
        message: 'Failed to load closed positions',
      },
      timestamp: new Date(),
    });
  }
});

// GET /api/positions/summary - Resumo total: ganhos, perdas, ROI
router.get('/summary', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid user context',
        },
        timestamp: new Date(),
      });
    }

    // Posições abertas (unrealized)
    const openResult = await pool.query(
      `SELECT 
         COALESCE(SUM(invested_amount_usd), 0) as total_invested,
         COALESCE(SUM(CASE 
           WHEN current_price_usd IS NOT NULL AND token_balance > 0
           THEN (current_price_usd * token_balance) - invested_amount_usd
           ELSE 0
         END), 0) as unrealized_pnl
       FROM positions
       WHERE user_id = $1 AND status = 'open'`,
      [userId]
    );

    // Posições fechadas (realized)
    const closedResult = await pool.query(
      `SELECT 
         COALESCE(SUM(invested_amount_usd), 0) as total_invested,
         COALESCE(SUM(profit_loss_usd), 0) as realized_pnl
       FROM positions
       WHERE user_id = $1 AND status = 'closed'`,
      [userId]
    );

    const openData = openResult.rows[0];
    const closedData = closedResult.rows[0];

    const totalInvested = Number(openData?.total_invested ?? 0) + Number(closedData?.total_invested ?? 0);
    const unrealizedPnL = Number(openData?.unrealized_pnl ?? 0);
    const realizedPnL = Number(closedData?.realized_pnl ?? 0);
    const totalPnL = unrealizedPnL + realizedPnL;
    const roi = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;

    res.json({
      success: true,
      data: {
        total_invested: totalInvested,
        unrealized_pnl: unrealizedPnL,
        realized_pnl: realizedPnL,
        total_pnl: totalPnL,
        roi_percent: Number(roi.toFixed(2)),
      },
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[Positions] summary error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'POSITIONS_SUMMARY_ERROR',
        message: 'Failed to load positions summary',
      },
      timestamp: new Date(),
    });
  }
});

export default router;

