/**
 * Script manual para limpar dados antigos do banco
 * Use: npx tsx scripts/cleanup-database.ts
 */

import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

// Carregar .env da raiz
dotenv.config({ path: path.resolve(__dirname, '../.env') });

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

async function cleanup() {
  try {
    console.log('🧹 Iniciando limpeza manual do banco de dados...\n');

    // 1. Limpar notificações lidas antigas (mais de 7 dias)
    console.log('1️⃣ Limpando notificações lidas antigas...');
    const notificationsResult = await pool.query(
      `DELETE FROM bot_notifications 
       WHERE is_read = true 
       AND created_at < NOW() - INTERVAL '7 days'
       RETURNING id`
    );
    console.log(`   ✅ Removidas ${notificationsResult.rowCount || 0} notificações lidas antigas\n`);

    // 2. Limpar sinais inativos antigos
    console.log('2️⃣ Limpando sinais inativos antigos...');
    const signalsResult = await pool.query(
      `DELETE FROM signals 
       WHERE is_active = false 
       AND created_at < NOW() - INTERVAL '7 days'
       RETURNING id`
    );
    console.log(`   ✅ Removidos ${signalsResult.rowCount || 0} sinais inativos antigos\n`);

    // 3. Desativar sinais HOLD muito antigos
    console.log('3️⃣ Desativando sinais HOLD muito antigos...');
    const deactivateHoldResult = await pool.query(
      `UPDATE signals 
       SET is_active = false 
       WHERE signal_type = 'HOLD' 
       AND is_active = true 
       AND created_at < NOW() - INTERVAL '7 days'
       RETURNING id`
    );
    console.log(`   ✅ Desativados ${deactivateHoldResult.rowCount || 0} sinais HOLD antigos\n`);

    // 4. Limpar logs de auditoria antigos
    console.log('4️⃣ Limpando logs de auditoria antigos...');
    const auditLogsResult = await pool.query(
      `DELETE FROM audit_logs 
       WHERE created_at < NOW() - INTERVAL '14 days'
       RETURNING id`
    );
    console.log(`   ✅ Removidos ${auditLogsResult.rowCount || 0} logs de auditoria antigos\n`);

    // 5. Limitar notificações por usuário
    console.log('5️⃣ Limitando notificações por usuário (máx 500 por usuário)...');
    const usersResult = await pool.query(`SELECT DISTINCT user_id FROM bot_notifications`);

    let totalDeleted = 0;
    for (const row of usersResult.rows) {
      const userId = row.user_id;
      const countResult = await pool.query(
        `SELECT COUNT(*) as count FROM bot_notifications WHERE user_id = $1`,
        [userId]
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      if (totalCount > 500) {
        const deleteResult = await pool.query(
          `DELETE FROM bot_notifications 
           WHERE user_id = $1 
           AND is_read = true 
           AND id IN (
             SELECT id FROM bot_notifications 
             WHERE user_id = $1 AND is_read = true 
             ORDER BY created_at ASC 
             LIMIT $2
           )`,
          [userId, totalCount - 450]
        );
        totalDeleted += deleteResult.rowCount || 0;
      }
    }
    console.log(`   ✅ Removidas ${totalDeleted} notificações excessivas\n`);

    // Estatísticas finais
    console.log('📊 Estatísticas finais:');
    const statsResult = await pool.query(
      `SELECT 
        (SELECT COUNT(*) FROM bot_notifications) as notifications_count,
        (SELECT COUNT(*) FROM signals WHERE is_active = true) as active_signals_count,
        (SELECT COUNT(*) FROM signals WHERE is_active = false) as inactive_signals_count,
        (SELECT COUNT(*) FROM audit_logs) as audit_logs_count`
    );

    const stats = statsResult.rows[0];
    console.log(`   📬 Notificações totais: ${stats.notifications_count}`);
    console.log(`   📈 Sinais ativos: ${stats.active_signals_count}`);
    console.log(`   📉 Sinais inativos: ${stats.inactive_signals_count}`);
    console.log(`   📋 Logs de auditoria: ${stats.audit_logs_count}\n`);

    console.log('✅ Limpeza concluída com sucesso!');
  } catch (error: any) {
    console.error('❌ Erro durante limpeza:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

cleanup();

