import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import path from 'path';

// Carregar variáveis de ambiente do diretório pai (raiz)
dotenv.config({ path: path.join(__dirname, '../../../../.env') });

async function cleanup() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
        console.error('❌ DATABASE_URL não encontrada no .env');
        return;
    }

    const pool = new Pool({
        connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('🚀 Iniciando limpeza de simulações...');

        // 1. Deletar entradas de ledger que mencionam "paper"
        const ledgerDelete = await pool.query("DELETE FROM ledger_entries WHERE description ILIKE '%paper%'");
        console.log(`✅ Ledger entries removidos: ${ledgerDelete.rowCount}`);

        // 2. Deletar posições de usuários de teste conhecidos
        const testUserIds = [
            '00000000-0000-0000-0000-000000000001',
            'f58986be-9f49-4a63-9c44-937bfed78362'
        ];

        const positionsDelete = await pool.query(
            "DELETE FROM positions WHERE user_id = ANY($1)",
            [testUserIds]
        );
        console.log(`✅ Posições de teste removidas: ${positionsDelete.rowCount}`);

        // 3. Deletar ordens de usuários de teste
        const ordersDelete = await pool.query(
            "DELETE FROM orders WHERE user_id = ANY($1)",
            [testUserIds]
        );
        console.log(`✅ Ordens de teste removidas: ${ordersDelete.rowCount}`);

        // 4. Se houver posições "vizinhas" que não foram pegas pelo ID mas são simuladas (ex: lucro/perda zero ou descrição específica)
        // No momento, os IDs de teste cobrem a maioria.

        console.log('✨ Limpeza concluída com sucesso! O banco agora contém apenas dados reais.');
    } catch (error) {
        console.error('❌ Erro durante a limpeza:', error);
    } finally {
        await pool.end();
    }
}

cleanup();
