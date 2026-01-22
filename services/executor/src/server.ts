import './env';
import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import { TradeExecutor } from './trader';
import { ExecuteOrderRequest, Signal } from '@shared/types';

const app: Express = express();
const PORT = Number(process.env.EXECUTOR_PORT ?? 4003);

app.use(cors());
app.use(express.json());

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

const executor = new TradeExecutor(pool);

app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    environment: process.env.NODE_ENV || 'development',
    execution_mode: process.env.BOT_EXECUTION_MODE || 'simulation',
    timestamp: new Date().toISOString(),
  });
});

app.post('/signals/process', async (req: Request, res: Response) => {
  try {
    const signal: Signal = req.body;
    const signalId = signal.id || 'unknown';
    const signalType = signal.signal_type || 'unknown';
    const tokenId = signal.token_id || 'unknown';

    console.log(`[Executor Server] 📥 Received signal processing request:`, {
      signal_id: signalId,
      signal_type: signalType,
      token_id: tokenId,
      symbol: (signal as any).symbol || 'unknown',
      confidence_score: signal.confidence_score,
      potential_multiplier: signal.potential_multiplier
    });

    // Validação detalhada
    if (!signal) {
      console.error('[Executor Server] ❌ Invalid request: signal is null/undefined');
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_SIGNAL', message: 'Signal payload is required' },
        timestamp: new Date(),
      });
    }

    if (!signal.token_id) {
      console.error('[Executor Server] ❌ Invalid signal: token_id is missing');
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_SIGNAL', message: 'Signal token_id is required' },
        timestamp: new Date(),
      });
    }

    if (!signal.signal_type) {
      console.error('[Executor Server] ❌ Invalid signal: signal_type is missing');
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_SIGNAL', message: 'Signal signal_type is required' },
        timestamp: new Date(),
      });
    }

    if (!['BUY', 'SELL', 'HOLD'].includes(signal.signal_type)) {
      console.error(`[Executor Server] ❌ Invalid signal: unknown signal_type: ${signal.signal_type}`);
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_SIGNAL', message: `Invalid signal_type: ${signal.signal_type}. Must be BUY, SELL, or HOLD` },
        timestamp: new Date(),
      });
    }

    console.log(`[Executor Server] ✅ Signal validation passed, processing...`);
    await executor.processSignal(signal);

    console.log(`[Executor Server] ✅ Signal processed successfully`);
    res.json({
      success: true,
      message: 'Signal processed successfully',
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[Executor Server] ❌ Process signal error:', {
      message: error.message,
      stack: error.stack,
      signal: req.body
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'PROCESS_SIGNAL_ERROR',
        message: error.message || 'Failed to process signal',
        details: error.stack
      },
      timestamp: new Date(),
    });
  }
});

