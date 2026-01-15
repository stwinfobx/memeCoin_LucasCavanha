-- ======================================================
-- MIGRATION 005: Sistema de Saques
-- ======================================================

-- Tabela de saques/retiradas
CREATE TABLE IF NOT EXISTS withdrawals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount_usd DECIMAL(20, 2) NOT NULL CHECK (amount_usd > 0),
    wallet_address VARCHAR(255) NOT NULL,
    chain VARCHAR(50) DEFAULT 'BSC' NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'processing', 'completed', 'rejected', 'failed')),
    tx_hash VARCHAR(255),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP,
    processed_at TIMESTAMP,
    rejection_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indices para performance
CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id ON withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_created ON withdrawals(created_at DESC);

-- Trigger para updated_at
CREATE TRIGGER update_withdrawals_updated_at BEFORE UPDATE ON withdrawals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comentarios
COMMENT ON TABLE withdrawals IS 'Registros de saques/retiradas de usuarios';
COMMENT ON COLUMN withdrawals.status IS 'pending: aguardando aprovacao | approved: aprovado | processing: processando | completed: concluido | rejected: rejeitado | failed: falhou';
