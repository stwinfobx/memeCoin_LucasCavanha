// Script para aplicar migration 004_real_trading_and_deposits.sql
require('dotenv').config();
const { Pool } = require('pg');

async function applyMigration() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
    });

    const client = await pool.connect();

    try {
        console.log('🔧 Applying migration 004_real_trading_and_deposits...');

        // 1. Adicionar campo real_trading_enabled
        await client.query(`
      ALTER TABLE user_profiles 
      ADD COLUMN IF NOT EXISTS real_trading_enabled BOOLEAN DEFAULT false
    `);
        console.log('✅ Campo real_trading_enabled adicionado');

        // 2. Adicionar comentário
        await client.query(`
      COMMENT ON COLUMN user_profiles.real_trading_enabled IS 
      'Define se o usuário usa trading real (true) ou apenas paper trading/simulação (false)'
    `);

        // 3. Criar função para lowercase tx_hash
        await client.query(`
      CREATE OR REPLACE FUNCTION lowercase_tx_hash()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.tx_hash = LOWER(NEW.tx_hash);
        RETURN NEW;
      END;
      $$ language 'plpgsql'
    `);
        console.log('✅ Função lowercase_tx_hash criada');

        // 4. Criar trigger
        await client.query(`
      DROP TRIGGER IF EXISTS ensure_lowercase_tx_hash ON deposits
    `);
        await client.query(`
      CREATE TRIGGER ensure_lowercase_tx_hash
      BEFORE INSERT OR UPDATE ON deposits
      FOR EACH ROW EXECUTE FUNCTION lowercase_tx_hash()
    `);
        console.log('✅ Trigger ensure_lowercase_tx_hash criado');

        // 5. Criar índices
        await client.query(`
      CREATE INDEX IF NOT EXISTS idx_deposits_status_pending 
      ON deposits(status, created_at) 
      WHERE status = 'pending'
    `);
        console.log('✅ Índice idx_deposits_status_pending criado');

        await client.query(`
      CREATE INDEX IF NOT EXISTS idx_deposits_tx_hash_lower 
      ON deposits(LOWER(tx_hash))
    `);
        console.log('✅ Índice idx_deposits_tx_hash_lower criado');

        console.log('\n🎉 Migration 004 applied successfully!');
    } catch (error) {
        console.error('❌ Error applying migration:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

applyMigration();
