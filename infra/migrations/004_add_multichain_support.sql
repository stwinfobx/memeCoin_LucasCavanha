-- Migration: Add Multi-Chain Support
-- Created: 2026-02-12
-- Description: Adiciona suporte para múltiplas blockchains (BSC, Solana, Base)

-- ======================================================
-- 1. Adicionar coluna 'chain' em tabelas existentes
-- ======================================================

-- Tabela de tokens
ALTER TABLE tokens 
  ADD COLUMN IF NOT EXISTS chain VARCHAR(20) DEFAULT 'BSC';

-- Atualizar tokens existentes para BSC
UPDATE tokens SET chain = 'BSC' WHERE chain IS NULL;

-- Tornar coluna NOT NULL após migração
ALTER TABLE tokens 
  ALTER COLUMN chain SET NOT NULL;

-- ======================================================
-- 2. Índices para performance em queries multi-chain
-- ======================================================

-- Índice para busca por chain
CREATE INDEX IF NOT EXISTS idx_tokens_chain 
  ON tokens(chain);

-- Índice composto para busca por contrato + chain (única combinação)
CREATE INDEX IF NOT EXISTS idx_tokens_contract_chain 
  ON tokens(contract_address, chain);

-- Drop do índice antigo se existir (contract_address não é mais único sozinho)
DROP INDEX IF EXISTS idx_tokens_contract_address;

-- ======================================================
-- 3. Tabela de Configuração de Chains
-- ======================================================

CREATE TABLE IF NOT EXISTS chain_configs (
  chain VARCHAR(20) PRIMARY KEY,
  enabled BOOLEAN DEFAULT true,
  rpc_url TEXT NOT NULL,
  fallback_rpc_url TEXT,
  explorer_url TEXT,
  explorer_api_key TEXT,
  native_token VARCHAR(10) NOT NULL,
  native_token_decimals INTEGER DEFAULT 18,
  
  -- Configurações específicas de cada chain (JSON)
  config JSONB DEFAULT '{}',
  
  -- Estatísticas
  last_block_scanned BIGINT,
  last_scan_at TIMESTAMP,
  
  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ======================================================
-- 4. Inserir configurações iniciais por chain
-- ======================================================

INSERT INTO chain_configs (
  chain, 
  enabled, 
  rpc_url, 
  explorer_url, 
  native_token,
  native_token_decimals,
  config
) VALUES
  (
    'BSC',
    true,
    'https://bsc-dataseed1.binance.org',
    'https://bscscan.com',
    'BNB',
    18,
    '{"dex": "pancakeswap", "router": "0x10ED43C718714eb63d5aA57B78B54704E256024E"}'::jsonb
  ),
  (
    'SOLANA',
    true,
    'https://api.mainnet-beta.solana.com',
    'https://solscan.io',
    'SOL',
    9,
    '{"dex": "jupiter", "commitment": "confirmed"}'::jsonb
  ),
  (
    'BASE',
    true,
    'https://mainnet.base.org',
    'https://basescan.org',
    'ETH',
    18,
    '{"dex": "uniswap_v3", "router": "0x2626664c2603336E57B271c5C0b26F421741e481"}'::jsonb
  )
ON CONFLICT (chain) DO NOTHING;

-- ======================================================
-- 5. Atualizar tabela de user_wallets (se existir)
-- ======================================================

-- Verificar se user_wallets existe e adicionar suporte multi-chain
DO $$ 
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'user_wallets') THEN
    -- Adicionar coluna chain se não existir
    ALTER TABLE user_wallets 
      ADD COLUMN IF NOT EXISTS chain VARCHAR(20) DEFAULT 'BSC';
    
    -- Criar constraint única para user_id + chain
    ALTER TABLE user_wallets
      DROP CONSTRAINT IF EXISTS user_wallets_user_id_chain_key;
    
    ALTER TABLE user_wallets
      ADD CONSTRAINT user_wallets_user_id_chain_key 
      UNIQUE (user_id, chain);
  END IF;
END $$;

-- ======================================================
-- 6. Atualizar tabela de trades (se existir)
-- ======================================================

DO $$ 
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'trades') THEN
    -- Adicionar coluna chain
    ALTER TABLE trades 
      ADD COLUMN IF NOT EXISTS chain VARCHAR(20) DEFAULT 'BSC';
    
    -- Criar índice
    CREATE INDEX IF NOT EXISTS idx_trades_chain 
      ON trades(chain);
  END IF;
END $$;

-- ======================================================
-- 7. View: Estatísticas por Chain
-- ======================================================

CREATE OR REPLACE VIEW chain_statistics AS
SELECT 
  t.chain,
  COUNT(DISTINCT t.id) as total_tokens,
  COUNT(DISTINCT CASE WHEN t.validation_result->>'is_valid' = 'true' THEN t.id END) as valid_tokens,
  AVG((t.validation_result->>'safety_score')::numeric) as avg_safety_score,
  SUM((t.liquidity_usd)::numeric) as total_liquidity_usd,
  COUNT(DISTINCT CASE WHEN t.validated_at > NOW() - INTERVAL '24 hours' THEN t.id END) as tokens_last_24h,
  cc.enabled as chain_enabled,
  cc.last_scan_at
FROM tokens t
LEFT JOIN chain_configs cc ON t.chain = cc.chain
GROUP BY t.chain, cc.enabled, cc.last_scan_at;

-- ======================================================
-- ROLLBACK INSTRUCTIONS (comentado)
-- ======================================================

-- Para reverter esta migração:
-- DROP VIEW IF EXISTS chain_statistics;
-- ALTER TABLE tokens DROP COLUMN IF EXISTS chain;
-- ALTER TABLE user_wallets DROP COLUMN IF EXISTS chain;
-- ALTER TABLE trades DROP COLUMN IF EXISTS chain;
-- DROP TABLE IF EXISTS chain_configs;
