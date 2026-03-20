import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Carregar .env do diretório raiz
dotenv.config({ path: path.join(__dirname, '../../../../.env') });

const connectionString = process.env.DATABASE_URL;

async function migrate() {
  if (!connectionString) {
    console.error('❌ DATABASE_URL não encontrada no .env');
    return;
  }

  const url = new URL(connectionString);
  console.log(`📡 Conectando a: ${url.hostname}`);

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  console.log('🚀 Iniciando migração V7...');

  try {
    const client = await pool.connect();
    
    console.log('✅ Conectado ao banco de dados.');

    // 1. Adicionar peak_liquidity_usd em positions
    console.log('Adding peak_liquidity_usd to positions...');
    await client.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='positions' AND column_name='peak_liquidity_usd') THEN
          ALTER TABLE positions ADD COLUMN peak_liquidity_usd DECIMAL(20, 2);
        END IF;
      END $$;
    `);

    // 2. Adicionar liquidity_drop_threshold em user_profiles
    console.log('Adding liquidity_drop_threshold to user_profiles...');
    await client.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_profiles' AND column_name='liquidity_drop_threshold') THEN
          ALTER TABLE user_profiles ADD COLUMN liquidity_drop_threshold DECIMAL(5, 2) DEFAULT 20.00;
        END IF;
      END $$;
    `);

    // 3. Atualizar default de max_gain_percent
    console.log('Updating max_gain_percent default...');
    await client.query(`
      ALTER TABLE user_profiles ALTER COLUMN max_gain_percent SET DEFAULT 50.00;
    `);

    console.log('🎉 Migração V7 concluída com sucesso!');
    client.release();
  } catch (err) {
    console.error('❌ Erro na migração:', err);
  } finally {
    await pool.end();
  }
}

migrate();
