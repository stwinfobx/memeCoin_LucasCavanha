
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
// Point to the root .env
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

async function main() {
  console.log('Database URL:', process.env.DATABASE_URL.split('@')[1]); // Log hostname for verification
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  console.log('Fetching tokens analyzed in the last 4 days...');
  const startTime = Date.now();

  try {
    console.log('Connecting to pool...');
    const client = await pool.connect();
    console.log('Connected.');

    const query = `
      SELECT t.*, tra.memecoin_score, tra.risk_score, tra.scam_probability, tra.risk_level, tra.indicators 
      FROM tokens t
      LEFT JOIN token_risk_assessments tra ON t.id = tra.token_id
      WHERE t.validated_at >= NOW() - INTERVAL '4 days'
      ORDER BY t.validated_at DESC;
    `;

    console.log('Executing query...');
    const result = await client.query(query);
    console.log(`Query finished. Found ${result.rowCount} tokens.`);
    client.release();

    console.log('Mapping results...');
    const tokens = result.rows.map(row => {
      // Convert BigInt to string for JSON serialization
      const token = { ...row };
      if (token.total_supply) token.total_supply = token.total_supply.toString();
      return token;
    });

    // Correct path: services/validator/ is CWD, so ../../ is project root
    const outputPath = path.join(process.cwd(), '../../analyzed_tokens_report.json');
    console.log(`Writing to ${outputPath}...`);
    fs.writeFileSync(outputPath, JSON.stringify(tokens, null, 2));

    console.log(`Report successfully saved.`);
    console.log(`Elapsed time: ${(Date.now() - startTime) / 1000}s`);

    // Brief analysis for the user
    const approvedTokens = tokens.filter(t => t.safety_score >= 50);
    console.log(`Summary:`);
    console.log(`- Total Tokens: ${tokens.length}`);
    console.log(`- Approved (Score >= 50): ${approvedTokens.length}`);
    
    // Top 10 approved if any
    if (approvedTokens.length > 0) {
      console.log('Top 10 Approved Tokens:');
      approvedTokens.slice(0, 10).forEach(t => {
        console.log(`  - ${t.symbol} (${t.name}): Score ${t.safety_score}, Chain ${t.chain}`);
      });
    }

  } catch (error) {
    console.error('Error fetching tokens:', error);
  } finally {
    await pool.end();
  }
}

main();
