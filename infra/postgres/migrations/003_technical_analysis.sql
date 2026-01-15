-- Migration: Adicionar suporte para análise técnica e histórico de preços
-- Data: 2026-01-13

-- Tabela para armazenar histórico de preços (candles OHLCV)
CREATE TABLE IF NOT EXISTS price_candles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token_id UUID NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
  interval VARCHAR(5) NOT NULL, -- '1m', '5m', '15m', '1h', '4h', '1d'
  timestamp TIMESTAMP NOT NULL,
  open_price DECIMAL(20, 10) NOT NULL,
  high_price DECIMAL(20, 10) NOT NULL,
  low_price DECIMAL(20, 10) NOT NULL,
  close_price DECIMAL(20, 10) NOT NULL,
  volume_usd DECIMAL(20, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(token_id, interval, timestamp)
);

-- Índices para consultas rápidas de candles
CREATE INDEX IF NOT EXISTS idx_candles_token_interval ON price_candles(token_id, interval);
CREATE INDEX IF NOT EXISTS idx_candles_timestamp ON price_candles(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_candles_token_interval_time ON price_candles(token_id, interval, timestamp DESC);

-- View para últimos preços por intervalo
CREATE OR REPLACE VIEW latest_candles AS
SELECT DISTINCT ON (token_id, interval)
  token_id,
  interval,
  timestamp,
  close_price as current_price,
  volume_usd
FROM price_candles
ORDER BY token_id, interval, timestamp DESC;

COMMENT ON TABLE price_candles IS 'Histórico de preços OHLCV para análise técnica';
COMMENT ON VIEW latest_candles IS 'View otimizada para obter o último preço de cada token por intervalo';
