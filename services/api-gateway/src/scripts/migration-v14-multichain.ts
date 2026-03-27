import { Pool } from 'pg';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Carregar .env do diretório raiz
dotenv.config({ path: path.join(__dirname, '../../../../.env') });

async function migrateMultiChain() {
    console.log('🚀 Iniciando Migração V14: Multi-Chain Treasury...');
    
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        // 1. Adicionar colunas de saldo por rede na tabela users
        console.log('📊 Adicionando colunas de saldo na tabela users...');
        await pool.query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS balance_bsc NUMERIC(20, 8) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS balance_base NUMERIC(20, 8) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS balance_solana NUMERIC(20, 8) DEFAULT 0;
        `);

        // 2. Adicionar coluna chain na tabela ledger_entries para rastreio
        console.log('🔗 Adicionando coluna chain na tabela ledger_entries...');
        await pool.query(`
            ALTER TABLE ledger_entries 
            ADD COLUMN IF NOT EXISTS chain VARCHAR(20) DEFAULT 'BSC';
        `);

        // 3. Atualizar View user_performance para considerar múltiplos saldos (opcional, faremos no router depois)
        
        console.log('✅ Migração V14 concluída com sucesso!');
    } catch (error: any) {
        console.error('❌ Erro na migração V14:', error.message);
    } finally {
        await pool.end();
    }
}

migrateMultiChain();
