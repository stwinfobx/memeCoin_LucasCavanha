-- ======================================================
-- Migration: Add bot notifications/logs table
-- ======================================================

-- Create bot_notifications table
CREATE TABLE IF NOT EXISTS bot_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    notification_type VARCHAR(50) NOT NULL CHECK (notification_type IN (
        'token_validated',
        'signal_generated',
        'order_executed',
        'position_opened',
        'position_closed',
        'profit_realized',
        'loss_realized',
        'take_profit_hit',
        'stop_loss_hit',
        'monitoring_check',
        'error_occurred',
        'bot_started',
        'bot_stopped',
        'config_updated'
    )),
    severity VARCHAR(20) DEFAULT 'info' CHECK (severity IN ('success', 'info', 'warning', 'error')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    data JSONB,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_bot_notifications_user_id ON bot_notifications(user_id);
CREATE INDEX idx_bot_notifications_type ON bot_notifications(notification_type);
CREATE INDEX idx_bot_notifications_created ON bot_notifications(created_at DESC);
CREATE INDEX idx_bot_notifications_unread ON bot_notifications(user_id, is_read) WHERE is_read = false;

-- Function to create notification (can be called from backend)
CREATE OR REPLACE FUNCTION create_bot_notification(
    p_user_id UUID,
    p_notification_type VARCHAR(50),
    p_severity VARCHAR(20),
    p_title TEXT,
    p_message TEXT,
    p_data JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_notification_id UUID;
BEGIN
    INSERT INTO bot_notifications (
        user_id, notification_type, severity, title, message, data
    ) VALUES (
        p_user_id, p_notification_type, p_severity, p_title, p_message, p_data
    )
    RETURNING id INTO v_notification_id;
    
    RETURN v_notification_id;
END;
$$ LANGUAGE plpgsql;

