import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

async function migrate() {
  const pool = new Pool({
    connectionString: 'postgresql://postgres:%26%26MUSf3r9%2F%2Bj%26YL@db.jehcuhbwtpxcayqfyhbe.supabase.co:5432/postgres',
    ssl: { rejectUnauthorized: false }
  });

  const sqlPath = path.resolve(__dirname, '../../../infra/postgres/migrations/006_service_health.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  try {
    await pool.query(sql);
    console.log('✅ Migration 006 successful');
  } catch (err) {
    console.error('❌ Migration failed:', err);
  } finally {
    await pool.end();
  }
}

migrate();
