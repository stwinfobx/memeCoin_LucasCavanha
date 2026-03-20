
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

// Point to the compiled validator
const { TokenValidator } = require('../dist/services/validator/src/validator');

async function testTokens() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    const validator = new TokenValidator(pool);
    
    const tokens = [
        { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', chain: 'BASE' },
        { address: '0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82', chain: 'BASE' }, 
        { address: '0xb30540172F1B37d1eE1d109e49F883E935E69219', chain: 'BASE' }
    ];

    console.log('--- STARTING SURGICAL VALIDATION TEST (V3) ---');
    
    for (const t of tokens) {
        console.log(`\nValidating ${t.address} on ${t.chain}...`);
        try {
            const result = await validator.validateToken(t.address, t.chain);
            console.log(`RESULT for ${result.token?.symbol || 'Unknown'} (${result.token?.name}):`);
            console.log(`- Safety Score: ${result.validation_result?.safety_score}`);
            console.log(`- Is Valid (Threshold 80): ${result.validation_result?.is_valid ? '✅ YES' : '❌ NO'}`);
            if (result.risk_assessment) {
                console.log(`- Risk Level: ${result.risk_assessment.risk_level}`);
                console.log(`- Reasons:`, result.risk_assessment.indicators?.rejectionReasons || 'NONE');
            }
        } catch (err) {
            console.error(`Failed to validate ${t.address}:`, err.message);
        }
    }

    await pool.end();
}

testTokens();
