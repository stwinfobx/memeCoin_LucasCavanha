import { Router, Response } from 'express';
import { pool } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import axios from 'axios';

const router = Router();

// Helper para garantir saldo inicial do usuário
async function ensureUserInitialBalance(userId: string): Promise<void> {
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
    
    // Criar notificação de depósito inicial
    await pool.query(
      `INSERT INTO bot_notifications (user_id, notification_type, severity, title, message, data)
       VALUES ($1, 'order_executed', 'success', 'Depósito inicial recebido', 
       'Saldo inicial de $${depositAmount} USD foi creditado para iniciar as simulações!', 
       $2::jsonb)`,
      [userId, JSON.stringify({ amount: depositAmount, type: 'deposit' })]
    );
  }
}

const allowedRiskProfiles = new Set(['conservative', 'moderate', 'aggressive']);

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  return false;
}

router.get('/status', authenticate, async (req: AuthRequest, res: Response) => {
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
    const result = await pool.query(
      `SELECT bot_enabled, bot_intensity, risk_profile, max_loss_percent, max_gain_percent, max_open_trades
       FROM user_profiles
       WHERE user_id = $1`,
      [userId]
    );

    const profile = result.rows[0] ?? {
      bot_enabled: false,
      bot_intensity: 5,
      risk_profile: 'moderate',
      max_loss_percent: 10,
      max_gain_percent: 25,
      max_open_trades: 3,
    };

    const botEnabled = toBoolean(profile.bot_enabled);
    
    // Se o bot estiver habilitado, verificar se há sinais ativos para processar
    if (botEnabled) {
      // Processar sinais em background se bot estiver habilitado
      processActiveSignalsForUser(userId).catch((error: any) => {
        console.error('[Bot Router] Error processing signals on status check:', error.message);
      });
    }

    res.json({
      success: true,
      data: {
        bot_enabled: botEnabled,
        bot_intensity: Number(profile.bot_intensity ?? 5),
        risk_profile: profile.risk_profile ?? 'moderate',
        max_loss_percent: Number(profile.max_loss_percent ?? 10),
        max_gain_percent: Number(profile.max_gain_percent ?? 25),
        max_open_trades: Number(profile.max_open_trades ?? 3),
      },
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[Bot] status error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BOT_STATUS_ERROR',
        message: error.message || 'Failed to load bot status',
      },
      timestamp: new Date(),
    });
  }
});

router.post('/config', authenticate, async (req: AuthRequest, res: Response) => {
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
    const {
      bot_enabled,
      bot_intensity,
      risk_profile,
      max_loss_percent,
      max_gain_percent,
      max_open_trades,
    } = req.body ?? {};

    const parsedRiskProfile = typeof risk_profile === 'string' && allowedRiskProfiles.has(risk_profile)
      ? risk_profile
      : 'moderate';

    const intensity = Number(bot_intensity ?? 5);
    const maxLoss = Number(max_loss_percent ?? 10);
    const maxGain = Number(max_gain_percent ?? 25);
    const maxOpenTrades = Number(max_open_trades ?? 3);

    await pool.query(
      `UPDATE user_profiles SET
         bot_enabled = $2,
         bot_intensity = $3,
         risk_profile = $4,
         max_loss_percent = $5,
         max_gain_percent = $6,
         max_open_trades = $7,
         updated_at = NOW()
       WHERE user_id = $1`,
      [
        userId,
        toBoolean(bot_enabled),
        Math.min(Math.max(intensity, 1), 10),
        parsedRiskProfile,
        Math.min(Math.max(maxLoss, 0), 100),
        Math.min(Math.max(maxGain, 0), 500),
        Math.min(Math.max(maxOpenTrades, 0), 100),
      ]
    );

    // Criar notificação
    const finalIntensity = Math.min(Math.max(intensity, 1), 10);
    await pool.query(
      `INSERT INTO bot_notifications (user_id, notification_type, severity, title, message, data)
       VALUES ($1, 'config_updated', 'info', 'Configurações atualizadas', 
       $2, 
       $3::jsonb)`,
      [
        userId,
        `Configurações do bot foram atualizadas: Intensidade ${finalIntensity}/10, Perfil de risco ${parsedRiskProfile}`,
        JSON.stringify({
          bot_intensity: finalIntensity,
          risk_profile: parsedRiskProfile,
          max_loss_percent: Math.min(Math.max(maxLoss, 0), 100),
          max_gain_percent: Math.min(Math.max(maxGain, 0), 500),
          max_open_trades: Math.min(Math.max(maxOpenTrades, 0), 100),
        }),
      ]
    );

    res.json({
      success: true,
      data: {
        bot_enabled: toBoolean(bot_enabled),
        bot_intensity: Math.min(Math.max(intensity, 1), 10),
        risk_profile: parsedRiskProfile,
        max_loss_percent: Math.min(Math.max(maxLoss, 0), 100),
        max_gain_percent: Math.min(Math.max(maxGain, 0), 500),
        max_open_trades: Math.min(Math.max(maxOpenTrades, 0), 100),
      },
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[Bot] config error]:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BOT_CONFIG_ERROR',
        message: error.message || 'Failed to update bot configuration',
      },
      timestamp: new Date(),
    });
  }
});

