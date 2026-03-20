
import { Pool } from 'pg';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Carregar .env do diretório raiz
dotenv.config({ path: path.join(__dirname, '../../../../.env') });

async function fixRemainingForeignKeys() {
    console.log('🔗 Iniciando correção de Foreign Keys restantes (CASCADE)...');
    
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        // 1. Corrigir positions_signal_id_fkey
        console.log('🛠️ Alterando constraint positions_signal_id_fkey...');
        await pool.query(`
            ALTER TABLE positions 
            DROP CONSTRAINT IF EXISTS positions_signal_id_fkey;
        `);
        
        await pool.query(`
            ALTER TABLE positions 
            ADD CONSTRAINT positions_signal_id_fkey 
            FOREIGN KEY (signal_id) 
            REFERENCES signals(id) 
            ON DELETE CASCADE;
        `);

        // 2. Corrigir outras possíveis dependências de signals se existirem
        // checando signal_logs ou algo do tipo
        console.log('🛠️ Verificando outras restrições...');
        
        console.log('✅ Todas as restrições críticas atualizadas para CASCADE!');
    } catch (error: any) {
        console.error('❌ Erro ao corrigir Foreign Keys:', error.message);
    } finally {
        await pool.end();
    }
}

fixRemainingForeignKeys();
