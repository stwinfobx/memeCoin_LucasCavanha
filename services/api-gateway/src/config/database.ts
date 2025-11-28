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

// Testar conexão ao iniciar
pool
  .query('SELECT NOW()')
  .then(() => {
    console.log('✅ Database connected successfully');
  })
  .catch((err) => {
    console.error('❌ Database connection error:', err.message);
    console.error('⚠️  Make sure PostgreSQL/Supabase is running and the database exists');
  });

export default pool;


