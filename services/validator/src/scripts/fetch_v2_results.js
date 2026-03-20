
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
// Point to the root .env
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

async function main() {
  console.log('Fetching tokens from Validator v2 (since March 16th evening)...');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    const client = await pool.connect();

    // Fetching only tokens validated after the v2 deployment (approx 19:00 UTC yesterday)
    const query = `
      SELECT t.*, tra.memecoin_score, tra.risk_score, tra.scam_probability, tra.risk_level, tra.indicators 
      FROM tokens t
      LEFT JOIN token_risk_assessments tra ON t.id = tra.token_id
      WHERE t.validated_at >= '2026-03-17 09:00:00+00'
      ORDER BY t.validated_at DESC;
    `;

    const result = await client.query(query);
    console.log(`Found ${result.rowCount} tokens from Validator v2.`);
    client.release();

    const tokens = result.rows.map(row => {
      const token = { ...row };
      if (token.total_supply) token.total_supply = token.total_supply.toString();
      return token;
    });

    const outputPath = path.join(process.cwd(), '../../analyzed_tokens_v3_report.json');
    fs.writeFileSync(outputPath, JSON.stringify(tokens, null, 2));

    console.log(`Report successfully saved to analyzed_tokens_v3_report.json`);

    // Summary
    const approved = tokens.filter(t => t.safety_score >= 80);
    const withHolders = tokens.filter(t => t.holders_count > 0);
    const washDetected = tokens.filter(t => t.indicators?.washTradingDetected === true);

    console.log(`Summary of V2 results:`);
    console.log(`- Total V2: ${tokens.length}`);
    console.log(`- Approved (>= 80): ${approved.length}`);
    console.log(`- Solana with Holders: ${tokens.filter(t => t.chain === 'SOLANA' && t.holders_count > 0).length}`);
    console.log(`- Wash Trading Detected: ${washDetected.length}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

main();
