-- ======================================================
-- ⚙️ TABELA: system_settings
-- ======================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    is_secret BOOLEAN DEFAULT false,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Inserir configurações iniciais
INSERT INTO system_settings (key, value, description, is_secret) VALUES
('VALIDATOR_ENGINE_ACTIVE', 'true', 'Liga/Desliga o motor de busca e validação de tokens', false),
('HELIUS_API_KEY', '', 'API Key do Helius (Solana)', true),
('GOPLUS_API_KEY', '', 'API Key do GoPlus Security', true),
('RUGCHECK_API_KEY', '', 'API Key do RugCheck', true),
('BSCSCAN_API_KEY', '', 'API Key do BSCScan', true),
('BASESCAN_API_KEY', '', 'API Key do BaseScan', true),
('SOLSCAN_API_KEY', '', 'API Key do Solscan', true)
ON CONFLICT (key) DO NOTHING;

-- Trigger para updated_at
CREATE TRIGGER update_system_settings_updated_at BEFORE UPDATE ON system_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
