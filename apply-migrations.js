// Script para aplicar migrations usando Node.js
// Usa a biblioteca pg que ja esta instalada no projeto

const fs = require('fs');
const { Pool } = require('pg');

// Configuracao do banco (Supabase)
const pool = new Pool({
    host: 'db.izyvctoikuxzmbwiyifo.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: '9TKBZv9wBf4bmL2X',
    ssl: { rejectUnauthorized: false }
});

async function applyMigrations() {
    console.log('[*] Aplicando Migrations do TradingBot...\n');

    const migrations = [
        {
            name: '002_wallets_and_verification',
            path: 'infra/postgres/migrations/002_wallets_and_verification.sql'
        },
        {
            name: '003_technical_analysis',
            path: 'infra/postgres/migrations/003_technical_analysis.sql'
        }
    ];

    for (const migration of migrations) {
        console.log(`[*] Aplicando ${migration.name}.sql...`);

        try {
            // Ler arquivo SQL
            const sql = fs.readFileSync(migration.path, 'utf8');

            // Executar migration
            await pool.query(sql);

            console.log(`[+] Migration ${migration.name} aplicada com sucesso!\n`);
        } catch (error) {
            console.error(`[!] Erro ao aplicar ${migration.name}:`);
            console.error(error.message);
            console.error('');

            // Se a tabela ja existe, nao e um erro critico
            if (error.message.includes('already exists')) {
                console.log(`[i] A tabela ja existe, continuando...\n`);
            } else {
                // Outros erros podem ser mais serios
                console.log(`[!] Verifique o erro acima. Continuando com proxima migration...\n`);
            }
        }
    }

    console.log('[+] Processo de migrations concluido!');
    await pool.end();
}

// Executar
applyMigrations().catch(err => {
    console.error('[!] Erro fatal:', err);
    process.exit(1);
});
