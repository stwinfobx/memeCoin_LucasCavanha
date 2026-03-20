import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanupTestUser() {
    const testUserId = '00000000-0000-0000-0000-000000000001';

    console.log('🧹 Limpando usuário de teste...\n');

    // 1. Desabilitar o bot
    console.log('1️⃣ Desabilitando bot do usuário de teste...');
    await prisma.$executeRaw`
    UPDATE user_profiles 
    SET bot_enabled = false 
    WHERE user_id = ${testUserId}::uuid
  `;
    console.log('✅ Bot desabilitado\n');

    // 2. Fechar todas as posições abertas
    console.log('2️⃣ Fechando posições abertas...');
    const result = await prisma.$executeRaw`
    UPDATE orders 
    SET 
      status = 'closed',
      exit_price = current_price,
      exit_time = NOW(),
      profit_loss = (current_price - entry_price) * amount,
      updated_at = NOW()
    WHERE 
      user_id = ${testUserId}::uuid
      AND status = 'open'
  `;
    console.log(`✅ ${result} posição(ões) fechada(s)\n`);

    // 3. Verificar resultado
    console.log('3️⃣ Verificando resultado...');
    const verification = await prisma.$queryRaw`
    SELECT 
      u.email,
      up.bot_enabled,
      COUNT(o.id)::int as total_orders,
      COUNT(CASE WHEN o.status = 'open' THEN 1 END)::int as open_orders,
      COUNT(CASE WHEN o.status = 'closed' THEN 1 END)::int as closed_orders
    FROM users u
    LEFT JOIN user_profiles up ON u.id = up.user_id
    LEFT JOIN orders o ON u.id = o.user_id
    WHERE u.id = ${testUserId}::uuid
    GROUP BY u.email, up.bot_enabled
  `;

    console.log('📊 Resultado:');
    console.table(verification);

    await prisma.$disconnect();
    console.log('\n✅ Limpeza concluída!');
}

cleanupTestUser().catch(console.error);
