const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:%26%26MUSf3r9%2F%2Bj%26YL@db.jehcuhbwtpxcayqfyhbe.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    const result = await pool.query(`
      SELECT 
        id, contract_address, symbol, 
        is_honeypot, safety_score, holders_count, volume_24h_usd, liquidity_usd, price_usd,
        created_at, validated_at
      FROM tokens
      ORDER BY created_at DESC
      LIMIT 10
    `);
    console.log('Recent tokens:', JSON.stringify(result.rows, null, 2));

    const signals = await pool.query(`
      SELECT 
        id, token_id, signal_type, confidence_score, reasoning, created_at
      FROM trading_signals
      ORDER BY created_at DESC
      LIMIT 10
    `);
    console.log('Recent signals:', JSON.stringify(signals.rows, null, 2));
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

run();
