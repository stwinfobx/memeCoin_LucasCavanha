
import { Pool } from 'pg';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Carregar .env do diretório raiz
dotenv.config({ path: path.join(__dirname, '../../../../.env') });

async function fixForeignKey() {
    console.log('🔗 Iniciando correção de Foreign Key (CASCADE)...');
    
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        // Tentar alterar a constraint para ON DELETE CASCADE
        console.log('🛠️ Alterando constraint orders_signal_id_fkey...');
        
        // 1. Remover a constraint atual
        await pool.query(`
            ALTER TABLE orders 
            DROP CONSTRAINT IF EXISTS orders_signal_id_fkey;
        `);
        
        // 2. Adicionar a constraint com ON DELETE CASCADE
        await pool.query(`
            ALTER TABLE orders 
            ADD CONSTRAINT orders_signal_id_fkey 
            FOREIGN KEY (signal_id) 
            REFERENCES signals(id) 
            ON DELETE CASCADE;
        `);

        console.log('✅ Constraint orders_signal_id_fkey atualizada para CASCADE!');

        // Fazer o mesmo para outras tabelas que dependem de signals se necessário
        // Por exemplo, signal_logs ou posts se existirem
        
        console.log('🚀 Banco de dados pronto para limpeza automática.');
    } catch (error: any) {
        console.error('❌ Erro ao corrigir Foreign Key:', error.message);
    } finally {
        await pool.end();
    }
}

fixForeignKey();
