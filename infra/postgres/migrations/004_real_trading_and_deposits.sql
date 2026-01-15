-- Migration: Adicionar campo real_trading_enabled em user_profiles
-- Data: 2026-01-14
-- Descrição: Adiciona campo para controlar se o usuário usa trading real ou apenas paper trading

-- Adicionar campo real_trading_enabled
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS real_trading_enabled BOOLEAN DEFAULT false;

-- Adicionar comentário
COMMENT ON COLUMN user_profiles.real_trading_enabled IS 
'Define se o usuário usa trading real (true) ou apenas paper trading/simulação (false)';

-- Garantir que campo tx_hash em deposits seja sempre lowercase
CREATE OR REPLACE FUNCTION lowercase_tx_hash()
RETURNS TRIGGER AS $$
BEGIN
  NEW.tx_hash = LOWER(NEW.tx_hash);
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger para garantir tx_hash lowercase
CREATE TRIGGER ensure_lowercase_tx_hash
BEFORE INSERT OR UPDATE ON deposits
FOR EACH ROW EXECUTE FUNCTION lowercase_tx_hash();

-- Criar índice para busca rápida de status pending
CREATE INDEX IF NOT EXISTS idx_deposits_status_pending 
ON deposits(status, created_at) 
WHERE status = 'pending';

-- Criar índice para tx_hash
CREATE INDEX IF NOT EXISTS idx_deposits_tx_hash_lower 
ON deposits(LOWER(tx_hash));
