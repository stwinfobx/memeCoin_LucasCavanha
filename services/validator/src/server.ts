import './env';
import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { Pool, PoolConfig } from 'pg';
import { TokenValidator } from './validator';
import { TokenRiskAssessment, TokenValidationRequest, Token } from '@shared/types';
import { MemecoinIngestion } from './ingestion';


const app: Express = express();
const PORT = Number(process.env.VALIDATOR_PORT ?? 4001);

// Middlewares
app.use(cors());
app.use(express.json());

// Database connection
const poolConfig: PoolConfig = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5433'),
  database: process.env.POSTGRES_DB || 'tradingbot',
  user: process.env.POSTGRES_USER || 'botuser',
  password: process.env.POSTGRES_PASSWORD || 'botpass',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
};

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
    ...poolConfig,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 10,
  });

// Tratar erros de conexão do pool sem travar o serviço
pool.on('error', (err) => {
  console.error('[Validator] Unexpected database pool error:', err.message);
  // Não encerrar o processo - o pool vai tentar reconectar automaticamente
});

const validator = new TokenValidator(pool);

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'validator',
  });
});

// POST /validate - Validar um token
app.post('/validate', async (req: Request, res: Response) => {
  try {
    const { contract_address, chain }: TokenValidationRequest = req.body;

    if (!contract_address) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'contract_address is required',
        },
        timestamp: new Date(),
      });
    }

    const result = await validator.validateToken(contract_address, chain);

    res.json({
      success: true,
      data: result,
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('Validation endpoint error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Failed to validate token',
      },
      timestamp: new Date(),
    });
  }
});

// GET /validated-tokens - Listar tokens validados
app.get('/validated-tokens', async (req: Request, res: Response) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const query = await pool.query(
      `SELECT 
         t.*,
         ra.id AS risk_id,
         ra.memecoin_score,
         ra.risk_score,
         ra.scam_probability,
         ra.risk_level,
         ra.indicators,
         ra.created_at AS risk_created_at,
         ra.updated_at AS risk_updated_at
       FROM tokens t
       LEFT JOIN token_risk_assessments ra ON ra.token_id = t.id
       WHERE t.is_validated = true 
       ORDER BY t.validated_at DESC 
       LIMIT $1 OFFSET $2`,
      [Number(limit), Number(offset)]
    );

    const data = query.rows.map((row) => {
      const { risk_id, memecoin_score, risk_score, scam_probability, risk_level, indicators, risk_created_at, risk_updated_at, ...tokenFields } = row;

      let risk: TokenRiskAssessment | null = null;
      if (risk_id) {
        risk = {
          id: risk_id,
          token_id: tokenFields.id,
          contract_address: tokenFields.contract_address,
          chain: tokenFields.chain,
          memecoin_score: Number(memecoin_score),
          risk_score: Number(risk_score),
          scam_probability: Number(scam_probability),
          risk_level,
          indicators,
          created_at: risk_created_at,
          updated_at: risk_updated_at,
        };
      }

      return {
        token: tokenFields as Token,
        risk_assessment: risk,
      };
    });

    res.json({
      success: true,
      data,
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('List tokens error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to list tokens',
      },
      timestamp: new Date(),
    });
  }
});

// GET /risk/:contractAddress - obter risco de um token
app.get('/risk/:contractAddress', async (req: Request, res: Response) => {
  try {
    const { contractAddress } = req.params;
    if (!contractAddress) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'contractAddress is required',
        },
        timestamp: new Date(),
      });
    }

    const query = await pool.query(
      `SELECT 
         t.*,
         ra.id AS risk_id,
         ra.memecoin_score,
         ra.risk_score,
         ra.scam_probability,
         ra.risk_level,
         ra.indicators,
         ra.created_at AS risk_created_at,
         ra.updated_at AS risk_updated_at
       FROM tokens t
       LEFT JOIN token_risk_assessments ra ON ra.token_id = t.id
       WHERE LOWER(t.contract_address) = LOWER($1)
       LIMIT 1`,
      [contractAddress]
    );

    if (query.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Token not found',
        },
        timestamp: new Date(),
      });
    }

    const row = query.rows[0];
    const { risk_id, memecoin_score, risk_score, scam_probability, risk_level, indicators, risk_created_at, risk_updated_at, ...tokenFields } = row;

    let risk: TokenRiskAssessment | null = null;
    if (risk_id) {
      risk = {
        id: risk_id,
        token_id: tokenFields.id,
        contract_address: tokenFields.contract_address,
        chain: tokenFields.chain,
        memecoin_score: Number(memecoin_score),
        risk_score: Number(risk_score),
        scam_probability: Number(scam_probability),
        risk_level,
        indicators,
        created_at: risk_created_at,
        updated_at: risk_updated_at,
      };
    }

    res.json({
      success: true,
      data: {
        token: tokenFields as Token,
        risk_assessment: risk,
      },
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('Get token risk error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to get token risk',
      },
      timestamp: new Date(),
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🔍 Validator Service running on port ${PORT}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Testar conexão e iniciar ingestão (com retry automático)
const connectAndStartIngestion = async (retries = 5, delay = 10000) => {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('SELECT NOW()');
      console.log('✅ Validator connected to database');

      if (process.env.ENABLE_INGESTION !== 'false') {
        const ingestion = new MemecoinIngestion({
          validator,
          pool,
          intervalMs: Number(process.env.INGESTION_INTERVAL_MS || 60_000),
          freshnessMinutes: Number(process.env.INGESTION_FRESHNESS_MINUTES || 180),
        });
        ingestion.start();
      } else {
        console.log('ℹ️  Memecoin ingestion disabled via ENABLE_INGESTION=false');
      }
      return; // Sucesso - sair do loop
    } catch (err: any) {
      const isLastAttempt = i === retries - 1;

      if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
        if (isLastAttempt) {
          console.warn('⚠️ Validator Service: Database not available yet');
          console.warn('⚠️ Service will continue to run but ingestion will not start');
          console.warn('⚠️ Make sure PostgreSQL/Supabase is running and DATABASE_URL is correct');
          console.warn('⚠️ Retrying connection every 30 seconds in background...');

          // Tentar reconectar em background a cada 30 segundos
          const retryInterval = setInterval(async () => {
            try {
              await pool.query('SELECT NOW()');
              console.log('✅ Validator connected to database (retry successful)');
              clearInterval(retryInterval);

              if (process.env.ENABLE_INGESTION !== 'false') {
                const ingestion = new MemecoinIngestion({
                  validator,
                  pool,
                  intervalMs: Number(process.env.INGESTION_INTERVAL_MS || 60_000),
                  freshnessMinutes: Number(process.env.INGESTION_FRESHNESS_MINUTES || 180),
                });
                ingestion.start();
              }
            } catch (retryErr: any) {
              // Silenciosamente continuar tentando
            }
          }, 30000);
        } else {
          console.log(`⏳ Attempt ${i + 1}/${retries} failed. Retrying in ${delay / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } else {
        // Outro tipo de erro - logar e sair
        console.error('❌ Failed to connect validator to database:', err.message);
        break;
      }
    }
  }
};

// Aguardar 5 segundos antes de tentar conectar (servidor precisa estar pronto)
setTimeout(() => {
  connectAndStartIngestion();
}, 5000);

export default app;
