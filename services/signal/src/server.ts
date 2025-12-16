import './env';
import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import axios from 'axios';
import { SignalAnalyzer } from './analyzer';
import { AutoAnalyzer } from './auto-analyzer';
import { SignalAnalysisRequest, Signal, Token } from '@shared/types';


const app: Express = express();
const PORT = Number(process.env.SIGNAL_PORT ?? 4002);
const EXECUTOR_BASE_URL = process.env.EXECUTOR_SERVICE_URL || 'http://localhost:4003';
const EXECUTOR_TIMEOUT = Number(process.env.EXECUTOR_REQUEST_TIMEOUT_MS || 5000);

app.use(cors());
app.use(express.json());

const connectionString = process.env.DATABASE_URL;

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      // Configurações de retry e timeout
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      max: 10,
    })
  : new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5433'),
      database: process.env.POSTGRES_DB || 'tradingbot',
      user: process.env.POSTGRES_USER || 'botuser',
      password: process.env.POSTGRES_PASSWORD || 'botpass',
      ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      max: 10,
    });

// Tratar erros de conexão do pool
pool.on('error', (err) => {
  console.error('[Signal] Unexpected database pool error:', err.message);
  // Não encerrar o processo - o pool vai tentar reconectar automaticamente
});

// Testar conexão ao iniciar (mas não travar se falhar)
pool
  .query('SELECT NOW()')
  .then(() => {
    console.log('✅ Signal Service database connected successfully');
  })
  .catch((err) => {
    console.warn('⚠️ Signal Service database connection failed:', err.message);
    console.warn('⚠️ Service will continue to run and retry connections when needed');
    console.warn('⚠️ Make sure PostgreSQL/Supabase is running and DATABASE_URL is correct');
  });

const analyzer = new SignalAnalyzer(pool);
const autoAnalyzer = new AutoAnalyzer(pool, analyzer);

app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'signal',
  });
});

// POST /analyze - Analisar token e gerar sinal
app.post('/analyze', async (req: Request, res: Response) => {
  try {
    const { token_id }: SignalAnalysisRequest = req.body;

    if (!token_id) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'token_id is required',
        },
        timestamp: new Date(),
      });
    }

    const signal = await analyzer.analyzeToken(token_id);
    
    // Buscar token para resposta completa
    const tokenResult = await pool.query('SELECT * FROM tokens WHERE id = $1', [token_id]);
    const token = tokenResult.rows[0];

    await dispatchSignal(signal, token);

    res.json({
      success: true,
      data: {
        signal,
        token,
      },
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('Analysis endpoint error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Failed to analyze token',
      },
      timestamp: new Date(),
    });
  }
});

// GET /signals/active - Obter sinais ativos
app.get('/signals/active', async (req: Request, res: Response) => {
  try {
    const limit = Number(req.query.limit ?? 50);
    const signals = await analyzer.getActiveSignals(limit);

    res.json({
      success: true,
      data: signals,
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('Get signals error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to get signals',
      },
      timestamp: new Date(),
    });
  }
});

app.get('/signals/history', async (req: Request, res: Response) => {
  try {
    const limit = Number(req.query.limit ?? 100);
    const history = await analyzer.getSignalHistory(limit);

    res.json({
      success: true,
      data: history,
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('Get signals history error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to get signals history',
      },
      timestamp: new Date(),
    });
  }
});

app.listen(PORT, () => {
  console.log(`🧠 Signal Service running on port ${PORT}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);

  // Iniciar análise automática periódica
  // Para testes: 2 minutos. Para produção: 5 minutos
  const autoAnalyzeInterval = Number(process.env.AUTO_ANALYZE_INTERVAL_MINUTES ?? 2);
  autoAnalyzer.start(autoAnalyzeInterval);
  console.log(`🤖 Auto-analyzer started (interval: ${autoAnalyzeInterval} minutes)`);
  
  // Criar notificação inicial após 10 segundos (dar tempo para banco estar pronto)
  setTimeout(async () => {
    try {
      // Testar conexão primeiro antes de criar notificação
      await pool.query('SELECT NOW()');
      
      const defaultUserId = 'f58986be-9f49-4a63-9c44-937bfed78362';
      const tokenCountResult = await pool.query(
        `SELECT COUNT(*) as count FROM tokens WHERE is_validated = true`
      );
      const tokenCount = Number(tokenCountResult.rows[0]?.count ?? 0);
      
      await pool.query(
        `INSERT INTO bot_notifications (user_id, notification_type, severity, title, message, data)
         VALUES ($1, 'bot_started', 'success', 'Bot de análise iniciado', $2, $3::jsonb)
         ON CONFLICT DO NOTHING`,
        [
          defaultUserId,
          tokenCount > 0
            ? `🤖 Bot de análise iniciado! Encontrei ${tokenCount} token(s) validado(s) no banco. Começarei a analisá-los em breve...`
            : `🤖 Bot de análise iniciado! Estou aguardando tokens serem validados pelo validator. O validator busca novos memecoins a cada minuto.`,
          JSON.stringify({ tokens_validated: tokenCount, status: 'started' })
        ]
      ).catch(() => {
        // Ignorar se tabela não existir ainda
      });
    } catch (error: any) {
      // Não logar erro se for apenas conexão não disponível ainda
      if (error.code !== 'ENOENT' && error.code !== 'ECONNREFUSED') {
        console.warn('[Signal] Failed to create startup notification:', error.message);
      }
    }
  }, 10000);
});

async function dispatchSignal(signal: Signal, token: Token) {
  try {
    if (signal.signal_type === 'HOLD') {
      console.log(`[Signal] HOLD signal for ${token.symbol} - skipping executor`);
      return;
    }

    console.log(`[Signal] Dispatching ${signal.signal_type} signal for ${token.symbol} to Executor...`);
    
    await axios.post(
      `${EXECUTOR_BASE_URL}/signals/process`,
      {
        ...signal,
        symbol: token.symbol,
        name: token.name,
      },
      { timeout: EXECUTOR_TIMEOUT }
    );

    console.log(`[Signal] Successfully dispatched ${signal.signal_type} signal for ${token.symbol}`);
  } catch (error: any) {
    const detail = error?.response?.data?.error?.message || error?.message || error;
    console.error(`[Signal] Failed to dispatch ${signal.signal_type} signal for ${token.symbol}:`, detail);
    // Não propagar erro para não bloquear a análise
  }
}

export default app;
