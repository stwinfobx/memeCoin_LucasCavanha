import { Router, Response } from 'express';
import { Pool } from 'pg';
import { authenticate, AuthRequest } from '../middleware/auth';

const connectionString = process.env.DATABASE_URL;
const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
    })
  : new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5433'),
      database: process.env.POSTGRES_DB || 'tradingbot',
      user: process.env.POSTGRES_USER || 'botuser',
      password: process.env.POSTGRES_PASSWORD || 'botpass',
      ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });

const router = Router();

// GET /api/notifications - Lista notificações do bot
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
    
    console.log('[Notifications] 📬 Fetching notifications for user:', userId);
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
    const unreadOnly = req.query.unread_only === 'true';

    // Verificar se a tabela existe, se não, retornar array vazio
    let query = `
      SELECT id, notification_type, severity, title, message, data, is_read, created_at
      FROM bot_notifications
      WHERE user_id = $1
    `;
    
    const params: any[] = [userId];

    if (unreadOnly) {
      query += ' AND is_read = false';
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);

    const result = await pool.query(query, params).catch((err: any) => {
      // Se a tabela não existir, retornar array vazio
      if (err.code === '42P01' || err.message?.includes('does not exist')) {
        console.warn('[Notifications] ⚠️ Table bot_notifications does not exist yet. Run migration: add_bot_notifications.sql');
        return { rows: [] };
      }
      throw err;
    });

    console.log('[Notifications] 📬 Found', result.rows?.length || 0, 'notifications for user', userId);

    res.json({
      success: true,
      data: result.rows || [],
      debug: {
        user_id: userId,
        total_count: result.rows?.length || 0,
        unread_count: result.rows?.filter((r: any) => !r.is_read)?.length || 0,
      },
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[Notifications] list error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'NOTIFICATIONS_ERROR',
        message: error.message || 'Failed to load notifications',
      },
      timestamp: new Date(),
    });
  }
});

// GET /api/notifications/unread-count - Conta notificações não lidas
router.get('/unread-count', authenticate, async (req: AuthRequest, res: Response) => {
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
      `SELECT COUNT(*) as count
       FROM bot_notifications
       WHERE user_id = $1 AND is_read = false`,
      [userId]
    ).catch((err: any) => {
      // Se a tabela não existir, retornar 0
      if (err.code === '42P01' || err.message?.includes('does not exist')) {
        return { rows: [{ count: '0' }] };
      }
      throw err;
    });

    res.json({
      success: true,
      data: {
        unread_count: Number(result.rows[0]?.count ?? 0),
      },
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[Notifications] unread count error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'NOTIFICATIONS_COUNT_ERROR',
        message: error.message || 'Failed to count unread notifications',
      },
      timestamp: new Date(),
    });
  }
});

// POST /api/notifications/:id/read - Marca notificação como lida
router.post('/:id/read', authenticate, async (req: AuthRequest, res: Response) => {
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
    const notificationId = req.params.id;

    await pool.query(
      `UPDATE bot_notifications SET is_read = true
       WHERE id = $1 AND user_id = $2`,
      [notificationId, userId]
    );

    res.json({
      success: true,
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[Notifications] mark read error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'NOTIFICATIONS_READ_ERROR',
        message: 'Failed to mark notification as read',
      },
      timestamp: new Date(),
    });
  }
});

// POST /api/notifications/mark-all-read - Marca todas como lidas
router.post('/mark-all-read', authenticate, async (req: AuthRequest, res: Response) => {
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

    await pool.query(
      `UPDATE bot_notifications SET is_read = true
       WHERE user_id = $1 AND is_read = false`,
      [userId]
    );

    res.json({
      success: true,
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[Notifications] mark all read error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'NOTIFICATIONS_MARK_ALL_ERROR',
        message: 'Failed to mark all notifications as read',
      },
      timestamp: new Date(),
    });
  }
});

export default router;