// Verificar saúde do Executor Service com retry
async function checkExecutorHealth(executorUrl: string, retries: number = 3): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(`${executorUrl}/health`, { timeout: 3000 });
      if (response.status === 200 && response.data?.status === 'ok') {
        console.log(`[Bot Router] ✅ Executor Service is healthy (attempt ${i + 1}/${retries})`);
        return true;
      }
    } catch (error: any) {
      console.warn(`[Bot Router] ⚠️ Executor Service health check failed (attempt ${i + 1}/${retries}):`, error.message);
      if (i < retries - 1) {
        // Backoff exponencial: 1s, 2s, 4s
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
      }
    }
  }
  return false;
}

// Processar sinais ativos imediatamente quando o bot é iniciado
async function processActiveSignalsForUser(userId: string): Promise<void> {
  const EXECUTOR_SERVICE_URL = process.env.EXECUTOR_SERVICE_URL || 'http://localhost:4003';
  
  try {
    console.log(`[Bot Router] 🔍 Starting signal processing for user ${userId}...`);
    
    // Verificar saúde do Executor Service antes de processar
    const executorHealthy = await checkExecutorHealth(EXECUTOR_SERVICE_URL);
    if (!executorHealthy) {
      console.error(`[Bot Router] ❌ Executor Service is not available at ${EXECUTOR_SERVICE_URL}`);
      await pool.query(
        `INSERT INTO bot_notifications (user_id, notification_type, severity, title, message, data)
         VALUES ($1, 'error', 'error', 'Executor Service indisponível', $2, $3::jsonb)`,
        [
          userId,
          '🤖 ⚠️ Executor Service está indisponível. Não foi possível processar sinais. Tentando novamente em breve...',
          JSON.stringify({ executor_url: EXECUTOR_SERVICE_URL, status: 'executor_unavailable' })
        ]
      );
      return;
    }
    
    // Buscar sinais BUY E SELL ativos recentes (últimas 24h)
    // IMPORTANTE: Processar SELL também para fechar posições rapidamente
    console.log(`[Bot Router] 📊 Searching for active BUY and SELL signals...`);
    const signalsResult = await pool.query(
      `SELECT s.*, t.symbol, t.name 
       FROM signals s
       JOIN tokens t ON s.token_id = t.id
       WHERE s.signal_type IN ('BUY', 'SELL')
       AND s.is_active = true
       AND s.created_at > NOW() - INTERVAL '24 hours'
       ORDER BY s.signal_type DESC, s.created_at DESC
       LIMIT 20`
    );
    
    const signals = signalsResult.rows;
    const buySignals = signals.filter((s: any) => s.signal_type === 'BUY');
    const sellSignals = signals.filter((s: any) => s.signal_type === 'SELL');
    console.log(`[Bot Router] 📊 Found ${signals.length} active signals (${buySignals.length} BUY, ${sellSignals.length} SELL) to process for user ${userId}`);
    
    if (signals.length === 0) {
      // Criar notificação informando que não há sinais ativos
      console.log(`[Bot Router] ℹ️ No active signals found for user ${userId}`);
      await pool.query(
        `INSERT INTO bot_notifications (user_id, notification_type, severity, title, message, data)
         VALUES ($1, 'info', 'info', 'Aguardando sinais', $2, $3::jsonb)`,
        [
          userId,
          '🤖 Bot iniciado! Estou monitorando tokens validados. Assim que identificar oportunidades (BUY/SELL), executarei trades automaticamente...',
          JSON.stringify({ signals_found: 0, status: 'monitoring' })
        ]
      );
      return;
    }
    
    // IMPORTANTE: Não criar notificação para cada processamento de sinais
    // Isso cria muitas notificações e lota o banco
    // Apenas logar no console
    console.log(`[Bot Router] 📤 Processing ${signals.length} active signals (${buySignals.length} BUY, ${sellSignals.length} SELL) for user ${userId}...`);
    
    // Processar cada sinal com retry
    let processed = 0;
    let failed = 0;
    
    for (let i = 0; i < signals.length; i++) {
      const signal = signals[i];
      let success = false;
      
      // Retry até 3 vezes para cada sinal
      for (let retry = 0; retry < 3; retry++) {
        try {
          console.log(`[Bot Router] 📤 Processing signal ${signal.id} (${signal.symbol}) - attempt ${retry + 1}/3...`);
          
          const response = await axios.post(
            `${EXECUTOR_SERVICE_URL}/signals/process`,
            {
              ...signal,
              symbol: signal.symbol,
              name: signal.name,
            },
            { 
              timeout: 15000, // Aumentar timeout para 15s
              validateStatus: (status) => status >= 200 && status < 500
            }
          );
          
          if (response.status === 200 && response.data?.success !== false) {
            processed++;
            success = true;
            console.log(`[Bot Router] ✅ Successfully processed signal ${signal.id} (${signal.symbol}) for user ${userId}`);
            break; // Sucesso, sair do loop de retry
          } else {
            throw new Error(`Executor returned status ${response.status}: ${JSON.stringify(response.data)}`);
          }
        } catch (error: any) {
          const errorMessage = error.response?.data?.error?.message || error.message || 'Unknown error';
          const errorCode = error.response?.status || error.code || 'UNKNOWN';
          
          console.error(`[Bot Router] ❌ Error processing signal ${signal.id} (attempt ${retry + 1}/3):`, {
            message: errorMessage,
            code: errorCode,
            stack: error.stack
          });
          
          if (retry < 2) {
            // Backoff exponencial: 1s, 2s
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, retry) * 1000));
          } else {
            // Última tentativa falhou
            failed++;
            console.error(`[Bot Router] ❌ Failed to process signal ${signal.id} after 3 attempts`);
            
            // Criar notificação de erro para este sinal
            try {
              await pool.query(
                `INSERT INTO bot_notifications (user_id, notification_type, severity, title, message, data)
                 VALUES ($1, 'warning', 'warning', 'Erro ao processar sinal', $2, $3::jsonb)`,
                [
                  userId,
                  `🤖 ⚠️ Não consegui processar sinal ${signal.signal_type} para ${signal.symbol}: ${errorMessage}`,
                  JSON.stringify({ 
                    signal_id: signal.id, 
                    signal_type: signal.signal_type,
                    symbol: signal.symbol, 
                    error: errorMessage,
                    error_code: errorCode
                  })
                ]
              );
            } catch (notifError) {
              console.error(`[Bot Router] ❌ Failed to create error notification:`, notifError);
            }
          }
        }
      }
      
      // Delay entre sinais para não sobrecarregar
      if (i < signals.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
    
    // Notificação de conclusão
    console.log(`[Bot Router] 📊 Processing complete: ${processed} succeeded, ${failed} failed`);
    
    if (processed > 0) {
      await pool.query(
        `INSERT INTO bot_notifications (user_id, notification_type, severity, title, message, data)
         VALUES ($1, 'success', 'success', 'Sinais processados', $2, $3::jsonb)`,
        [
          userId,
          `🤖 ✅ Processei ${processed} de ${signals.length} sinal(is) (${buySignals.length} BUY, ${sellSignals.length} SELL) com sucesso! ${failed > 0 ? `(${failed} falharam)` : ''} Verificando oportunidades de trading...`,
          JSON.stringify({ 
            signals_processed: processed, 
            signals_total: signals.length,
            buy_signals: buySignals.length,
            sell_signals: sellSignals.length,
            signals_failed: failed,
            status: 'completed' 
          })
        ]
      );
    }
  } catch (error: any) {
    console.error('[Bot Router] ❌ Critical error processing active signals:', {
      message: error.message,
      stack: error.stack,
      userId
    });
    
    try {
      await pool.query(
        `INSERT INTO bot_notifications (user_id, notification_type, severity, title, message, data)
         VALUES ($1, 'error', 'error', 'Erro ao processar sinais', $2, $3::jsonb)`,
        [
          userId,
          `🤖 ⚠️ Erro crítico ao processar sinais ativos: ${error.message}. Continuando monitoramento...`,
          JSON.stringify({ 
            error: error.message, 
            error_stack: error.stack,
            executor_url: EXECUTOR_SERVICE_URL,
            status: 'error' 
          })
        ]
      );
    } catch (notifError: any) {
      console.error('[Bot Router] ❌ Failed to create error notification:', notifError.message);
    }
  }
}

