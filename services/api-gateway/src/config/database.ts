import './env';
import { Pool, PoolConfig } from 'pg';

const poolConfig: PoolConfig = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5433'),
  database: process.env.POSTGRES_DB || 'tradingbot',
  user: process.env.POSTGRES_USER || 'botuser',
  password: process.env.POSTGRES_PASSWORD || 'botpass',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
};

const connectionString = process.env.DATABASE_URL;

export const pool = connectionString
  ? new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  })
  : new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

// Função para garantir que as views necessárias existam
async function synchronizeViews(pool: Pool) {
  try {
    console.log('[Database] Synchronizing SQL views...');

    // View: open_positions
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

    // View: user_performance
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

    console.log('✅ SQL views synchronized successfully');
  } catch (err: any) {
    console.warn('⚠️  Failed to synchronize views:', err.message);
    // Não travar o sistema por causa das views
  }
}

// Testar conexão ao iniciar
pool
  .query('SELECT NOW()')
  .then(async () => {
    console.log('✅ Database connected successfully');
    await synchronizeViews(pool);
  })
  .catch((err) => {
    console.error('❌ Database connection error:', err.message);
    console.error('⚠️  Make sure PostgreSQL/Supabase is running and the database exists');
  });

export default pool;


