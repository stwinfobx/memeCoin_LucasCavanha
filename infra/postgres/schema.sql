-- ======================================================
-- 🧱 SCHEMA POSTGRESQL - TradingBot de Memecoins
-- ======================================================

-- Extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ======================================================
-- 👤 TABELA: users
-- ======================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    mfa_enabled BOOLEAN DEFAULT false,
    mfa_secret VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_active ON users(is_active);

-- ======================================================
-- 👤 TABELA: user_profiles
-- ======================================================
CREATE TABLE user_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    full_name VARCHAR(255),
    phone VARCHAR(50),
    bank_account_number VARCHAR(100),
    bank_name VARCHAR(100),
    bank_routing_number VARCHAR(100),
    wallet_address VARCHAR(255),
    risk_profile VARCHAR(20) DEFAULT 'moderate' CHECK (risk_profile IN ('conservative', 'moderate', 'aggressive')),
    bot_enabled BOOLEAN DEFAULT false,
    bot_intensity INTEGER DEFAULT 5 CHECK (bot_intensity BETWEEN 1 AND 10),
    kyc_status VARCHAR(20) DEFAULT 'pending' CHECK (kyc_status IN ('pending', 'approved', 'rejected')),
    max_loss_percent DECIMAL(5,2) DEFAULT 10.00,
    max_gain_percent DECIMAL(5,2) DEFAULT 25.00,
    max_open_trades INTEGER DEFAULT 3,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX idx_user_profiles_risk ON user_profiles(risk_profile);

-- ======================================================
-- 🪙 TABELA: tokens
-- ======================================================
CREATE TABLE tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contract_address VARCHAR(255) UNIQUE NOT NULL,
    chain VARCHAR(50) DEFAULT 'BSC' NOT NULL,
    symbol VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    decimals INTEGER DEFAULT 18,
    total_supply NUMERIC(78, 0),
    liquidity_usd DECIMAL(20, 2),
    liquidity_locked BOOLEAN DEFAULT false,
    holders_count INTEGER DEFAULT 0,
    volume_24h_usd DECIMAL(20, 2) DEFAULT 0,
    price_usd DECIMAL(20, 10),
    safety_score INTEGER CHECK (safety_score BETWEEN 0 AND 100),
    is_honeypot BOOLEAN DEFAULT false,
    is_validated BOOLEAN DEFAULT false,
    validated_at TIMESTAMP,
    first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tokens_address ON tokens(contract_address);
CREATE INDEX idx_tokens_chain ON tokens(chain);
CREATE INDEX idx_tokens_validated ON tokens(is_validated);
CREATE INDEX idx_tokens_safety_score ON tokens(safety_score DESC);

-- ======================================================
-- 📊 TABELA: signals
-- ======================================================
CREATE TABLE signals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token_id UUID NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
    signal_type VARCHAR(10) NOT NULL CHECK (signal_type IN ('BUY', 'SELL', 'HOLD')),
    confidence_score DECIMAL(5,2) CHECK (confidence_score BETWEEN 0 AND 100),
    potential_multiplier DECIMAL(4,2), -- 2x, 3x, 4x etc
    volume_score DECIMAL(5,2),
    liquidity_score DECIMAL(5,2),
    holders_score DECIMAL(5,2),
    age_score DECIMAL(5,2),
    safety_score DECIMAL(5,2),
    overall_score DECIMAL(5,2),
    price_at_signal DECIMAL(20, 10),
    reasoning TEXT,
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_signals_token_id ON signals(token_id);
CREATE INDEX idx_signals_type ON signals(signal_type);
CREATE INDEX idx_signals_active ON signals(is_active) WHERE is_active = true;
CREATE INDEX idx_signals_created ON signals(created_at DESC);

