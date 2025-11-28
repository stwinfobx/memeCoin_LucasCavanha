import { Pool } from 'pg';

/**
 * Serviço de limpeza automática do banco de dados
 * Remove dados antigos para evitar lotar o banco (especialmente Supabase free tier)
 */
export class CleanupScheduler {
  private pool: Pool;
  private interval: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Inicia limpeza automática periódica
   */
  start(intervalHours: number = 24): void {
    if (this.isRunning) {
      console.log('[Cleanup Scheduler] Already running');
      return;
    }

    this.isRunning = true;
    const intervalMs = intervalHours * 60 * 60 * 1000;

    console.log(`🧹 Cleanup Scheduler started - will cleanup every ${intervalHours} hours`);

    // NÃO executar imediatamente - aguardar servidor estar pronto
    // Primeira execução será após o intervalo ou quando chamado manualmente

    // Executar periodicamente
    this.interval = setInterval(() => {
      this.cleanupOldData();
    }, intervalMs);
  }

  /**
   * Para limpeza automática
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    console.log('[Cleanup Scheduler] Stopped');
  }

  /**
   * Limpa dados antigos do banco
   */
  async cleanupOldData(): Promise<void> {
    try {
      // Testar conexão primeiro
      await this.pool.query('SELECT NOW()');
      console.log('[Cleanup Scheduler] 🧹 Starting automatic database cleanup...');

      // 1. Limpar notificações lidas antigas (mais de 7 dias)
      const notificationsResult = await this.pool.query(
        `DELETE FROM bot_notifications 
         WHERE is_read = true 
         AND created_at < NOW() - INTERVAL '7 days'
         RETURNING id`,
        []
      );
      const deletedNotifications = notificationsResult.rowCount || 0;

      // 2. Limpar sinais inativos antigos (mais de 7 dias)
      const signalsResult = await this.pool.query(
        `DELETE FROM signals 
         WHERE is_active = false 
         AND created_at < NOW() - INTERVAL '7 days'
         RETURNING id`,
        []
      );
      const deletedSignals = signalsResult.rowCount || 0;

      // 3. Desativar sinais HOLD muito antigos (mais de 7 dias ativos)
      const deactivateHoldResult = await this.pool.query(
        `UPDATE signals 
         SET is_active = false 
         WHERE signal_type = 'HOLD' 
         AND is_active = true 
         AND created_at < NOW() - INTERVAL '7 days'
         RETURNING id`,
        []
      );
      const deactivatedHold = deactivateHoldResult.rowCount || 0;

      // 4. Limpar logs de auditoria muito antigos (mais de 14 dias)
      const auditLogsResult = await this.pool.query(
        `DELETE FROM audit_logs 
         WHERE created_at < NOW() - INTERVAL '14 days'
         RETURNING id`,
        []
      );
      const deletedAuditLogs = auditLogsResult.rowCount || 0;

      // 5. Limitar notificações por usuário (manter apenas últimas 500 por usuário)
      // OTIMIZAÇÃO: Usar uma única query para limitar notificações por usuário
      const limitNotificationsResult = await this.pool.query(
        `WITH ranked_notifications AS (
          SELECT 
            id,
            user_id,
            ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn
          FROM bot_notifications
        )
        DELETE FROM bot_notifications 
        WHERE id IN (
          SELECT id FROM ranked_notifications WHERE rn > 500
        )
        RETURNING id`
      );
      const limitedNotifications = limitNotificationsResult.rowCount || 0;

      console.log('[Cleanup Scheduler] ✅ Cleanup completed:', {
        deleted_notifications: deletedNotifications,
        deleted_signals: deletedSignals,
        deactivated_hold_signals: deactivatedHold,
        deleted_audit_logs: deletedAuditLogs,
        limited_notifications: limitedNotifications,
      });
    } catch (error: any) {
      // Não logar erro de conexão no primeiro cleanup (banco pode não estar pronto)
      if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') {
        console.log('[Cleanup Scheduler] ⚠️ Database not available yet, skipping cleanup. Will retry on next interval.');
      } else {
        console.error('[Cleanup Scheduler] ❌ Error during cleanup:', error.message);
      }
    }
  }
}

