
import { pool } from '../config/database';

async function fixDatabase() {
    console.log('🚀 Starting Database Fix...');

    try {
        // 1. Criar tabela user_profiles se não existir
        console.log('📊 Ensuring user_profiles table exists...');
        await pool.query(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL UNIQUE,
        monitoring_mode BOOLEAN DEFAULT FALSE,
        bot_intensity INTEGER DEFAULT 5,
        risk_profile TEXT DEFAULT 'moderate',
        max_loss_percent NUMERIC DEFAULT 10,
        max_gain_percent NUMERIC DEFAULT 25,
        max_open_trades INTEGER DEFAULT 3,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

        // 2. Garantir colunas individuais (migração retroativa)
        const columns = [
            ['monitoring_mode', 'BOOLEAN DEFAULT FALSE'],
            ['bot_intensity', 'INTEGER DEFAULT 5'],
            ['risk_profile', "TEXT DEFAULT 'moderate'"],
            ['max_loss_percent', 'NUMERIC DEFAULT 10'],
            ['max_gain_percent', 'NUMERIC DEFAULT 25'],
            ['max_open_trades', 'INTEGER DEFAULT 3']
        ];

        for (const [col, type] of columns) {
            await pool.query(`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS ${col} ${type}`);
        }
        console.log('✅ user_profiles columns verified.');

        // 3. Garantir Views (copiado de database.ts para garantir execução imediata)
        console.log('🪟 Synchronizing views...');
        await pool.query(`
      CREATE OR REPLACE VIEW open_positions AS
      SELECT 
          o.user_id,
          o.token_id,
          t.symbol,
          t.name,
          SUM(CASE WHEN o.order_type = 'BUY' THEN o.amount_usd ELSE -o.amount_usd END) as invested_usd,
          SUM(CASE WHEN o.order_type = 'BUY' THEN o.amount_token ELSE -o.amount_token END) as token_balance,
          AVG(CASE WHEN o.order_type = 'BUY' THEN o.price_usd END) as avg_buy_price,
          (SELECT price_usd FROM tokens WHERE id = o.token_id) as current_price,
          COUNT(*) as trade_count
      FROM orders o
      JOIN tokens t ON o.token_id = t.id
      WHERE o.status = 'completed'
      GROUP BY o.user_id, o.token_id, t.symbol, t.name
      HAVING SUM(CASE WHEN o.order_type = 'BUY' THEN o.amount_token ELSE -o.amount_token END) > 0;
    `);

        await pool.query(`
      CREATE OR REPLACE VIEW user_performance AS
      SELECT 
          u.id as user_id,
          u.email,
          COALESCE(SUM(CASE WHEN le.entry_type IN ('trade_profit', 'deposit') THEN le.amount_usd ELSE 0 END), 0) as total_deposits,
          COALESCE(SUM(CASE WHEN le.entry_type IN ('trade_loss', 'withdrawal', 'fee', 'gas') THEN le.amount_usd ELSE 0 END), 0) as total_withdrawals,
          COALESCE(SUM(CASE WHEN le.entry_type = 'trade_profit' THEN le.amount_usd ELSE 0 END), 0) as total_profit,
          COALESCE(SUM(CASE WHEN le.entry_type = 'trade_loss' THEN le.amount_usd ELSE 0 END), 0) as total_loss,
          COUNT(DISTINCT o.id) as total_trades,
          COUNT(DISTINCT CASE WHEN o.status = 'completed' THEN o.id END) as completed_trades
      FROM users u
      LEFT JOIN ledger_entries le ON u.id = le.user_id
      LEFT JOIN orders o ON u.id = o.user_id
      GROUP BY u.id, u.email;
    `);

        console.log('✅ Views synchronized.');
        console.log('🏁 Database fix completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Database fix failed:', error);
        process.exit(1);
    }
}

fixDatabase();
