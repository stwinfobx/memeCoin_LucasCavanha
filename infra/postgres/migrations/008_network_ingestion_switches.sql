-- ======================================================
-- ⚙️ MIGRATION: 008_network_ingestion_switches
-- ======================================================

-- Inserir configurações de motor por rede
INSERT INTO system_settings (key, value, description, is_secret) VALUES
('INGESTION_BSC_ACTIVE', 'true', 'Liga/Desliga o motor de busca especificamente para a rede BSC', false),
('INGESTION_BASE_ACTIVE', 'true', 'Liga/Desliga o motor de busca especificamente para a rede BASE', false),
('INGESTION_SOLANA_ACTIVE', 'true', 'Liga/Desliga o motor de busca especificamente para a rede SOLANA', false)
ON CONFLICT (key) DO NOTHING;
