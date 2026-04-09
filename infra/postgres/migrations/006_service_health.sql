-- Tabela para monitorar a saúde das APIs de terceiros
CREATE TABLE IF NOT EXISTS service_health (
    service_name VARCHAR(50) PRIMARY KEY, -- 'HELIUS', 'GOPLUS', 'GECKO', 'SOLSCAN'
    status VARCHAR(20) NOT NULL DEFAULT 'online', -- 'online', 'error', 'rate_limited'
    last_error TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Inserir estados iniciais
INSERT INTO service_health (service_name, status) VALUES 
('HELIUS', 'online'),
('GOPLUS', 'online'),
('GECKO', 'online'),
('SOLSCAN', 'online')
ON CONFLICT (service_name) DO NOTHING;

-- Trigger para atualizar o updated_at
CREATE TRIGGER update_service_health_updated_at
BEFORE UPDATE ON service_health
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
