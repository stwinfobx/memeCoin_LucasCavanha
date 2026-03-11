import { Pool } from 'pg';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function enableAndClean() {
    const adminId = 'a68bb4f9-7b93-496d-8a45-94b55c712f00';
    const defaultUser = '00000000-0000-0000-0000-000000000001';

    try {
        console.log('🚀 Ativando bot para Admin e Default User...');
        await pool.query('UPDATE users SET bot_enabled = true WHERE id IN ($1, $2)', [adminId, defaultUser]);

        console.log('🧹 Limpando posições antigas e mortas (ROLL, FIGHT, 1)...');
        await pool.query(`
            UPDATE positions 
            SET status = 'closed', 
                sell_price = 0, 
                sell_time = NOW(), 
                pnl_percent = -100 
            WHERE symbol IN ('ROLL', 'FIGHT', '1') AND status = 'open'
        `);

        console.log('✅ Pronto! Reinicie os serviços e observe os logs.');
    } catch (e) {
        console.error('❌ Erro:', e);
    } finally {
        await pool.end();
    }
}

enableAndClean();
