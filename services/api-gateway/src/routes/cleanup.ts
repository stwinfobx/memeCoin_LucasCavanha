import { Router, Response } from 'express';
import { Pool } from 'pg';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

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

// POST /api/cleanup - Limpa dados antigos do banco (admin only)
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
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

    const daysToKeep = Number(req.body.days ?? 7); // Padrão: manter últimos 7 dias

    console.log(`[Cleanup] 🧹 Starting database cleanup - keeping last ${daysToKeep} days`);

    // 1. Limpar notificações antigas (lidas)
    const notificationsResult = await pool.query(
      `DELETE FROM bot_notifications 
       WHERE is_read = true 
       AND created_at < NOW() - INTERVAL '${daysToKeep} days'
       RETURNING id`,
      []
    );
    const deletedNotifications = notificationsResult.rowCount || 0;

    // 2. Limpar sinais inativos antigos (mais de 24h inativos)
    const signalsResult = await pool.query(
      `DELETE FROM signals 
       WHERE is_active = false 
       AND created_at < NOW() - INTERVAL '${daysToKeep} days'
       RETURNING id`,
      []
    );
    const deletedSignals = signalsResult.rowCount || 0;

    // 3. Limpar logs de auditoria antigos
    const auditLogsResult = await pool.query(
      `DELETE FROM audit_logs 
       WHERE created_at < NOW() - INTERVAL '${daysToKeep * 2} days'
       RETURNING id`,
      []
    );
    const deletedAuditLogs = auditLogsResult.rowCount || 0;

    // 4. Desativar sinais HOLD muito antigos (mais de 7 dias)
    const deactivateHoldSignalsResult = await pool.query(
      `UPDATE signals 
       SET is_active = false 
       WHERE signal_type = 'HOLD' 
       AND is_active = true 
       AND created_at < NOW() - INTERVAL '7 days'
       RETURNING id`,
      []
    );
    const deactivatedHoldSignals = deactivateHoldSignalsResult.rowCount || 0;

    console.log(`[Cleanup] ✅ Cleanup completed:`, {
      deleted_notifications: deletedNotifications,
      deleted_signals: deletedSignals,
      deleted_audit_logs: deletedAuditLogs,
      deactivated_hold_signals: deactivatedHoldSignals,
    });

    res.json({
      success: true,
      data: {
        deleted_notifications: deletedNotifications,
        deleted_signals: deletedSignals,
        deleted_audit_logs: deletedAuditLogs,
        deactivated_hold_signals: deactivatedHoldSignals,
        days_kept: daysToKeep,
      },
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[Cleanup] Error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CLEANUP_ERROR',
        message: error.message || 'Failed to cleanup database',
      },
      timestamp: new Date(),
    });
  }
});

// GET /api/cleanup/stats - Estatísticas do banco de dados
router.get('/stats', authenticate, async (req: AuthRequest, res: Response) => {
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

    const statsResult = await pool.query(
      `SELECT 
        (SELECT COUNT(*) FROM bot_notifications WHERE user_id = $1) as notifications_count,
        (SELECT COUNT(*) FROM bot_notifications WHERE user_id = $1 AND is_read = false) as unread_notifications,
        (SELECT COUNT(*) FROM bot_notifications WHERE user_id = $1 AND is_read = true AND created_at < NOW() - INTERVAL '7 days') as old_read_notifications,
        (SELECT COUNT(*) FROM signals WHERE is_active = false AND created_at < NOW() - INTERVAL '7 days') as old_inactive_signals,
        (SELECT COUNT(*) FROM signals WHERE signal_type = 'HOLD' AND is_active = true AND created_at < NOW() - INTERVAL '7 days') as old_hold_signals,
        (SELECT COUNT(*) FROM audit_logs WHERE created_at < NOW() - INTERVAL '14 days') as old_audit_logs`,
      [userId]
    );

    const stats = statsResult.rows[0] || {};

    res.json({
      success: true,
      data: {
        notifications: {
          total: Number(stats.notifications_count ?? 0),
          unread: Number(stats.unread_notifications ?? 0),
          old_read: Number(stats.old_read_notifications ?? 0),
        },
        signals: {
          old_inactive: Number(stats.old_inactive_signals ?? 0),
          old_hold: Number(stats.old_hold_signals ?? 0),
        },
        audit_logs: {
          old: Number(stats.old_audit_logs ?? 0),
        },
      },
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[Cleanup Stats] Error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CLEANUP_STATS_ERROR',
        message: error.message || 'Failed to get cleanup stats',
      },
      timestamp: new Date(),
    });
  }
});

export default router;