router.post('/start', authenticate, async (req: AuthRequest, res: Response) => {
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
    await ensureUserInitialBalance(userId);

    await pool.query(
      `UPDATE user_profiles SET bot_enabled = true, updated_at = NOW() WHERE user_id = $1`,
      [userId]
    );

    // Criar notificação
    await pool.query(
      `INSERT INTO bot_notifications (user_id, notification_type, severity, title, message, data)
       VALUES ($1, 'bot_started', 'success', 'Bot iniciado', $2, $3::jsonb)`,
      [
        userId,
        '🤖 Bot iniciado! Estou analisando oportunidades de trading... Verificando tokens validados e processando sinais ativos...',
        JSON.stringify({ status: 'started', timestamp: new Date().toISOString() })
      ]
    );

    // Processar sinais ativos imediatamente (não bloqueante)
    console.log(`[Bot Router] 🚀 Starting background signal processing for user ${userId}...`);
    processActiveSignalsForUser(userId).catch((error: any) => {
      console.error('[Bot Router] ❌ Error processing active signals on start:', {
        message: error.message,
        stack: error.stack,
        userId
      });
    });

    res.json({
      success: true,
      data: { bot_enabled: true },
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[Bot] start error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BOT_START_ERROR',
        message: error.message || 'Failed to start bot',
      },
      timestamp: new Date(),
    });
  }
});

