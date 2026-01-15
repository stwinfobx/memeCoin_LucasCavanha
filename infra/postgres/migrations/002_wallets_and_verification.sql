-- Migration: Adicionar tabela de wallets e depositos
-- Data: 2026-01-13

-- Tabela para armazenar wallets criptografadas
CREATE TABLE IF NOT EXISTS user_wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encrypted_private_key TEXT NOT NULL,
  wallet_address VARCHAR(255) NOT NULL,
  chain VARCHAR(50) DEFAULT 'BSC' NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, chain)
);

-- Tabela para rastrear depósitos
CREATE TABLE IF NOT EXISTS deposits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_address VARCHAR(255) NOT NULL,
  chain VARCHAR(50) NOT NULL,
  tx_hash VARCHAR(255) UNIQUE NOT NULL,
  amount_crypto DECIMAL(40, 18) NOT NULL,
  amount_usd DECIMAL(20, 2) NOT NULL,
  token_symbol VARCHAR(10) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  confirmations INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TIMESTAMP
);

-- Adicionar campos de verificação de email na tabela users
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS email_verification_token VARCHAR(255),
ADD COLUMN IF NOT EXISTS email_verification_expires TIMESTAMP,
ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR(255),
ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMP;

-- Adicionar campo trading_strategy em user_profiles para modo agressivo
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS trading_strategy VARCHAR(30) DEFAULT 'scoring_based'
CHECK (trading_strategy IN ('scoring_based', 'auto_buy_verified'));

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_wallets_user ON user_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_wallets_address ON user_wallets(wallet_address);
CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status);
CREATE INDEX IF NOT EXISTS idx_deposits_tx_hash ON deposits(tx_hash);
CREATE INDEX IF NOT EXISTS idx_users_email_token ON users(email_verification_token);
CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(password_reset_token);

COMMENT ON TABLE user_wallets IS 'Armazena chaves privadas criptografadas com AES-256-GCM';
COMMENT ON TABLE deposits IS 'Rastreia depósitos on-chain com confirmações';
COMMENT ON COLUMN user_profiles.trading_strategy IS 'scoring_based: usa sinais | auto_buy_verified: compra tudo validado';
