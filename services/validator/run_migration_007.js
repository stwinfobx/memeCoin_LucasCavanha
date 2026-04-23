const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: 'postgresql://postgres:%26%26MUSf3r9%2F%2Bj%26YL@db.jehcuhbwtpxcayqfyhbe.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const absoluteSqlPath = 'c:/Users/evilm/OneDrive/Documentos/GitHub/memeCoin_LucasCavanha/infra/postgres/migrations/007_security_fields.sql';
  
  console.log('Reading migration from:', absoluteSqlPath);
  const sql = fs.readFileSync(absoluteSqlPath, 'utf8');
  
  try {
    await pool.query(sql);
    console.log('Migration 007 applied successfully!');
  } catch (err) {
    console.error('Error applying migration:', err.message);
  } finally {
    await pool.end();
  }
}

run();
