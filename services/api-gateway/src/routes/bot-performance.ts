import { Router, Response } from 'express';
import { Pool } from 'pg';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

const connectionString = process.env.DATABASE_URL;
const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
    })
  : new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5433'),
      database: process.env.POSTGRES_DB || 'tradingbot',
      user: process.env.POSTGRES_USER || 'botuser',
      password: process.env.POSTGRES_PASSWORD || 'botpass',
      ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });

// GET /api/bot/performance - Métricas de performance do bot
router.get('/performance', authenticate, async (req: AuthRequest, res: Response) => {
  try {
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
    
    console.log('[Bot Performance] 📊 Fetching performance data for user:', userId);

    // Buscar TODAS as ordens para este usuário (BUY e SELL)
    const allOrdersResult = await pool.query(
      `SELECT 
        COUNT(*) as total_orders,
        COUNT(*) FILTER (WHERE order_type = 'BUY') as total_buys,
        COUNT(*) FILTER (WHERE order_type = 'SELL') as total_sells,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_orders,
        COUNT(*) FILTER (WHERE order_type = 'BUY' AND status = 'completed') as completed_buys,
        COUNT(*) FILTER (WHERE order_type = 'SELL' AND status = 'completed') as completed_sells
       FROM orders
       WHERE user_id = $1`,
      [userId]
    );
    
    console.log('[Bot Performance] 📦 All orders for user:', allOrdersResult.rows[0]);
    
    // Buscar estatísticas de trades (apenas ordens SELL completadas têm profit/loss)
    const statsResult = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE order_type = 'BUY' AND status = 'completed') as total_buys,
        COUNT(*) FILTER (WHERE order_type = 'SELL' AND status = 'completed') as total_sells,
        COUNT(*) FILTER (WHERE order_type = 'SELL' AND status = 'completed' AND profit_loss_usd > 0) as winning_trades,
        COUNT(*) FILTER (WHERE order_type = 'SELL' AND status = 'completed' AND profit_loss_usd < 0) as losing_trades,
        COUNT(*) FILTER (WHERE order_type = 'SELL' AND status = 'completed' AND profit_loss_usd = 0) as break_even_trades,
        COALESCE(SUM(profit_loss_usd) FILTER (WHERE order_type = 'SELL' AND status = 'completed' AND profit_loss_usd > 0), 0) as total_profit_from_orders,
        COALESCE(SUM(ABS(profit_loss_usd)) FILTER (WHERE order_type = 'SELL' AND status = 'completed' AND profit_loss_usd < 0), 0) as total_loss_from_orders,
        COALESCE(AVG(profit_loss_percent) FILTER (WHERE order_type = 'SELL' AND status = 'completed' AND profit_loss_percent IS NOT NULL), 0) as avg_profit_loss_percent,
        COALESCE(MAX(profit_loss_usd) FILTER (WHERE order_type = 'SELL' AND status = 'completed' AND profit_loss_usd IS NOT NULL), 0) as best_trade,
        COALESCE(MIN(profit_loss_usd) FILTER (WHERE order_type = 'SELL' AND status = 'completed' AND profit_loss_usd IS NOT NULL), 0) as worst_trade
       FROM orders
       WHERE user_id = $1`,
      [userId]
    );
    
    console.log('[Bot Performance] 📈 Trade stats:', statsResult.rows[0]);
    
    // Buscar lucros/perdas reais do ledger (mais confiável)
    const ledgerProfitLoss = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN entry_type = 'trade_profit' THEN amount_usd ELSE 0 END), 0) AS total_profit,
         COALESCE(SUM(CASE WHEN entry_type = 'trade_loss' THEN ABS(amount_usd) ELSE 0 END), 0) AS total_loss,
         COALESCE(SUM(CASE WHEN entry_type = 'deposit' THEN amount_usd ELSE 0 END), 0) AS total_deposits
       FROM ledger_entries
       WHERE user_id = $1`,
      [userId]
    );

    // Buscar posições atuais com preços atualizados dos tokens
    const positionsResult = await pool.query(
      `SELECT 
        COUNT(*) as open_positions,
        COALESCE(SUM(p.invested_amount_usd), 0) as total_invested,
        COALESCE(SUM(p.token_balance * COALESCE(t.price_usd, p.buy_price_usd)), 0) as current_value,
        COALESCE(SUM(p.token_balance * COALESCE(t.price_usd, p.buy_price_usd) - p.invested_amount_usd), 0) as unrealized_pnl,
        COALESCE(SUM(CASE 
          WHEN p.token_balance * COALESCE(t.price_usd, p.buy_price_usd) > p.invested_amount_usd 
          THEN p.token_balance * COALESCE(t.price_usd, p.buy_price_usd) - p.invested_amount_usd 
          ELSE 0 
        END), 0) as unrealized_profit,
        COALESCE(SUM(CASE 
          WHEN p.token_balance * COALESCE(t.price_usd, p.buy_price_usd) < p.invested_amount_usd 
          THEN p.invested_amount_usd - p.token_balance * COALESCE(t.price_usd, p.buy_price_usd) 
          ELSE 0 
        END), 0) as unrealized_loss,
        COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - p.buy_time)) / 3600), 0) as avg_hold_time_hours
       FROM positions p
       JOIN tokens t ON p.token_id = t.id
       WHERE p.user_id = $1 AND p.status = 'open'`,
      [userId]
    );
    
    // Buscar detalhes das posições abertas
    const openPositionsDetail = await pool.query(
      `SELECT 
        p.id,
        p.token_id,
        p.invested_amount_usd,
        p.buy_price_usd,
        p.buy_time,
        p.token_balance,
        COALESCE(t.price_usd, p.buy_price_usd) as current_price,
        t.symbol,
        t.name,
        p.token_balance * COALESCE(t.price_usd, p.buy_price_usd) as current_value,
        (p.token_balance * COALESCE(t.price_usd, p.buy_price_usd) - p.invested_amount_usd) as unrealized_pnl,
        ((p.token_balance * COALESCE(t.price_usd, p.buy_price_usd) - p.invested_amount_usd) / p.invested_amount_usd * 100) as unrealized_pnl_percent,
        EXTRACT(EPOCH FROM (NOW() - p.buy_time)) / 3600 as hold_time_hours
       FROM positions p
       JOIN tokens t ON p.token_id = t.id
       WHERE p.user_id = $1 AND p.status = 'open'
       ORDER BY p.buy_time DESC`,
      [userId]
    );
    
    console.log('[Bot Performance] 📊 Open positions detail count:', openPositionsDetail.rows.length);

    // Buscar estatísticas de sinais (últimas 24h, não precisa ter ordem)
    const signalsResult = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE signal_type = 'BUY') as buy_signals,
        COUNT(*) FILTER (WHERE signal_type = 'SELL') as sell_signals,
        COUNT(*) FILTER (WHERE signal_type = 'HOLD') as hold_signals,
        COALESCE(AVG(confidence_score), 0) as avg_confidence
       FROM signals
       WHERE created_at > NOW() - INTERVAL '24 hours'`,
      []
    );

    // Buscar saldo atual do usuário
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
    
    // Buscar investido em posições abertas
    const openPositionsBalance = await pool.query(
      `SELECT COALESCE(SUM(invested_amount_usd), 0) AS total_invested
       FROM positions
       WHERE user_id = $1 AND status = 'open'`,
      [userId]
    );
    const investedInPositions = Number(openPositionsBalance.rows[0]?.total_invested ?? 0);
    
    const totalBalance = Math.max(0, credits - debits);
    const availableBalance = Math.max(0, totalBalance - investedInPositions);
    
    console.log('[Bot Performance] 💰 Balance calculation:', {
      credits,
      debits,
      total_balance: totalBalance,
      invested_in_positions: investedInPositions,
      available_balance: availableBalance
    });

    // Buscar ordens recentes (últimas 50)
    const recentOrdersResult = await pool.query(
      `SELECT 
        o.id,
        o.order_type,
        o.status,
        o.amount_usd,
        o.amount_token,
        o.price_usd,
        o.profit_loss_usd,
        o.profit_loss_percent,
        o.created_at,
        o.executed_at,
        t.symbol,
        t.name
       FROM orders o
       JOIN tokens t ON o.token_id = t.id
       WHERE o.user_id = $1
       ORDER BY o.created_at DESC
       LIMIT 50`,
      [userId]
    );
    
    console.log('[Bot Performance] 📋 Recent orders count:', recentOrdersResult.rows.length);

    // Buscar histórico de saldo
    const balanceHistoryResult = await pool.query(
      `SELECT 
        DATE_TRUNC('hour', created_at) as hour,
        SUM(amount_usd) FILTER (WHERE entry_type IN ('deposit', 'trade_profit')) as deposits,
        SUM(ABS(amount_usd)) FILTER (WHERE entry_type IN ('trade_loss', 'fee', 'gas')) as withdrawals
       FROM ledger_entries
       WHERE user_id = $1
       AND created_at > NOW() - INTERVAL '24 hours'
       GROUP BY DATE_TRUNC('hour', created_at)
       ORDER BY hour DESC
       LIMIT 24`,
      [userId]
    );

    const stats = statsResult.rows[0] || {};
    const positions = positionsResult.rows[0] || {};
    const signals = signalsResult.rows[0] || {};
    const ledgerPL = ledgerProfitLoss.rows[0] || {};
    const allOrders = allOrdersResult.rows[0] || {};
    
    // Total de trades = SELL completadas (trades fechados)
    const totalTrades = Number(stats.total_sells ?? 0);
    const winRate = totalTrades > 0 
      ? (Number(stats.winning_trades ?? 0) / totalTrades) * 100 
      : 0;

    // IMPORTANTE: O ledger registra valores recebidos de vendas, não lucros
    // Para métricas de lucro/perda, usar profit_loss_usd das orders (mais preciso)
    // Para depósitos, usar o ledger
    const totalDeposits = Number(ledgerPL.total_deposits ?? 0);
    
    // Lucro/perda realizado (trades fechados)
    const realizedProfit = Number(stats.total_profit_from_orders ?? 0);
    const realizedLoss = Number(stats.total_loss_from_orders ?? 0);
    const netProfitRealized = realizedProfit - realizedLoss;
    
    // Lucro/perda não realizado (posições abertas)
    const unrealizedProfit = Number(positions.unrealized_profit ?? 0);
    const unrealizedLoss = Number(positions.unrealized_loss ?? 0);
    const netProfitUnrealized = Number(positions.unrealized_pnl ?? 0);
    
    // Total geral (realizado + não realizado)
    const totalProfit = realizedProfit + unrealizedProfit;
    const totalLoss = realizedLoss + unrealizedLoss;
    const netProfitTotal = netProfitRealized + netProfitUnrealized;
    const roi = totalDeposits > 0 ? (netProfitTotal / totalDeposits) * 100 : 0;
    const avgHoldTimeHours = Number(positions.avg_hold_time_hours ?? 0);
    
    console.log('[Bot Performance] 📊 Data summary:', {
      total_buys: stats.total_buys,
      total_sells: stats.total_sells,
      winning_trades: stats.winning_trades,
      losing_trades: stats.losing_trades,
      realized_profit: realizedProfit,
      realized_loss: realizedLoss,
      unrealized_profit: unrealizedProfit,
      unrealized_loss: unrealizedLoss,
      net_profit_unrealized: netProfitUnrealized,
      net_profit_total: netProfitTotal,
      open_positions: positions.open_positions,
      avg_hold_time_hours: avgHoldTimeHours,
      recent_orders: recentOrdersResult.rows.length
    });
    
    console.log('[Bot Performance] 💵 Metrics calculation:', {
      total_deposits: totalDeposits,
      realized_profit: realizedProfit,
      realized_loss: realizedLoss,
      net_profit_realized: netProfitRealized,
      unrealized_profit: unrealizedProfit,
      unrealized_loss: unrealizedLoss,
      net_profit_unrealized: netProfitUnrealized,
      net_profit_total: netProfitTotal,
      roi,
      avg_hold_time_hours: avgHoldTimeHours,
      current_balance: availableBalance,
      total_balance: totalBalance,
      invested: investedInPositions
    });

    res.json({
      success: true,
      data: {
        // Informações de debug
        debug: {
          user_id: userId,
          total_orders_in_db: Number(allOrders.total_orders ?? 0),
          completed_orders: Number(allOrders.completed_orders ?? 0),
        },
        // Saldo atual
        balance: {
          available: Number(availableBalance.toFixed(2)),
          total: Number(totalBalance.toFixed(2)),
          invested_in_positions: Number(investedInPositions.toFixed(2)),
        },
        trades: {
          total: totalTrades,
          buys: Number(stats.total_buys ?? 0),
          sells: Number(stats.total_sells ?? 0),
          wins: Number(stats.winning_trades ?? 0),
          losses: Number(stats.losing_trades ?? 0),
          break_even: Number(stats.break_even_trades ?? 0),
          win_rate: Number(winRate.toFixed(2)),
        },
        profits: {
          // Lucros/perdas realizados (trades fechados)
          realized_profit: Number(realizedProfit.toFixed(2)),
          realized_loss: Number(realizedLoss.toFixed(2)),
          net_profit_realized: Number(netProfitRealized.toFixed(2)),
          // Lucros/perdas não realizados (posições abertas)
          unrealized_profit: Number(unrealizedProfit.toFixed(2)),
          unrealized_loss: Number(unrealizedLoss.toFixed(2)),
          net_profit_unrealized: Number(netProfitUnrealized.toFixed(2)),
          // Totais
          total_profit: Number((realizedProfit + unrealizedProfit).toFixed(2)),
          total_loss: Number((realizedLoss + unrealizedLoss).toFixed(2)),
          net_profit: Number(netProfitTotal.toFixed(2)),
          roi: Number(roi.toFixed(2)),
          avg_profit_loss_percent: Number(stats.avg_profit_loss_percent ?? 0),
          best_trade: Number(stats.best_trade ?? 0),
          worst_trade: Number(stats.worst_trade ?? 0),
        },
        positions: {
          open: Number(positions.open_positions ?? 0),
          total_invested: Number(positions.total_invested ?? 0),
          current_value: Number(positions.current_value ?? 0),
          unrealized_pnl: Number(positions.unrealized_pnl ?? 0),
          unrealized_profit: Number(unrealizedProfit.toFixed(2)),
          unrealized_loss: Number(unrealizedLoss.toFixed(2)),
          avg_hold_time_hours: Number(avgHoldTimeHours.toFixed(2)),
          details: openPositionsDetail.rows.map((row) => ({
            id: row.id,
            token_id: row.token_id,
            symbol: row.symbol,
            name: row.name,
            invested_amount_usd: Number(row.invested_amount_usd ?? 0),
            buy_price_usd: Number(row.buy_price_usd ?? 0),
            current_price_usd: Number(row.current_price ?? row.buy_price_usd ?? 0),
            token_balance: Number(row.token_balance ?? 0),
            current_value: Number(row.current_value ?? 0),
            unrealized_pnl: Number(row.unrealized_pnl ?? 0),
            unrealized_pnl_percent: Number(row.unrealized_pnl_percent ?? 0),
            hold_time_hours: Number(row.hold_time_hours ?? 0),
            buy_time: row.buy_time,
          })),
        },
        signals: {
          buy_signals: Number(signals.buy_signals ?? 0),
          sell_signals: Number(signals.sell_signals ?? 0),
          hold_signals: Number(signals.hold_signals ?? 0),
          avg_confidence: Number(signals.avg_confidence ?? 0),
        },
        recent_orders: recentOrdersResult.rows.map((row) => ({
          id: row.id,
          order_type: row.order_type,
          status: row.status,
          amount_usd: Number(row.amount_usd ?? 0),
          amount_token: Number(row.amount_token ?? 0),
          price_usd: Number(row.price_usd ?? 0),
          profit_loss_usd: row.profit_loss_usd ? Number(row.profit_loss_usd) : null,
          profit_loss_percent: row.profit_loss_percent ? Number(row.profit_loss_percent) : null,
          created_at: row.created_at,
          executed_at: row.executed_at,
          symbol: row.symbol,
          name: row.name,
        })),
        balance_history: balanceHistoryResult.rows.map((row) => ({
          hour: row.hour,
          deposits: Number(row.deposits ?? 0),
          withdrawals: Number(row.withdrawals ?? 0),
        })),
      },
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[Bot Performance] Error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PERFORMANCE_ERROR',
        message: error.message || 'Failed to load bot performance',
      },
      timestamp: new Date(),
    });
  }
});

export default router;

