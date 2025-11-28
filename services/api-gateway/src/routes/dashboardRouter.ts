import { Router, Response } from 'express';
import { pool } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

interface Summary {
  balance: number;
  totalProfit: number;
  totalLoss: number;
  roi: number;
  totalTrades: number;
  completedTrades: number;
  validatedTokens: number;
  highRiskTokens: number;
  lowRiskTokens: number;
}

// Helper para garantir saldo inicial
async function ensureUserInitialBalance(pool: any, userId: string): Promise<void> {
  // Verificar se já existe um depósito inicial para evitar duplicação
  const existingDeposit = await pool.query(
    `SELECT COUNT(*) as count FROM ledger_entries 
     WHERE user_id = $1 AND entry_type = 'deposit' AND description = 'Initial paper trading deposit'`,
    [userId]
  );
  
  // Se já existe depósito inicial, não criar outro
  if (Number(existingDeposit.rows[0]?.count ?? 0) > 0) {
    return;
  }
  
  // Calcular saldo correto (créditos - débitos)
  const balanceResult = await pool.query(
    `SELECT 
       COALESCE(SUM(CASE WHEN entry_type IN ('deposit', 'trade_profit') THEN amount_usd ELSE 0 END), 0) AS credits,
       COALESCE(SUM(CASE WHEN entry_type IN ('trade_loss', 'fee', 'gas') THEN ABS(amount_usd) ELSE 0 END), 0) AS debits
     FROM ledger_entries
     WHERE user_id = $1`,
    [userId]
  );
  const credits = Number(balanceResult.rows[0]?.credits ?? 0);
  const debits = Number(balanceResult.rows[0]?.debits ?? 0);
  const currentBalance = Math.max(0, credits - debits);

  if (currentBalance < 100) {
    const depositAmount = 100 - currentBalance;
    await pool.query(
      `INSERT INTO ledger_entries (user_id, entry_type, amount_usd, description, balance_before, balance_after)
       VALUES ($1, 'deposit', $2, 'Initial paper trading deposit', $3, $4)`,
      [userId, depositAmount, currentBalance, currentBalance + depositAmount]
    );
    console.log(`[Dashboard] 💰 Created initial deposit of $${depositAmount} for user ${userId}`);
  }
}

