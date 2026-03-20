import { Pool } from 'pg';
import { SignalAnalyzer } from './analyzer';
import axios from 'axios';

const SIGNAL_SERVICE_URL = process.env.SIGNAL_SERVICE_URL || 'http://localhost:4002';
const EXECUTOR_SERVICE_URL = process.env.EXECUTOR_SERVICE_URL || 'http://localhost:4003';

export class AutoAnalyzer {
  private pool: Pool;
  private analyzer: SignalAnalyzer;
  private interval: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(pool: Pool, analyzer: SignalAnalyzer) {
    this.pool = pool;
    this.analyzer = analyzer;
  }

  /**
   * Inicia análise automática periódica de tokens validados
   */
  start(intervalMinutes: number = 5): void {
    if (this.isRunning) {
      console.log('[AutoAnalyzer] Already running');
      return;
    }

    this.isRunning = true;
    const intervalMs = intervalMinutes * 60 * 1000;

    console.log(`🤖 AutoAnalyzer started - analyzing tokens every ${intervalMinutes} minutes`);

    // Executar imediatamente na primeira vez
    this.analyzeValidatedTokens();

    // Executar periodicamente
    this.interval = setInterval(() => {
      this.analyzeValidatedTokens();
    }, intervalMs);
  }

  /**
   * Para análise automática
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    console.log('[AutoAnalyzer] Stopped');
  }

  /**
   * Analisa tokens validados que não têm sinal ativo recente
   */
  private async analyzeValidatedTokens(): Promise<void> {
    try {
      // Testar conexão antes de iniciar ciclo
      await this.pool.query('SELECT NOW()');
      console.log('[AutoAnalyzer] Starting analysis cycle...');

      // Buscar tokens validados que não têm sinal ativo nos últimos 10 minutos
      const tokensResult = await this.pool.query(
        `SELECT t.id, t.symbol, t.name
         FROM tokens t
         WHERE t.is_validated = true
         AND t.validated_at > NOW() - INTERVAL '1 hour'
         AND (
           -- Token não tem sinal ativo
           NOT EXISTS (
             SELECT 1 FROM signals s 
             WHERE s.token_id = t.id 
             AND s.is_active = true
           )
           OR
           -- Último sinal tem mais de 10 minutos
           EXISTS (
             SELECT 1 FROM signals s 
             WHERE s.token_id = t.id 
             AND s.created_at < NOW() - INTERVAL '10 minutes'
           )
         )
         ORDER BY t.validated_at DESC
         LIMIT 10`
      );

      const tokens = tokensResult.rows;

      // Verificar se há tokens validados no total
      const totalValidatedResult = await this.pool.query(
        `SELECT COUNT(*) as count FROM tokens WHERE is_validated = true`
      );
      const totalValidated = Number(totalValidatedResult.rows[0]?.count ?? 0);

      console.log(`[AutoAnalyzer] 📊 Found ${tokens.length} tokens to analyze (total validated: ${totalValidated})`);

      if (tokens.length === 0) {
        if (totalValidated === 0) {
          console.log('[AutoAnalyzer] ⚠️ No validated tokens found in database yet. Waiting for validator to add tokens...');
          // Criar notificação informando que está aguardando tokens
          await this.createStatusNotification(totalValidated, 0);
        } else {
          console.log('[AutoAnalyzer] ℹ️ No tokens need analysis - all tokens have recent signals');
          // Criar notificação informando que todos os tokens já foram analisados
          await this.createStatusNotification(totalValidated, tokens.length);
        }
        return;
      }

      let analyzed = 0;
      let buySignals = 0;
      let sellSignals = 0;
      let holdSignals = 0;

      // Analisar cada token
      for (const token of tokens) {
        try {
          console.log(`[AutoAnalyzer] 🔍 Analyzing ${token.symbol} (${token.name})...`);

          const signal = await this.analyzer.analyzeToken(token.id);
          analyzed++;

          // Contar tipos de sinais
          if (signal.signal_type === 'BUY') buySignals++;
          else if (signal.signal_type === 'SELL') sellSignals++;
          else holdSignals++;

          // Buscar token completo para dispatch
          const tokenResult = await this.pool.query('SELECT * FROM tokens WHERE id = $1', [token.id]);
          const fullToken = tokenResult.rows[0];

          // Dispatch para Executor se for BUY/SELL
          if (signal.signal_type !== 'HOLD') {
            try {
              console.log(`[AutoAnalyzer] 📤 Dispatching ${signal.signal_type} signal to Executor for ${token.symbol}...`);
              const response = await axios.post(
                `${EXECUTOR_SERVICE_URL}/signals/process`,
                {
                  ...signal,
                  symbol: fullToken.symbol,
                  name: fullToken.name,
                },
                { timeout: 10000 }
              );
              console.log(`[AutoAnalyzer] ✅ ${signal.signal_type} signal dispatched successfully for ${token.symbol} (confidence: ${signal.confidence_score}%, multiplier: ${signal.potential_multiplier}x)`);
            } catch (error: any) {
              console.error(`[AutoAnalyzer] ❌ Failed to dispatch ${signal.signal_type} signal for ${token.symbol}:`, error.message);
              console.error(`[AutoAnalyzer] ❌ Error details:`, {
                url: `${EXECUTOR_SERVICE_URL}/signals/process`,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data,
              });
            }
          } else {
            console.log(`[AutoAnalyzer] ⏸️ HOLD signal for ${token.symbol} (confidence: ${signal.confidence_score}%) - no action`);
          }

          // Pequeno delay entre análises para não sobrecarregar
          await new Promise((resolve) => setTimeout(resolve, 3000)); // Aumentar delay para 3s
        } catch (error: any) {
          console.error(`[AutoAnalyzer] ❌ Error analyzing ${token.symbol}:`, error.message);
        }
      }

      console.log(`[AutoAnalyzer] ✅ Analysis cycle completed:`);
      console.log(`   📈 Analyzed: ${analyzed} tokens`);
      console.log(`   🟢 BUY signals: ${buySignals}`);
      console.log(`   🔴 SELL signals: ${sellSignals}`);
      console.log(`   ⏸️ HOLD signals: ${holdSignals}`);

      // Criar notificação de status a cada ciclo
      await this.createStatusNotification(
        await this.getTotalValidatedCount(),
        analyzed,
        buySignals,
        sellSignals,
        holdSignals
      );
    } catch (error: any) {
      // Tratar erros de conexão de forma mais amigável
      if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') {
        console.warn('[AutoAnalyzer] ⚠️ Database not available yet, skipping analysis cycle. Will retry on next interval.');
        console.warn('[AutoAnalyzer] ⚠️ Make sure PostgreSQL/Supabase is running and DATABASE_URL is correct');
      } else {
        console.error('[AutoAnalyzer] ❌ Error in analysis cycle:', error.message);
      }
    }
  }

  private async getTotalValidatedCount(): Promise<number> {
    try {
      const result = await this.pool.query(`SELECT COUNT(*) as count FROM tokens WHERE is_validated = true`);
      return Number(result.rows[0]?.count ?? 0);
    } catch {
      return 0;
    }
  }

  private async createStatusNotification(
    totalValidated: number,
    analyzed: number = 0,
    buySignals: number = 0,
    sellSignals: number = 0,
    holdSignals: number = 0
  ): Promise<void> {
    try {
      // Buscar um usuário real para as notificações de monitoramento
      // Priorizar o que estiver usando o bot (ou o primeiro da tabela)
      const userResult = await this.pool.query(
        'SELECT u.id FROM users u LEFT JOIN user_profiles p ON u.id = p.user_id ORDER BY p.bot_enabled DESC, u.created_at ASC LIMIT 1'
      );

      const defaultUserId = userResult.rows[0]?.id;
      if (!defaultUserId) {
        console.warn('[AutoAnalyzer] No user found for status notifications');
        return;
      }

      let message = '';
      let title = '';

      if (totalValidated === 0) {
        title = 'Aguardando tokens';
        message = `🤖 Estou aguardando tokens serem validados... O validator está buscando novos memecoins a cada minuto. Assim que encontrar tokens válidos, começarei a analisá-los!`;
      } else if (analyzed === 0) {
        title = 'Ciclo de análise';
        message = `🤖 Verifiquei ${totalValidated} token(s) validado(s). Todos já possuem sinais recentes. Aguardando próximo ciclo ou novos tokens...`;
      } else {
        title = 'Análise completa';
        message = `🤖 Completei uma análise de ${analyzed} token(s)! 📊 Total validados: ${totalValidated} | 🟢 BUY: ${buySignals} | 🔴 SELL: ${sellSignals} | ⏸️ HOLD: ${holdSignals}`;
      }

      // IMPORTANTE: Não criar notificação para cada ciclo de análise
      // Isso cria MUITAS notificações e lota o banco
      // Apenas criar notificação se houver BUY/SELL signals ou mudanças importantes
      // Notificações de status são muito frequentes e não são essenciais

      // Apenas criar notificação se houver sinais BUY ou SELL (ações importantes)
      if (buySignals > 0 || sellSignals > 0) {
        const recentNotification = await this.pool.query(
          `SELECT id FROM bot_notifications 
           WHERE user_id = $1 
           AND notification_type = 'monitoring_check'
           AND title = $2
           AND created_at > NOW() - INTERVAL '30 minutes'
           LIMIT 1`,
          [defaultUserId, title]
        );

        if (recentNotification.rows.length === 0) {
          await this.pool.query(
            `INSERT INTO bot_notifications (user_id, notification_type, severity, title, message, data)
             VALUES ($1, 'monitoring_check', 'success', $2, $3, $4::jsonb)`,
            [
              defaultUserId,
              title,
              message,
              JSON.stringify({
                total_validated: totalValidated,
                analyzed,
                buy_signals: buySignals,
                sell_signals: sellSignals,
                hold_signals: holdSignals,
                timestamp: new Date().toISOString()
              })
            ]
          );
        }
      } else {
        // Apenas logar no console para não lotar o banco
        console.log(`[AutoAnalyzer] ℹ️ Analysis cycle completed - ${analyzed} tokens, ${buySignals} BUY, ${sellSignals} SELL, ${holdSignals} HOLD`);
      }
    } catch (error: any) {
      console.warn('[AutoAnalyzer] Failed to create status notification:', error.message);
    }
  }
}

