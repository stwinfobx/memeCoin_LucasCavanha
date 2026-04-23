const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:%26%26MUSf3r9%2F%2Bj%26YL@db.jehcuhbwtpxcayqfyhbe.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    const result = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'tokens'
    `);
    console.log('Columns in tokens table:', result.rows.map(r => r.column_name).join(', '));
  } catch (err) {
    console.error('Error fetching columns:', err.message);
  } finally {
    await pool.end();
  }
}

run();