-- ======================================================
-- 💰 TABELA: orders
-- ======================================================
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_id UUID NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
    signal_id UUID REFERENCES signals(id),
    order_type VARCHAR(10) NOT NULL CHECK (order_type IN ('BUY', 'SELL')),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'executing', 'completed', 'failed', 'cancelled')),
    amount_usd DECIMAL(20, 2) NOT NULL,
    amount_token DECIMAL(40, 18),
    price_usd DECIMAL(20, 10),
    transaction_hash VARCHAR(255),
    gas_used NUMERIC(20, 0),
    gas_price NUMERIC(20, 0),
    block_number NUMERIC(20, 0),
    executed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_token_id ON orders(token_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created ON orders(created_at DESC);
CREATE INDEX idx_orders_type ON orders(order_type);

-- ======================================================
-- 📈 TABELA: ledger_entries
-- ======================================================
CREATE TABLE ledger_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_id UUID REFERENCES orders(id),
    entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('deposit', 'withdrawal', 'trade_profit', 'trade_loss', 'fee', 'gas')),
    amount_usd DECIMAL(20, 2) NOT NULL,
    balance_before DECIMAL(20, 2),
    balance_after DECIMAL(20, 2),
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ledger_user_id ON ledger_entries(user_id);
CREATE INDEX idx_ledger_order_id ON ledger_entries(order_id);
CREATE INDEX idx_ledger_type ON ledger_entries(entry_type);
CREATE INDEX idx_ledger_created ON ledger_entries(created_at DESC);

-- ======================================================
-- 🔍 TABELA: audit_logs
-- ======================================================
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id UUID,
    ip_address VARCHAR(45),
    user_agent TEXT,
    request_data JSONB,
    response_data JSONB,
    status_code INTEGER,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id);

-- ======================================================
-- 🔄 TRIGGERS: updated_at automático
-- ======================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tokens_updated_at BEFORE UPDATE ON tokens
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ======================================================
-- ⚠️ TABELA: token_risk_assessments
-- ======================================================
CREATE TABLE token_risk_assessments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token_id UUID NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
    contract_address VARCHAR(255) NOT NULL,
    chain VARCHAR(50) NOT NULL,
    memecoin_score DECIMAL(5,2) NOT NULL,
    risk_score DECIMAL(5,2) NOT NULL,
    scam_probability DECIMAL(5,2) NOT NULL,
    risk_level VARCHAR(32) NOT NULL,
    indicators JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_token_risk_assessments_token_id ON token_risk_assessments(token_id);
CREATE INDEX idx_token_risk_assessments_contract_chain ON token_risk_assessments(contract_address, chain);

CREATE TRIGGER update_token_risk_assessments_updated_at BEFORE UPDATE ON token_risk_assessments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ======================================================
-- 📊 VIEWS ÚTEIS
-- ======================================================

-- View: Posições abertas por usuário
CREATE OR REPLACE VIEW open_positions AS
SELECT 
    o.user_id,
    o.token_id,
    t.symbol,
    t.name,
    SUM(CASE WHEN o.order_type = 'BUY' THEN o.amount_usd ELSE -o.amount_usd END) as invested_usd,
    SUM(CASE WHEN o.order_type = 'BUY' THEN o.amount_token ELSE -o.amount_token END) as token_balance,
    AVG(CASE WHEN o.order_type = 'BUY' THEN o.price_usd END) as avg_buy_price,
    (SELECT price_usd FROM tokens WHERE id = o.token_id) as current_price,
    COUNT(*) as trade_count
FROM orders o
JOIN tokens t ON o.token_id = t.id
WHERE o.status = 'completed'
GROUP BY o.user_id, o.token_id, t.symbol, t.name
HAVING SUM(CASE WHEN o.order_type = 'BUY' THEN o.amount_token ELSE -o.amount_token END) > 0;

-- View: Performance do usuário
CREATE OR REPLACE VIEW user_performance AS
SELECT 
    u.id as user_id,
    u.email,
    COALESCE(SUM(CASE WHEN le.entry_type IN ('trade_profit', 'deposit') THEN le.amount_usd ELSE 0 END), 0) as total_deposits,
    COALESCE(SUM(CASE WHEN le.entry_type IN ('trade_loss', 'withdrawal', 'fee', 'gas') THEN le.amount_usd ELSE 0 END), 0) as total_withdrawals,
    COALESCE(SUM(CASE WHEN le.entry_type = 'trade_profit' THEN le.amount_usd ELSE 0 END), 0) as total_profit,
    COALESCE(SUM(CASE WHEN le.entry_type = 'trade_loss' THEN le.amount_usd ELSE 0 END), 0) as total_loss,
    COUNT(DISTINCT o.id) as total_trades,
    COUNT(DISTINCT CASE WHEN o.status = 'completed' THEN o.id END) as completed_trades
FROM users u
LEFT JOIN ledger_entries le ON u.id = le.user_id
LEFT JOIN orders o ON u.id = o.user_id
GROUP BY u.id, u.email;