// POST /execute/buy
app.post('/execute/buy', async (req: Request, res: Response) => {
  try {
    const userId = (req.headers['x-user-id'] as string) || (await executor.getDefaultUserId());
    const request: ExecuteOrderRequest = req.body;
    const order = await executor.executeBuy(request, userId);

    res.json({
      success: true,
      data: { order },
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('Execute buy error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      timestamp: new Date(),
    });
  }
});

// POST /execute/sell
app.post('/execute/sell', async (req: Request, res: Response) => {
  try {
    const userId = (req.headers['x-user-id'] as string) || (await executor.getDefaultUserId());
    const request: ExecuteOrderRequest = req.body;
    const order = await executor.executeSell(request, userId);

    res.json({
      success: true,
      data: { order },
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('Execute sell error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      timestamp: new Date(),
    });
  }
});

// GET /positions
app.get('/positions', async (req: Request, res: Response) => {
  try {
    const userId = (req.headers['x-user-id'] as string) || (await executor.getDefaultUserId());
    const positions = await executor.getPositions(userId);

    res.json({
      success: true,
      data: positions,
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('Get positions error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      timestamp: new Date(),
    });
  }
});

// GET /calculate-investment/:tokenId
app.get('/calculate-investment/:tokenId', async (req: Request, res: Response) => {
  try {
    const userId = (req.headers['x-user-id'] as string) || (await executor.getDefaultUserId());
    const { tokenId } = req.params;
    const signalId = req.query.signal_id as string | undefined;

    const investment = await executor.calculateIntendedInvestment(userId, tokenId, signalId);

    res.json({
      success: true,
      data: investment,
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('Calculate investment error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      timestamp: new Date(),
    });
  }
});

// POST /monitor - Monitora posições e executa vendas automáticas
app.post('/monitor', async (req: Request, res: Response) => {
  try {
    console.error('[Executor] 🔧 Manual monitor trigger received');
    await executor.monitorPositions();

    res.json({
      success: true,
      message: 'Position monitoring completed',
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[Executor] ❌ Monitor positions error:', error);
    console.error('[Executor] ❌ Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      timestamp: new Date(),
    });
  }
});

// GET /monitor/status - Verifica status do monitoramento
app.get('/monitor/status', async (req: Request, res: Response) => {
  try {
    const monitorIntervalSeconds = Number(process.env.MONITOR_INTERVAL_SECONDS ?? 30);

    // Verificar quantas posições abertas existem
    const positionsResult = await pool.query(
      `SELECT COUNT(*) as count, 
              MIN(EXTRACT(EPOCH FROM (NOW() - buy_time)) / 60) as oldest_minutes
       FROM positions 
       WHERE status = 'open'`
    );

    const openPositions = Number(positionsResult.rows[0]?.count ?? 0);
    const oldestMinutes = Number(positionsResult.rows[0]?.oldest_minutes ?? 0);

    res.json({
      success: true,
      monitoring: {
        interval_seconds: monitorIntervalSeconds,
        is_active: true,
        open_positions: openPositions,
        oldest_position_minutes: oldestMinutes,
        should_sell_oldest: oldestMinutes >= 10
      },
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[Executor] ❌ Monitor status error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      timestamp: new Date(),
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`⚙️ Executor Service running on port ${PORT}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);

  // Iniciar monitoramento periódico de posições (a cada 30 segundos para vendas rápidas)
  // Intervalo reduzido para detectar oportunidades de venda rapidamente
  const monitorIntervalSeconds = Number(process.env.MONITOR_INTERVAL_SECONDS ?? 30);
  const monitorInterval = monitorIntervalSeconds * 1000;
  console.log(`🔍 Position monitoring started (interval: ${monitorIntervalSeconds} seconds)`);

  // Executar imediatamente na primeira vez
  setTimeout(async () => {
    try {
      const timestamp = new Date().toISOString();
      console.error(`[Executor] 🔍🔍🔍 ========== STARTING INITIAL MONITORING (${timestamp}) ==========`);
      console.error('[Executor] 🔍 Running initial position monitoring...');
      await executor.monitorPositions();
      console.error('[Executor] ✅ Initial position monitoring completed');
      console.error(`[Executor] ✅✅✅ ========== INITIAL MONITORING COMPLETED (${new Date().toISOString()}) ==========`);
    } catch (error: any) {
      console.error('[Executor] ❌❌❌ Initial monitoring error:', error);
      console.error('[Executor] ❌ Error stack:', error.stack);
    }
  }, 5000); // Aguardar 5 segundos para banco estar pronto

  // Executar periodicamente
  setInterval(async () => {
    try {
      const timestamp = new Date().toISOString();
      console.error(`[Executor] 🔍🔍🔍 ========== STARTING PERIODIC MONITORING (${timestamp}) ==========`);
      console.error('[Executor] 🔍 Starting periodic position monitoring...');
      await executor.monitorPositions();
      console.error('[Executor] ✅ Position monitoring completed');
      console.error(`[Executor] ✅✅✅ ========== PERIODIC MONITORING COMPLETED (${new Date().toISOString()}) ==========`);
    } catch (error: any) {
      console.error('[Executor] ❌❌❌ Periodic monitoring error:', error);
      console.error('[Executor] ❌ Error stack:', error.stack);
    }
  }, monitorInterval);

  console.log(`🔍 Position monitoring started (interval: ${monitorIntervalSeconds} seconds)`);
  console.log(`💰 Execution mode: ${process.env.BOT_EXECUTION_MODE === 'live' ? '🔥 LIVE' : '📝 SIMULATION'}`);
  console.log(`🤖 Bot implementation respects execution mode for trade execution`);
  console.log(`📊 Monitor positions every ${monitorIntervalSeconds} seconds for fast sell execution`);
});

app.get('/mode', (req: Request, res: Response) => {
  const mode = process.env.BOT_EXECUTION_MODE?.toLowerCase() === 'live' ? 'live' : 'simulation';
  res.json({
    mode,
    node_env: process.env.NODE_ENV,
    timestamp: new Date()
  });
});

export default app;
