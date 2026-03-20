-- ============================================================
-- Script para desabilitar usuário de teste e limpar suas operações
-- ============================================================

-- 1. Desabilitar o bot do usuário de teste
UPDATE user_profiles 
SET bot_enabled = false 
WHERE user_id = '00000000-0000-0000-0000-000000000001';

-- 2. Fechar todas as posições abertas desse usuário
UPDATE orders 
SET 
    status = 'closed',
    exit_price = current_price,
    exit_time = NOW(),
    profit_loss = (current_price - entry_price) * amount,
    updated_at = NOW()
WHERE 
    user_id = '00000000-0000-0000-0000-000000000001'
    AND status = 'open';

-- 3. Verificar o resultado
SELECT 
    u.email,
    up.bot_enabled,
    COUNT(o.id) as total_orders,
    COUNT(CASE WHEN o.status = 'open' THEN 1 END) as open_orders,
    COUNT(CASE WHEN o.status = 'closed' THEN 1 END) as closed_orders
FROM users u
LEFT JOIN user_profiles up ON u.id = up.user_id
LEFT JOIN orders o ON u.id = o.user_id
WHERE u.id = '00000000-0000-0000-0000-000000000001'
GROUP BY u.email, up.bot_enabled;