router.get('/summary', authenticate, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid user context',
      },
      timestamp: new Date(),
    });
  }

  try {
    // Garantir que o usuário tenha saldo inicial
    await ensureUserInitialBalance(pool, userId);

    const [balanceResult, profitLossResult, tradesResult, riskResult, positionsResult, signalsResult, ordersResult] =
      await Promise.all([
        pool.query(
          `SELECT 
             COALESCE(SUM(CASE WHEN entry_type IN ('deposit', 'trade_profit') THEN amount_usd ELSE 0 END), 0) AS credits,
             COALESCE(SUM(CASE WHEN entry_type IN ('trade_loss', 'fee', 'gas') THEN ABS(amount_usd) ELSE 0 END), 0) AS debits
           FROM ledger_entries
           WHERE user_id = $1`,
          [userId]
        ),
        pool.query(
          `SELECT
             COALESCE(SUM(CASE WHEN entry_type = 'deposit' THEN amount_usd ELSE 0 END), 0) AS total_deposits
           FROM ledger_entries
           WHERE user_id = $1`,
          [userId]
        ),
        pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE status = 'completed') AS completed_trades,
             COUNT(*) AS total_trades,
             COUNT(*) FILTER (WHERE order_type = 'SELL' AND status = 'completed') AS completed_sells,
             COALESCE(SUM(profit_loss_usd) FILTER (WHERE order_type = 'SELL' AND status = 'completed' AND profit_loss_usd > 0), 0) AS total_profit_realized,
             COALESCE(SUM(ABS(profit_loss_usd)) FILTER (WHERE order_type = 'SELL' AND status = 'completed' AND profit_loss_usd < 0), 0) AS total_loss_realized
           FROM orders
           WHERE user_id = $1`,
          [userId]
        ),
        pool.query(
          `SELECT
             COUNT(*) AS total_tokens,
             COUNT(*) FILTER (WHERE risk_score >= 70) AS low_risk,
             COUNT(*) FILTER (WHERE risk_score < 40) AS high_risk
           FROM token_risk_assessments`
        ),
        pool.query(
          `SELECT *
           FROM open_positions
           WHERE user_id = $1
           ORDER BY trade_count DESC
           LIMIT 20`,
          [userId]
        ),
        pool.query(
          `SELECT
             s.id,
             s.signal_type,
             s.confidence_score,
             s.potential_multiplier,
             s.reasoning,
             s.created_at,
             t.symbol,
             t.name,
             t.price_usd,
             t.liquidity_usd,
             t.volume_24h_usd
           FROM signals s
           JOIN tokens t ON t.id = s.token_id
           ORDER BY s.created_at DESC
           LIMIT 10`
        ),
        pool.query(
          `SELECT
             o.id,
             o.order_type,
             o.status,
             o.amount_usd,
             o.amount_token,
             o.price_usd,
             o.created_at,
             o.executed_at,
             t.symbol,
             t.name
           FROM orders o
           JOIN tokens t ON t.id = o.token_id
           WHERE o.user_id = $1
           ORDER BY o.created_at DESC
           LIMIT 10`,
          [userId]
        ),
      ]);

    const credits = Number(balanceResult.rows[0]?.credits ?? 0);
    const debits = Number(balanceResult.rows[0]?.debits ?? 0);
    
    // Buscar investido em posições abertas e lucros/perdas não realizados
    const openPositionsBalance = await pool.query(
      `SELECT 
         COALESCE(SUM(invested_amount_usd), 0) AS total_invested,
         COALESCE(SUM(p.token_balance * COALESCE(t.price_usd, p.buy_price_usd) - p.invested_amount_usd), 0) AS unrealized_pnl,
         COALESCE(SUM(CASE 
           WHEN p.token_balance * COALESCE(t.price_usd, p.buy_price_usd) > p.invested_amount_usd 
           THEN p.token_balance * COALESCE(t.price_usd, p.buy_price_usd) - p.invested_amount_usd 
           ELSE 0 
         END), 0) AS unrealized_profit,
         COALESCE(SUM(CASE 
           WHEN p.token_balance * COALESCE(t.price_usd, p.buy_price_usd) < p.invested_amount_usd 
           THEN p.invested_amount_usd - p.token_balance * COALESCE(t.price_usd, p.buy_price_usd)
           ELSE 0 
         END), 0) AS unrealized_loss
       FROM positions p
       JOIN tokens t ON p.token_id = t.id
       WHERE p.user_id = $1 AND p.status = 'open'`,
      [userId]
    );
    const investedInPositions = Number(openPositionsBalance.rows[0]?.total_invested ?? 0);
    const unrealizedProfit = Number(openPositionsBalance.rows[0]?.unrealized_profit ?? 0);
    const unrealizedLoss = Number(openPositionsBalance.rows[0]?.unrealized_loss ?? 0);
    
    // Saldo disponível = créditos - débitos - investido em posições abertas
    const totalBalance = Math.max(0, credits - debits);
    const availableBalance = Math.max(0, totalBalance - investedInPositions);
    const balance = availableBalance; // Mostrar saldo disponível
    
    const deposits = profitLossResult.rows[0] ?? {
      total_deposits: 0,
    };
    
    const trades = tradesResult.rows[0] ?? {
      completed_trades: 0,
      total_trades: 0,
      completed_sells: 0,
      total_profit_realized: 0,
      total_loss_realized: 0,
    };
    
    // IMPORTANTE: Lucro/perda real vem das orders, não do ledger
    // O ledger registra valores recebidos de vendas, não lucros
    const totalProfitRealized = Number(trades.total_profit_realized ?? 0);
    const totalLossRealized = Number(trades.total_loss_realized ?? 0);
    
    // Combinar lucros/perdas realizados (de vendas) com não realizados (de posições abertas)
    const totalProfit = totalProfitRealized + unrealizedProfit;
    const totalLoss = totalLossRealized + unrealizedLoss;
    
    const totalDeposits = Number(deposits.total_deposits ?? 0);
    const riskStats = riskResult.rows[0] ?? {
      total_tokens: 0,
      low_risk: 0,
      high_risk: 0,
    };

    // Calcular lucro líquido total (realizado + não realizado)
    const netProfit = totalProfit - totalLoss;
    
    // ROI baseado no lucro total vs. total depositado
    const roi =
      totalDeposits > 0
        ? (netProfit / totalDeposits) * 100
        : 0;
    
    console.log('[Dashboard] 💰 Profit/Loss calculation:', {
      user_id: userId,
      total_profit_realized: totalProfitRealized,
      total_loss_realized: totalLossRealized,
      unrealized_profit: unrealizedProfit,
      unrealized_loss: unrealizedLoss,
      total_profit: totalProfit,
      total_loss: totalLoss,
      net_profit: netProfit,
      total_deposits: totalDeposits,
      roi: roi.toFixed(2) + '%'
    });

    const summary: Summary = {
      balance,
      totalProfit,
      totalLoss,
      roi: Number.isFinite(roi) ? Number(roi.toFixed(2)) : 0,
      totalTrades: Number(trades.total_trades ?? 0),
      completedTrades: Number(trades.completed_trades ?? 0),
      validatedTokens: Number(riskStats.total_tokens ?? 0),
      highRiskTokens: Number(riskStats.high_risk ?? 0),
      lowRiskTokens: Number(riskStats.low_risk ?? 0),
    };

    const positions = positionsResult.rows.map((row) => ({
      token_id: row.token_id,
      symbol: row.symbol,
      name: row.name,
      invested_usd: Number(row.invested_usd ?? 0),
      token_balance: Number(row.token_balance ?? 0),
      avg_buy_price: Number(row.avg_buy_price ?? 0),
      current_price: Number(row.current_price ?? 0),
      trade_count: Number(row.trade_count ?? 0),
    }));

    const signals = signalsResult.rows.map((row) => ({
      id: row.id,
      signal_type: row.signal_type,
      confidence_score: Number(row.confidence_score ?? 0),
      potential_multiplier: row.potential_multiplier ? Number(row.potential_multiplier) : undefined,
      reasoning: row.reasoning ?? undefined,
      created_at: row.created_at,
      symbol: row.symbol,
      name: row.name,
      price_usd: row.price_usd ? Number(row.price_usd) : undefined,
      liquidity_usd: row.liquidity_usd ? Number(row.liquidity_usd) : undefined,
      volume_24h_usd: row.volume_24h_usd ? Number(row.volume_24h_usd) : undefined,
    }));

    const recentOrders = ordersResult.rows.map((row) => ({
      id: row.id,
      order_type: row.order_type,
      status: row.status,
      amount_usd: Number(row.amount_usd ?? 0),
      amount_token: Number(row.amount_token ?? 0),
      price_usd: Number(row.price_usd ?? 0),
      created_at: row.created_at,
      executed_at: row.executed_at,
      symbol: row.symbol,
      name: row.name,
    }));

    res.json({
      success: true,
      data: {
        summary,
        positions,
        signals,
        recentOrders,
      },
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[Dashboard] summary error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DASHBOARD_ERROR',
        message: error.message || 'Failed to load dashboard information',
      },
      timestamp: new Date(),
    });
  }
});

export default router;
