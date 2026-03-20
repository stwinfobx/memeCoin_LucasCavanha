
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  console.log('Fetching tokens analyzed in the last 4 days...');

  try {
    const query = `
      SELECT t.*, tra.memecoin_score, tra.risk_score, tra.scam_probability, tra.risk_level, tra.indicators 
      FROM tokens t
      LEFT JOIN token_risk_assessments tra ON t.id = tra.token_id
      WHERE t.validated_at >= NOW() - INTERVAL '4 days'
      ORDER BY t.validated_at DESC;
    `;

    const result = await pool.query(query);
    console.log(`Found ${result.rowCount} tokens.`);

    const tokens = result.rows.map(row => {
      // Convert BigInt to string for JSON serialization
      const token = { ...row };
      if (token.total_supply) token.total_supply = token.total_supply.toString();
      return token;
    });

    const outputPath = path.join(process.cwd(), 'analyzed_tokens_report.json');
    fs.writeFileSync(outputPath, JSON.stringify(tokens, null, 2));

    console.log(`Report saved to ${outputPath}`);

    // Brief analysis for the user
    const approvedTokens = tokens.filter(t => t.safety_score >= 50);
    console.log(`Summary:`);
    console.log(`- Total Tokens: ${tokens.length}`);
    console.log(`- Approved (Score >= 50): ${approvedTokens.length}`);
    
    // Top 5 approved if any
    if (approvedTokens.length > 0) {
      console.log('Top 5 Approved Tokens:');
      approvedTokens.slice(0, 5).forEach(t => {
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
