-- ======================================================
-- Migration: Add positions table and order fields
-- ======================================================

-- Add fields to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS invested_amount_usd DECIMAL(20, 2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS profit_loss_usd DECIMAL(20, 2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS profit_loss_percent DECIMAL(8, 4);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS hold_time_hours DECIMAL(10, 2);

CREATE INDEX IF NOT EXISTS idx_orders_invested ON orders(invested_amount_usd) WHERE invested_amount_usd IS NOT NULL;

-- Create positions table
CREATE TABLE IF NOT EXISTS positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_id UUID NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
    order_id UUID REFERENCES orders(id),
    signal_id UUID REFERENCES signals(id),
    invested_amount_usd DECIMAL(20, 2) NOT NULL,
    buy_price_usd DECIMAL(20, 10) NOT NULL,
    buy_time TIMESTAMP NOT NULL,
    current_price_usd DECIMAL(20, 10),
    token_balance DECIMAL(40, 18) NOT NULL,
    hold_time_hours DECIMAL(10, 2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    closed_at TIMESTAMP,
    profit_loss_usd DECIMAL(20, 2),
    profit_loss_percent DECIMAL(8, 4),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_positions_user_id ON positions(user_id);
CREATE INDEX idx_positions_token_id ON positions(token_id);
CREATE INDEX idx_positions_status ON positions(status);
CREATE INDEX idx_positions_open ON positions(user_id, status) WHERE status = 'open';
CREATE INDEX idx_positions_created ON positions(created_at DESC);

CREATE TRIGGER update_positions_updated_at BEFORE UPDATE ON positions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

