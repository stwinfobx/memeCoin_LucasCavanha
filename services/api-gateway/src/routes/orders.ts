import { Router, Response } from 'express';
import { pool } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const orders = await pool.query(
      `SELECT o.id, o.order_type, o.status, o.amount_usd, o.amount_token, o.price_usd, 
              o.transaction_hash, o.created_at, o.executed_at,
              t.id as token_id, t.symbol, t.name
       FROM orders o
       JOIN tokens t ON o.token_id = t.id
       WHERE o.user_id = $1
       ORDER BY o.created_at DESC
       LIMIT 200`,
      [userId]
    );

    res.json({
      success: true,
      data: orders.rows,
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[Orders] list error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ORDERS_ERROR',
        message: 'Failed to load orders',
      },
      timestamp: new Date(),
    });
  }
});

router.get('/open-positions', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const result = await pool.query(
      `SELECT * FROM open_positions WHERE user_id = $1`,
      [userId]
    );

    res.json({
      success: true,
      data: result.rows,
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[Orders] open positions error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'OPEN_POSITIONS_ERROR',
        message: 'Failed to load open positions',
      },
      timestamp: new Date(),
    });
  }
});

export default router;


