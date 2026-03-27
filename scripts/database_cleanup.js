
const { Client } = require('pg');
require('dotenv').config();

async function run() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    try {
        await client.connect();
        
        // Finalize zombie positions from more than 7 days ago
        const resOld = await client.query(`
            UPDATE positions 
            SET status = 'closed_rugged', updated_at = NOW() 
            WHERE status = 'open' AND buy_time < NOW() - INTERVAL '7 days'
            RETURNING id, symbol
        `);
        console.log(`[Cleanup] Marked ${resOld.rowCount} zombie positions (> 7 days) as closed_rugged.`);
        
        if (resOld.rows.length > 0) {
            console.log('Processed positions:', resOld.rows.map(r => r.symbol).join(', '));
        }

    } catch (e) {
        console.error('Error during cleanup:', e);
    } finally {
        await client.end();
    }
}
run();
