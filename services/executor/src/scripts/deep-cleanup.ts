import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import path from 'path';

// Carrega o .env da raiz
dotenv.config({ path: path.join(__dirname, '../../../../.env') });

async function runCleanup() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('🧹 [1/3] Limpando todas as posições abertas...');
        await pool.query('TRUNCATE TABLE positions CASCADE');

        console.log('🧹 [2/3] Limpando histórico de ordens...');
        await pool.query('TRUNCATE TABLE orders CASCADE');

        console.log('🧹 [2.5] Limpando logs de notificações...');
        await pool.query('TRUNCATE TABLE bot_notifications CASCADE');

        console.log('🧹 [3/3] Removendo depósitos de "paper trading" de todos os usuários...');
        const ledgerResult = await pool.query("DELETE FROM ledger_entries WHERE description ILIKE '%paper%' OR user_id = '00000000-0000-0000-0000-000000000001'");

        console.log(`✅ Sucesso! Removidas ${ledgerResult.rowCount} entradas de saldo fictício.`);
        console.log('✨ O banco agora está totalmente limpo para o modo Real.');
    } catch (error) {
        console.error('❌ Erro na limpeza:', error);
    } finally {
        await pool.end();
    }
}

runCleanup();