router.post('/stop', authenticate, async (req: AuthRequest, res: Response) => {
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
    await pool.query(
      `UPDATE user_profiles SET bot_enabled = false, updated_at = NOW() WHERE user_id = $1`,
      [userId]
    );

    // Criar notificação
    await pool.query(
      `INSERT INTO bot_notifications (user_id, notification_type, severity, title, message)
       VALUES ($1, 'bot_stopped', 'info', 'Bot parado', 'O bot de trading foi parado. Nenhuma nova operação será executada.')`,
      [userId]
    );

    res.json({
      success: true,
      data: { bot_enabled: false },
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[Bot] stop error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BOT_STOP_ERROR',
        message: error.message || 'Failed to stop bot',
      },
      timestamp: new Date(),
    });
  }
});

// Endpoint de diagnóstico
router.get('/diagnostic', authenticate, async (req: AuthRequest, res: Response) => {
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
    const EXECUTOR_SERVICE_URL = process.env.EXECUTOR_SERVICE_URL || 'http://localhost:4003';
    
    // Buscar status do bot no banco
    const profileResult = await pool.query(
      `SELECT bot_enabled, bot_intensity, risk_profile, max_open_trades
       FROM user_profiles
       WHERE user_id = $1`,
      [userId]
    );
    
    const profile = profileResult.rows[0] ?? null;
    const botEnabled = profile ? toBoolean(profile.bot_enabled) : false;
    
    // Contar sinais BUY ativos
    const signalsResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM signals
       WHERE signal_type = 'BUY' 
       AND is_active = true
       AND created_at > NOW() - INTERVAL '24 hours'`
    );
    const activeSignalsCount = Number(signalsResult.rows[0]?.count ?? 0);
    
    // Verificar saldo do usuário
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
    const balance = Math.max(0, credits - debits);
    
    // Verificar notificações recentes
    const notificationsResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM bot_notifications
       WHERE user_id = $1
       AND created_at > NOW() - INTERVAL '1 hour'`
    );
    const recentNotificationsCount = Number(notificationsResult.rows[0]?.count ?? 0);
    
    // Verificar saúde do Executor Service
    let executorHealthy = false;
    let executorError = null;
    try {
      const healthResponse = await axios.get(`${EXECUTOR_SERVICE_URL}/health`, { timeout: 3000 });
      executorHealthy = healthResponse.status === 200 && healthResponse.data?.status === 'ok';
    } catch (error: any) {
      executorError = error.message;
    }
    
    // Verificar posições abertas
    const positionsResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM positions
       WHERE user_id = $1 AND status = 'open'`,
      [userId]
    );
    const openPositionsCount = Number(positionsResult.rows[0]?.count ?? 0);

    res.json({
      success: true,
      data: {
        bot: {
          enabled: botEnabled,
          intensity: profile ? Number(profile.bot_intensity ?? 5) : 5,
          risk_profile: profile?.risk_profile ?? 'moderate',
          max_open_trades: profile ? Number(profile.max_open_trades ?? 3) : 3,
        },
        signals: {
          active_buy_count: activeSignalsCount,
        },
        balance: {
          current: balance,
          credits,
          debits,
        },
        positions: {
          open: openPositionsCount,
        },
        notifications: {
          recent_count: recentNotificationsCount,
        },
        services: {
          executor: {
            url: EXECUTOR_SERVICE_URL,
            healthy: executorHealthy,
            error: executorError,
          },
        },
      },
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[Bot] diagnostic error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BOT_DIAGNOSTIC_ERROR',
        message: error.message || 'Failed to get diagnostic information',
      },
      timestamp: new Date(),
    });
  }
});

export default router;
