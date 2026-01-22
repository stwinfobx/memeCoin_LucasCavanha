import './env';
import { Pool } from 'pg';
import crypto from 'crypto';
import {
  Order,
  ExecuteOrderRequest,
  UserProfile,
  Signal,
  SignalType,
  Token,
} from '@shared/types';
import { TradingStrategyManager } from './strategies/trading-strategy';
import { calculateRSI, interpretRSI } from '../../signal/src/technical-analysis/rsi';
import { detectPeak } from '../../signal/src/technical-analysis/peak-detection';
import { PriceCollector } from '../../signal/src/workers/price-collector';
import { RealTradingService } from './real-trading-service';

const DEFAULT_POSITION_FACTOR = {
  conservative: 0.01,
  moderate: 0.03,
  aggressive: 0.06,
};

export class TradeExecutor {
  private pool: Pool;
  private executionMode: 'simulation' | 'live';
  private defaultUserId: string = 'f58986be-9f49-4a63-9c44-937bfed78362'; // fallback ID for paper trading
  private strategyManager: TradingStrategyManager;
  private realTradingService: RealTradingService; // NOVO

  constructor(pool: Pool) {
    this.pool = pool;
    // Determine mode from env (default to simulation)
    const mode = process.env.BOT_EXECUTION_MODE?.toLowerCase();
    this.executionMode = mode === 'live' ? 'live' : 'simulation';
    console.log(`[Executor] 🤖 Node Env: ${process.env.NODE_ENV}`);
    console.log(`[Executor] 💰 Execution mode: ${this.executionMode === 'live' ? '🔥 LIVE' : '📝 SIMULATION'}`);

    // Use provided paper user ID only when in simulation mode
    this.defaultUserId = process.env.EXECUTOR_DEFAULT_USER_ID || 'f58986be-9f49-4a63-9c44-937bfed78362';
    this.strategyManager = new TradingStrategyManager(pool);
    this.realTradingService = new RealTradingService(pool); // NOVO
  }

  private async ensureDefaultUser(): Promise<string> {
    const userId = this.defaultUserId;

    // Se estivermos em modo LIVE, não criamos usuário fake nem depositamos saldo de mentira
    if (this.executionMode === 'live') {
      console.log(`[Executor] 🚨 LIVE MODE: Skipping paper trading user creation and initial deposit.`);
      return userId;
    }

    const userResult = await this.pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userResult.rowCount === 0) {
      await this.pool.query(
        `INSERT INTO users (id, email, password_hash, mfa_enabled, is_active)
         VALUES ($1, $2, $3, false, true)
         ON CONFLICT (id) DO NOTHING`,
        [userId, 'paper@tradingbot.ai', '$argon2id$v=19$m=65536,t=2,p=1$R29vZEdvb2Q$z4ZpF15VITQjC1ifKpF0Kg']
      );
      await this.pool.query(
        `INSERT INTO user_profiles (user_id, risk_profile, bot_enabled, bot_intensity, max_loss_percent, max_gain_percent, max_open_trades)
         VALUES ($1, 'aggressive', true, 10, 10, 25, 5)
         ON CONFLICT (user_id) DO UPDATE SET
           bot_enabled = true,
           bot_intensity = 10,
           risk_profile = 'aggressive',
           max_open_trades = 5`,
        [userId]
      );
      console.log(`[Executor] ✅ Paper trading user profile created/updated with bot enabled`);
    }

    // Garantir que o usuário tenha saldo inicial de $100 USD para simulação
    // Calcular saldo correto (créditos - débitos)
    const balanceResult = await this.pool.query(
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
      // Criar depósito inicial de $100 USD
      const depositAmount = 100 - currentBalance;
      await this.pool.query(
        `INSERT INTO ledger_entries (user_id, entry_type, amount_usd, description, balance_before, balance_after)
         VALUES ($1, 'deposit', $2, 'Initial paper trading deposit', $3, $4)`,
        [userId, depositAmount, currentBalance, currentBalance + depositAmount]
      );
      console.log(`[Executor] 💰 Created initial deposit of $${depositAmount} for paper trading user | Balance before: $${currentBalance.toFixed(2)} | Balance after: $${(currentBalance + depositAmount).toFixed(2)}`);

      // Criar notificação de saldo inicial
      await this.createNotification(
        userId,
        'order_executed',
        'success',
        'Sistema iniciado',
        `🤖 Sistema de trading iniciado! Saldo inicial de $${depositAmount} USD foi creditado. Aguardando oportunidades de trading...`,
        { amount: depositAmount, type: 'initial_deposit' }
      );
    } else {
      console.log(`[Executor] 💰 User balance: $${currentBalance.toFixed(2)} | Ready for trading`);
    }

    return userId;
  }

  public async getDefaultUserId(): Promise<string> {
    return this.ensureDefaultUser();
  }

  private async calculatePositionSize(userId: string, totalBalance: number): Promise<number> {
    const profileResult = await this.pool.query('SELECT risk_profile FROM user_profiles WHERE user_id = $1', [userId]);
    const profile = (profileResult.rows[0] as UserProfile | undefined)?.risk_profile ?? 'moderate';
    const riskFactor = DEFAULT_POSITION_FACTOR[profile as keyof typeof DEFAULT_POSITION_FACTOR] ?? 0.03;
    // Se não houver saldo, o investimento deve ser zero.
    if (totalBalance <= 0) return 0;
    return totalBalance * riskFactor;
  }

  /**
   * Calcula valor investido baseado em confiança do sinal
   */
  async calculateIntendedInvestment(
    userId: string,
    tokenId: string,
    signalId?: string
  ): Promise<{ amountUsd: number; baseAmount: number; confidenceFactor: number; multiplierFactor: number; available_balance: number }> {
    // CORRIGIDO: Calcular saldo usando depósitos + lucros/perdas realizados das orders
    // trade_profit do ledger representa valor total recebido, não lucro
    // IMPORTANTE: Filtrar depósitos falsos se estivermos em modo LIVE
    const paperDepositFilter = this.executionMode === 'live' ? "AND description NOT ILIKE '%paper trading%'" : "";

    const depositsResult = await this.pool.query(
      `SELECT COALESCE(SUM(CASE WHEN entry_type = 'deposit' THEN amount_usd ELSE 0 END), 0) AS total_deposits
       FROM ledger_entries
       WHERE user_id = $1 ${paperDepositFilter}`,
      [userId]
    );
    const totalDeposits = Number(depositsResult.rows[0]?.total_deposits ?? 0);

    // Buscar lucros/perdas realizados das orders SELL
    // IMPORTANTE: Filtrar ordens sem transaction_hash (simulações) se estivermos em modo LIVE
    const realOrderFilter = this.executionMode === 'live' ? "AND transaction_hash IS NOT NULL" : "";

    const realizedPLResult = await this.pool.query(
      `SELECT 
         COALESCE(SUM(profit_loss_usd) FILTER (WHERE order_type = 'SELL' AND status = 'completed' AND profit_loss_usd > 0), 0) AS realized_profit,
         COALESCE(SUM(ABS(profit_loss_usd)) FILTER (WHERE order_type = 'SELL' AND status = 'completed' AND profit_loss_usd < 0), 0) AS realized_loss
       FROM orders
       WHERE user_id = $1 ${realOrderFilter}`,
      [userId]
    );
    const realizedProfit = Number(realizedPLResult.rows[0]?.realized_profit ?? 0);
    const realizedLoss = Number(realizedPLResult.rows[0]?.realized_loss ?? 0);

    // Saldo total = depósitos + lucros realizados - perdas realizadas
    const totalBalance = Math.max(0, totalDeposits + realizedProfit - realizedLoss);

    // Buscar investido em posições abertas
    const openPositionsResult = await this.pool.query(
      `SELECT COALESCE(SUM(invested_amount_usd), 0) AS total_invested
       FROM positions
       WHERE user_id = $1 AND status = 'open'`,
      [userId]
    );
    const investedInPositions = Number(openPositionsResult.rows[0]?.total_invested ?? 0);

    // Saldo disponível = saldo total - investido em posições abertas
    const availableBalance = Math.max(0, totalBalance - investedInPositions);

    console.log(`[Executor] 💰 Balance calculation for user ${userId}:`, {
      total_balance: totalBalance,
      invested_in_positions: investedInPositions,
      available_balance: availableBalance
    });

    // Verificar se há saldo disponível mínimo
    if (availableBalance < 5) {
      console.log(`[Executor] ⚠️ Insufficient available balance: $${availableBalance.toFixed(2)} (minimum: $5.00)`);
      return {
        amountUsd: 0,
        baseAmount: 0,
        confidenceFactor: 0,
        multiplierFactor: 0,
        available_balance: availableBalance
      };
    }

    // Calcular base amount usando perfil de risco baseado no saldo disponível
    const baseAmount = await this.calculatePositionSize(userId, availableBalance);

    // Buscar sinal se fornecido
    let confidenceScore = 50; // Default se não houver sinal
    let multiplierFactor = 1.0;
    if (signalId) {
      const signalResult = await this.pool.query('SELECT confidence_score, potential_multiplier FROM signals WHERE id = $1', [
        signalId,
      ]);
      if (signalResult.rows.length > 0) {
        confidenceScore = Number(signalResult.rows[0].confidence_score ?? 50);
        const potentialMultiplier = Number(signalResult.rows[0].potential_multiplier ?? 1.0);
        // Multiplier factor varia de 0.5 (confiança baixa) a 2.0 (confiança alta)
        multiplierFactor = Math.min(2.0, Math.max(0.5, potentialMultiplier * 0.4));
      }
    }

    // Fator de confiança (50% confiança = 1.0, 100% = 2.0, 30% = 0.5)
    const confidenceFactor = Math.min(2.0, Math.max(0.5, confidenceScore / 50));

    // Calcular investimento final
    let investAmount = baseAmount * confidenceFactor * multiplierFactor;

    // Se o valor calculado for zero ou menor, abortar
    if (investAmount <= 0) return { amountUsd: 0, baseAmount: 0, confidenceFactor: 0, multiplierFactor: 0, available_balance: availableBalance };

    // Limites: mínimo $5, máximo 20% do saldo disponível
    // IMPORTANTE: Não pode exceder o saldo disponível!
    const maxInvest = availableBalance * 0.2;
    investAmount = Math.min(Math.min(maxInvest, availableBalance), Math.max(5, investAmount)); // Garantir que não excede saldo disponível

    console.log(`[Executor] 📊 Investment calculation:`, {
      base_amount: baseAmount,
      confidence_factor: confidenceFactor,
      multiplier_factor: multiplierFactor,
      calculated_amount: baseAmount * confidenceFactor * multiplierFactor,
      max_invest: maxInvest,
      final_amount: investAmount,
      available_balance: availableBalance
    });

    return {
      amountUsd: Number(investAmount.toFixed(2)),
      baseAmount: Number(baseAmount.toFixed(2)),
      confidenceFactor: Number(confidenceFactor.toFixed(2)),
      multiplierFactor: Number(multiplierFactor.toFixed(2)),
      available_balance: availableBalance
    };
  }

  private generateTxHash(): string {
    return `0x${crypto.randomBytes(32).toString('hex')}`;
  }

  private async simulateBuy(order: Order, token: Token): Promise<void> {
    const price = Number(token.price_usd ?? 0.0001);
    const investedAmount = Number((order as any).invested_amount_usd ?? order.amount_usd ?? 0);
    const amountToken = investedAmount / price;

    // CORRIGIDO: Calcular saldo disponível antes da compra
    // IMPORTANTE: Filtrar depósitos falsos/simulações se estivermos em modo LIVE
    const paperDepositFilter = this.executionMode === 'live' ? "AND description NOT ILIKE '%paper trading%'" : "";
    const realOrderFilter = this.executionMode === 'live' ? "AND transaction_hash IS NOT NULL" : "";

    const depositsResult = await this.pool.query(
      `SELECT COALESCE(SUM(CASE WHEN entry_type = 'deposit' THEN amount_usd ELSE 0 END), 0) AS total_deposits
       FROM ledger_entries
       WHERE user_id = $1 ${paperDepositFilter}`,
      [order.user_id]
    );
    const totalDeposits = Number(depositsResult.rows[0]?.total_deposits ?? 0);

    const realizedPLResult = await this.pool.query(
      `SELECT 
         COALESCE(SUM(profit_loss_usd) FILTER (WHERE order_type = 'SELL' AND status = 'completed' AND profit_loss_usd > 0), 0) AS realized_profit,
         COALESCE(SUM(ABS(profit_loss_usd)) FILTER (WHERE order_type = 'SELL' AND status = 'completed' AND profit_loss_usd < 0), 0) AS realized_loss
       FROM orders
       WHERE user_id = $1 ${realOrderFilter}`,
      [order.user_id]
    );
    const realizedProfit = Number(realizedPLResult.rows[0]?.realized_profit ?? 0);
    const realizedLoss = Number(realizedPLResult.rows[0]?.realized_loss ?? 0);

    // Buscar investido em posições abertas
    const openPositionsResult = await this.pool.query(
      `SELECT COALESCE(SUM(invested_amount_usd), 0) AS total_invested
       FROM positions
       WHERE user_id = $1 AND status = 'open'`,
      [order.user_id]
    );
    const investedInPositions = Number(openPositionsResult.rows[0]?.total_invested ?? 0);

    // Saldo total = depósitos + lucros realizados - perdas realizadas
    const totalBalance = Math.max(0, totalDeposits + realizedProfit - realizedLoss);
    // Saldo disponível = saldo total - investido em posições abertas
    const balanceBefore = Math.max(0, totalBalance - investedInPositions);
    const balanceAfter = Math.max(0, balanceBefore - investedAmount);

    // Atualizar ordem
    await this.pool.query(
      `UPDATE orders SET
         status = 'completed',
         amount_token = $1,
         price_usd = $2,
         transaction_hash = $3,
         invested_amount_usd = $4,
         executed_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
      [amountToken, price, this.generateTxHash(), investedAmount, order.id]
    );

    // IMPORTANTE: NÃO registrar como trade_loss! 
    // Uma compra não é uma perda, é investimento em posição aberta.
    // O saldo disponível diminui porque o dinheiro está investido em tokens.
    // Quando vender, aí sim vamos calcular se houve lucro ou perda.
    // Registramos apenas para histórico/auditoria, mas não como trade_loss

    console.log(`[Executor] 💸 Simulated BUY: Invested $${investedAmount.toFixed(2)} in ${token.symbol} | Available balance: $${balanceBefore.toFixed(2)} → $${balanceAfter.toFixed(2)} | Total invested in positions: $${(investedInPositions + investedAmount).toFixed(2)}`);
  }

  /**
   * Cria ou atualiza posição após ordem BUY/SELL
   */
  private async createOrUpdatePosition(order: Order, token: Token, action: 'buy' | 'sell'): Promise<void> {
    if (action === 'buy') {
      // Criar ou atualizar posição aberta
      const investedAmount = Number((order as any).invested_amount_usd ?? order.amount_usd ?? 0);
      const price = Number(token.price_usd ?? 0.0001);
      const amountToken = investedAmount / price;

      const existingPosition = await this.pool.query(
        `SELECT id, token_balance, invested_amount_usd FROM positions 
         WHERE user_id = $1 AND token_id = $2 AND status = 'open'`,
        [order.user_id, order.token_id]
      );

      if (existingPosition.rows.length > 0) {
        // Atualizar posição existente (average buy price)
        const pos = existingPosition.rows[0];
        const oldBalance = Number(pos.token_balance ?? 0);
        const oldInvested = Number(pos.invested_amount_usd ?? 0);
        const newBalance = oldBalance + amountToken;
        const newInvested = oldInvested + investedAmount;
        const avgPrice = newInvested / newBalance;

        await this.pool.query(
          `UPDATE positions SET
             invested_amount_usd = $1,
             token_balance = $2,
             buy_price_usd = $3,
             current_price_usd = $4,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $5`,
          [newInvested, newBalance, avgPrice, price, pos.id]
        );
      } else {
        // Criar nova posição
        await this.pool.query(
          `INSERT INTO positions (
             user_id, token_id, order_id, signal_id, invested_amount_usd, buy_price_usd,
             buy_time, current_price_usd, token_balance, status
           ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7, $8, 'open')`,
          [order.user_id, order.token_id, order.id, order.signal_id, investedAmount, price, price, amountToken]
        );

        // Criar notificação de posição aberta
        await this.createNotification(
          order.user_id,
          'position_opened',
          'success',
          'Nova posição aberta',
          `🤖 Abri uma posição em ${token.symbol}! Investi $${investedAmount.toFixed(2)} a $${price.toFixed(6)} por token. Monitorando...`,
          { order_id: order.id, symbol: token.symbol, invested: investedAmount, price, tokens: amountToken }
        );
      }
    } else if (action === 'sell') {
      // Fechar ou reduzir posição
      const price = Number(token.price_usd ?? 0.0001);
      const amountToken = Number(order.amount_token ?? 0);
      const soldValue = amountToken * price;

      // Buscar posição da mesma forma que simulateSell para garantir consistência
      const positionResult = await this.pool.query(
        `SELECT id, token_balance, invested_amount_usd, buy_price_usd, buy_time
         FROM positions 
         WHERE user_id = $1 AND token_id = $2 AND status = 'open'
         ORDER BY buy_time ASC LIMIT 1`,
        [order.user_id, order.token_id]
      );

      if (positionResult.rows.length > 0) {
        const pos = positionResult.rows[0];
        const currentBalance = Number(pos.token_balance ?? 0);
        const investedAmount = Number(pos.invested_amount_usd ?? 0);
        const buyPrice = Number(pos.buy_price_usd ?? price);
        const buyTime = new Date(pos.buy_time);

        if (amountToken >= currentBalance) {
          // Fechar posição completamente
          // Validação: evitar divisão por zero
          if (currentBalance <= 0) {
            throw new Error(`Invalid position balance: ${currentBalance} for position ${pos.id}`);
          }
          const ratio = Math.min(1, Math.max(0, amountToken / currentBalance));
          const investedForSold = investedAmount * ratio;
          let profitLoss = soldValue - investedForSold;
          // Validação: evitar divisão por zero no cálculo de percentual
          let profitLossPercent = investedForSold > 0 && !isNaN(investedForSold) && isFinite(investedForSold)
            ? (profitLoss / investedForSold) * 100
            : 0;
          const holdTimeHours = (Date.now() - buyTime.getTime()) / (1000 * 60 * 60);
          const isProfit = profitLoss >= 0;

          // Garantir que os valores são números válidos
          if (isNaN(profitLoss) || !isFinite(profitLoss)) {
            console.warn(`[Executor] Invalid profitLoss calculated: ${profitLoss}, setting to 0`);
            profitLoss = 0;
          }
          if (isNaN(profitLossPercent) || !isFinite(profitLossPercent)) {
            console.warn(`[Executor] Invalid profitLossPercent calculated: ${profitLossPercent}, setting to 0`);
            profitLossPercent = 0;
          }

          await this.pool.query(
            `UPDATE positions SET
               status = 'closed',
               closed_at = CURRENT_TIMESTAMP,
               token_balance = 0,
               current_price_usd = $1,
               profit_loss_usd = $2,
               profit_loss_percent = $3,
               hold_time_hours = $4,
               updated_at = CURRENT_TIMESTAMP
             WHERE id = $5`,
            [price, profitLoss, profitLossPercent, holdTimeHours, pos.id]
          );

          // Buscar símbolo do token para notificação
          const tokenResult = await this.pool.query('SELECT symbol FROM tokens WHERE id = $1', [order.token_id]);
          const tokenSymbol = tokenResult.rows[0]?.symbol || 'unknown';

          // Criar notificação de posição fechada
          await this.createNotification(
            order.user_id,
            'position_closed',
            isProfit ? 'success' : 'warning',
            'Posição fechada',
            `🤖 ${isProfit ? '🎉' : '⚠️'} Fechei a posição em ${tokenSymbol}! ${isProfit ? 'Ganho' : 'Perda'} de $${Math.abs(profitLoss).toFixed(2)} (${Math.abs(profitLossPercent).toFixed(2)}%). Continuando análise...`,
            { order_id: order.id, symbol: tokenSymbol, profit_loss: profitLoss, profit_loss_percent: profitLossPercent, hold_time_hours: holdTimeHours }
          );

          // Atualizar order com valores de profit/loss
          await this.pool.query(
            `UPDATE orders SET
               profit_loss_usd = $1,
               profit_loss_percent = $2,
               hold_time_hours = $3
             WHERE id = $4`,
            [profitLoss, profitLossPercent, holdTimeHours, order.id]
          );
        } else {
          // Reduzir posição parcialmente
          const ratio = amountToken / currentBalance;
          const investedForSold = investedAmount * ratio;
          const profitLoss = soldValue - investedForSold;
          const newBalance = currentBalance - amountToken;
          const newInvested = investedAmount - investedForSold;

          await this.pool.query(
            `UPDATE positions SET
               token_balance = $1,
               invested_amount_usd = $2,
               current_price_usd = $3,
               updated_at = CURRENT_TIMESTAMP
             WHERE id = $4`,
            [newBalance, newInvested, price, pos.id]
          );
        }
      }
    }
  }

  private async simulateSell(order: Order, token: Token): Promise<void> {
    const price = Number(token.price_usd ?? 0.0001);
    const amountToken = Number(order.amount_token ?? 0);
    // Usar amount_usd da ordem (já calculado corretamente) ao invés de recalcular
    // Isso garante consistência mesmo se o preço mudar entre a criação da ordem e a simulação
    let amountUsd = Number(order.amount_usd ?? (amountToken * price));

    // Validação: se amountUsd não foi salvo na ordem ou está inválido, recalcular
    if (!amountUsd || amountUsd <= 0 || isNaN(amountUsd) || !isFinite(amountUsd)) {
      console.warn(`[Executor] ⚠️ amountUsd inválido na ordem ${order.id}, recalculando: ${amountUsd}`);
      amountUsd = amountToken * price;
      if (amountUsd <= 0 || isNaN(amountUsd) || !isFinite(amountUsd)) {
        throw new Error(`Invalid amountUsd: ${amountUsd} (amountToken: ${amountToken}, price: ${price})`);
      }
    }

    // Buscar posição para calcular profit/loss
    // IMPORTANTE: Buscar a posição da mesma forma que createOrUpdatePosition para garantir consistência
    const positionResult = await this.pool.query(
      `SELECT id, invested_amount_usd, buy_price_usd, buy_time, token_balance
       FROM positions 
       WHERE user_id = $1 AND token_id = $2 AND status = 'open'
       ORDER BY buy_time ASC LIMIT 1`,
      [order.user_id, order.token_id]
    );

    let profitLossUsd = 0;
    let profitLossPercent = 0;
    let holdTimeHours = 0;

    if (positionResult.rows.length > 0) {
      const pos = positionResult.rows[0];
      const totalInvested = Number(pos.invested_amount_usd ?? 0);
      const buyPrice = Number(pos.buy_price_usd ?? price);
      const currentBalance = Number(pos.token_balance ?? amountToken);
      const buyTime = new Date(pos.buy_time);

      // Validação: garantir que temos valores válidos
      if (totalInvested <= 0) {
        console.warn(`[Executor] ⚠️ Posição sem invested_amount_usd válido: ${totalInvested}, usando amountUsd como fallback`);
      }
      if (currentBalance <= 0) {
        throw new Error(`Invalid position balance: ${currentBalance} for position ${pos.id}`);
      }

      // Calcular invested amount proporcional à quantidade vendida
      // Validação: evitar divisão por zero
      if (currentBalance <= 0) {
        throw new Error(`Invalid position balance: ${currentBalance} for position ${pos.id}`);
      }
      const ratio = Math.min(1, Math.max(0, amountToken / currentBalance));
      const investedForSold = totalInvested * ratio;

      // Validação: evitar divisão por zero no cálculo de percentual
      profitLossUsd = amountUsd - investedForSold;
      profitLossPercent = investedForSold > 0 && !isNaN(investedForSold) && isFinite(investedForSold)
        ? (profitLossUsd / investedForSold) * 100
        : 0;

      // Garantir que os valores são números válidos
      if (isNaN(profitLossUsd) || !isFinite(profitLossUsd)) {
        console.warn(`[Executor] Invalid profitLossUsd calculated: ${profitLossUsd}, setting to 0`);
        profitLossUsd = 0;
      }
      if (isNaN(profitLossPercent) || !isFinite(profitLossPercent)) {
        console.warn(`[Executor] Invalid profitLossPercent calculated: ${profitLossPercent}, setting to 0`);
        profitLossPercent = 0;
      }
      holdTimeHours = (Date.now() - buyTime.getTime()) / (1000 * 60 * 60);

      console.log(`[Executor] 📊 SELL calculation: amountUsd=$${amountUsd.toFixed(2)}, investedForSold=$${investedForSold.toFixed(2)}, profitLoss=$${profitLossUsd.toFixed(2)} (${profitLossPercent.toFixed(2)}%)`);
    } else {
      console.warn(`[Executor] ⚠️ No position found for order ${order.id}, profit/loss will be 0`);
    }

    await this.pool.query(
      `UPDATE orders SET
         status = 'completed',
         amount_usd = $1,
         price_usd = $2,
         transaction_hash = $3,
         profit_loss_usd = $4,
         profit_loss_percent = $5,
         hold_time_hours = $6,
         executed_at = CURRENT_TIMESTAMP
       WHERE id = $7`,
      [amountUsd, price, this.generateTxHash(), profitLossUsd, profitLossPercent, holdTimeHours, order.id]
    );

    // Calcular saldo disponível antes da venda
    const balanceBeforeResult = await this.pool.query(
      `SELECT 
         COALESCE(SUM(CASE WHEN entry_type IN ('deposit', 'trade_profit') THEN amount_usd ELSE 0 END), 0) AS credits,
         COALESCE(SUM(CASE WHEN entry_type IN ('trade_loss', 'fee', 'gas') THEN ABS(amount_usd) ELSE 0 END), 0) AS debits
       FROM ledger_entries
       WHERE user_id = $1`,
      [order.user_id]
    );
    const credits = Number(balanceBeforeResult.rows[0]?.credits ?? 0);
    const debits = Number(balanceBeforeResult.rows[0]?.debits ?? 0);

    // Buscar investido em posições abertas (excluindo a posição que estamos vendendo)
    const openPositionsResult = await this.pool.query(
      `SELECT COALESCE(SUM(invested_amount_usd), 0) AS total_invested
       FROM positions
       WHERE user_id = $1 AND token_id != $2 AND status = 'open'`,
      [order.user_id, order.token_id]
    );
    const investedInOtherPositions = Number(openPositionsResult.rows[0]?.total_invested ?? 0);

    // Saldo disponível antes = créditos - débitos - investido em outras posições
    const balanceBefore = Math.max(0, credits - debits - investedInOtherPositions);

    // IMPORTANTE: Ao vender, o saldo aumenta pelo valor total recebido
    // O lucro/perda já foi calculado e está em profitLossUsd
    // Para o saldo: adicionar o valor total recebido (amountUsd)
    // Para as métricas: usar profitLossUsd das orders (mais preciso)

    const balanceAfter = balanceBefore + amountUsd;

    // Registrar o valor total recebido como trade_profit (aumenta saldo)
    // Isso representa o dinheiro que volta ao saldo disponível
    await this.pool.query(
      `INSERT INTO ledger_entries (user_id, order_id, entry_type, amount_usd, description, balance_before, balance_after)
       VALUES ($1, $2, 'trade_profit', $3, $4, $5, $6)`,
      [
        order.user_id,
        order.id,
        amountUsd, // Valor total recebido da venda
        `Paper sell execution - Venda simulada: recebido $${amountUsd.toFixed(2)} | ${profitLossUsd > 0 ? `Lucro: $${profitLossUsd.toFixed(2)} (${profitLossPercent.toFixed(2)}%)` : profitLossUsd < 0 ? `Perda: $${Math.abs(profitLossUsd).toFixed(2)} (${Math.abs(profitLossPercent).toFixed(2)}%)` : 'Sem lucro/perda'}`,
        balanceBefore,
        balanceAfter
      ]
    );

    // NOTA: As métricas de lucro/perda são calculadas a partir da tabela orders
    // onde profit_loss_usd já está armazenado corretamente
    // O ledger registra o valor recebido para controle de saldo

    const isProfit = profitLossUsd >= 0;
    console.log(`[Executor] 💰 Simulated SELL: Sold $${amountUsd.toFixed(2)} worth of tokens | ${isProfit ? 'PROFIT' : 'LOSS'}: $${Math.abs(profitLossUsd).toFixed(2)} (${Math.abs(profitLossPercent).toFixed(2)}%) | Balance: $${balanceBefore.toFixed(2)} → $${balanceAfter.toFixed(2)}`);

    await this.createOrUpdatePosition(order, token, 'sell');
  }

  private async createOrder(params: {
    userId: string;
    tokenId: string;
    signalId?: string;
    orderType: 'BUY' | 'SELL';
    amountUsd?: number;
    amountToken?: number;
    investedAmountUsd?: number;
  }): Promise<Order> {
    const result = await this.pool.query(
      `INSERT INTO orders (
         user_id, token_id, signal_id, order_type, status, amount_usd, amount_token, invested_amount_usd
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        params.userId,
        params.tokenId,
        params.signalId ?? null,
        params.orderType,
        'pending',
        params.amountUsd ?? null,
        params.amountToken ?? null,
        params.investedAmountUsd ?? params.amountUsd ?? null,
      ]
    );
    return result.rows[0] as Order;
  }

  async executeBuy(request: ExecuteOrderRequest, userId: string): Promise<Order> {
    const tokenResult = await this.pool.query('SELECT * FROM tokens WHERE id = $1', [request.token_id]);
    if (tokenResult.rowCount === 0) throw new Error('Token not found');
    const token = tokenResult.rows[0] as Token;

    // Verificar estratégia antes de comprar
    if (request.signal_id) {
      const signalResult = await this.pool.query('SELECT * FROM signals WHERE id = $1', [request.signal_id]);
      const signal = signalResult.rows[0];

      const riskResult = await this.pool.query(
        'SELECT memecoin_score, risk_score, scam_probability FROM token_risk_assessments WHERE token_id = $1',
        [request.token_id]
      );
      const validation = riskResult.rows[0];

      if (validation) {
        const decision = await this.strategyManager.shouldBuy(userId, signal, {
          memecoinScore: Number(validation.memecoin_score ?? 0),
          riskScore: Number(validation.risk_score ?? 0),
          scamProbability: Number(validation.scam_probability ?? 0)
        });
        if (!decision.shouldBuy) {
          throw new Error(`Strategy blocked: ${decision.reason}`);
        }
        console.log(`[Strategy] ${decision.reason}`);
      }
    }

    // NOVO: Verificar se é real trading
    const isRealTrading = await this.realTradingService.isRealTradingEnabled(userId);

    // Verificação absoluta de modo Live
    if (this.executionMode === 'live') {
      if (isRealTrading) {
        console.log(`[Executor] 🔥🔥🔥 REAL TRADING MODE for user ${userId}`);
        return await this.executeRealBuy(request, userId, token);
      } else {
        console.error(`[Executor] 🛑🛑🛑 TRADE BLOCKED: Bot is in LIVE mode, but real trading is disabled for user ${userId}.`);
        throw new Error('Real trading not enabled for this user while in global LIVE mode');
      }
    }

    // Paper trading (simulação) - Só chega aqui se global mode FOR 'simulation'
    if (this.executionMode !== 'simulation') {
      console.error(`[Executor] 🚨 CRITICAL INCONSISTENCY: Execution mode is ${this.executionMode} but reached paper buy path. Blocking.`);
      throw new Error(`Inconsistent execution mode: ${this.executionMode}`);
    }

    console.log(`[Executor] 📝 PAPER TRADING MODE for user ${userId}`);
    return await this.executePaperBuy(request, userId, token);
  }

  /**
   * Executa BUY em modo paper trading (simulação)
   */
  private async executePaperBuy(request: ExecuteOrderRequest, userId: string, token: Token): Promise<Order> {
    // CALCULAR E VERIFICAR SALDO SEMPRE
    const investment = await this.calculateIntendedInvestment(userId, request.token_id, request.signal_id);
    const availableBalance = investment.available_balance || 0; // Vou expor isso no calculateIntendedInvestment

    let amountUsd: number;
    let investedAmount: number;

    if (request.amount_usd) {
      amountUsd = request.amount_usd;
      investedAmount = amountUsd;

      // Mesmo se amount_usd for solicitado, não pode exceder o saldo disponível
      if (amountUsd > availableBalance) {
        console.warn(`[Executor] 🛑 Paper buy adjusted: Requested $${amountUsd} but only $${availableBalance} available.`);
        amountUsd = availableBalance;
        investedAmount = availableBalance;
      }
    } else {
      amountUsd = investment.amountUsd;
      investedAmount = amountUsd;
    }

    if (amountUsd <= 0) {
      console.log(`[Executor] 🛑 Aborting paper buy: Insufficient calculated investment amount ($${amountUsd})`);
      throw new Error('Insufficient balance for simulation trading');
    }

    const order = await this.createOrder({
      userId,
      tokenId: request.token_id,
      signalId: request.signal_id,
      orderType: 'BUY',
      amountUsd,
      investedAmountUsd: investedAmount,
    });

    await this.simulateBuy(order, token);
    await this.createOrUpdatePosition(order, token, 'buy');
    return order;
  }

  /**
   * Executa BUY REAL usando blockchain
   */
  private async executeRealBuy(request: ExecuteOrderRequest, userId: string, token: Token): Promise<Order> {
    const investment = await this.calculateIntendedInvestment(userId, request.token_id, request.signal_id);
    const amountUsd = investment.amountUsd;

    if (amountUsd < 5) {
      throw new Error('Insufficient balance for real trading (minimum $5)');
    }

    // Executar trade real on-chain
    const result = await this.realTradingService.executeRealBuy(
      userId,
      token.contract_address,
      token.symbol,
      amountUsd
    );

    if (!result.success) {
      throw new Error(`Real trade failed: ${result.error}`);
    }

    // Criar ordem com tx_hash real
    const order = await this.createOrder({
      userId,
      tokenId: request.token_id,
      signalId: request.signal_id,
      orderType: 'BUY',
      amountUsd,
      investedAmountUsd: amountUsd,
    });

    // Atualizar ordem com dados da blockchain
    await this.pool.query(
      `UPDATE orders SET
         status = 'completed',
         transaction_hash = $1,
         executed_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [result.txHash, order.id]
    );

    await this.createOrUpdatePosition(order, token, 'buy');

    console.log(`[Executor] ✅ REAL BUY completed! TX: ${result.txHash}`);
    return order;
  }

  async executeSell(request: ExecuteOrderRequest, userId: string): Promise<Order> {
    const tokenResult = await this.pool.query('SELECT * FROM tokens WHERE id = $1', [request.token_id]);
    if (tokenResult.rowCount === 0) throw new Error('Token not found');
    const token = tokenResult.rows[0] as Token;

    // Buscar posição aberta
    const positionResult = await this.pool.query(
      `SELECT token_balance FROM positions 
       WHERE user_id = $1 AND token_id = $2 AND status = 'open'`,
      [userId, request.token_id]
    );

    if (positionResult.rows.length === 0 || Number(positionResult.rows[0]?.token_balance ?? 0) <= 0) {
      throw new Error('No position to sell');
    }

    const balance = Number(positionResult.rows[0].token_balance);
    const amountToken = request.amount_token ?? balance;

    if (amountToken > balance) {
      throw new Error('Insufficient token balance');
    }

    // Calcular amountUsd antes de criar a ordem (necessário para constraint NOT NULL)
    const price = Number(token.price_usd ?? 0.0001);
    const amountUsd = amountToken * price;

    // Validação: garantir que amountUsd seja razoável
    if (amountUsd <= 0 || isNaN(amountUsd) || !isFinite(amountUsd)) {
      throw new Error(`Invalid amountUsd calculated: ${amountUsd} (amountToken: ${amountToken}, price: ${price})`);
    }

    // Log para debug
    console.log(`[Executor] 💰 Creating SELL order: ${amountToken} tokens @ $${price.toFixed(8)} = $${amountUsd.toFixed(2)}`);

    // Verificação absoluta de modo Live para Venda
    if (this.executionMode === 'live') {
      const isRealTrading = await this.realTradingService.isRealTradingEnabled(userId);
      if (isRealTrading) {
        console.log(`[Executor] 🔥 REAL SELL MODE for user ${userId}`);
        // Chamar venda real via blockchain
        const result = await this.realTradingService.executeRealSell(
          userId,
          token.contract_address,
          token.symbol,
          amountToken.toString()
        );
        if (!result.success) throw new Error(`Real sell failed: ${result.error}`);

        const order = await this.createOrder({
          userId,
          tokenId: request.token_id,
          signalId: request.signal_id,
          orderType: 'SELL',
          amountUsd,
          amountToken,
        });

        await this.pool.query(
          `UPDATE orders SET status = 'completed', transaction_hash = $1 WHERE id = $2`,
          [result.txHash, order.id]
        );
        await this.createOrUpdatePosition(order, token, 'sell');
        return order;
      } else {
        throw new Error('Real trading not enabled for this user while in global LIVE mode');
      }
    }

    const order = await this.createOrder({
      userId,
      tokenId: request.token_id,
      signalId: request.signal_id,
      orderType: 'SELL',
      amountUsd,
      amountToken,
    });

    await this.simulateSell(order, token);
    return order;
  }

  async getPositions(userId: string): Promise<any[]> {
    const result = await this.pool.query(`SELECT * FROM open_positions WHERE user_id = $1`, [userId]);
    return result.rows;
  }

  /**
   * Verifica se deve vender posição baseado em estratégias rápidas para meme coins
   * Prioriza: tempo de hold > proteção de capital > realização rápida de lucros
   */
  async shouldSellPosition(
    userId: string,
    tokenId: string,
    signal: Signal,
    currentPrice: number,
    buyPrice: number,
    holdTimeMinutes: number,
    potentialMultiplier: number
  ): Promise<{ shouldSell: boolean; reason: string }> {

    // PRIORIDADE 0: ANÁLISE TÉCNICA (se disponível)
    try {
      const collector = new PriceCollector(this.pool);
      const candles = await collector.getRecentCandles(tokenId, '1m', 50);

      if (candles.length >= 20) {
        const prices = candles.map(c => Number(c.close_price));
        const volumes = candles.map(c => Number(c.volume_usd));

        // RSI Analysis
        const rsi = calculateRSI(prices, 14);
        if (rsi.signal === 'OVERBOUGHT' && rsi.confidence > 70) {
          console.log(`[TA] 🔴 RSI OVERBOUGHT: ${rsi.rsi} (${rsi.confidence}%)`);
          return {
            shouldSell: true,
            reason: `📊 RSI sobrecomprado (${rsi.rsi}) - venda técnica recomendada`
          };
        }

        // Peak Detection
        const peak = detectPeak(prices, volumes);
        if (peak.shouldSell && peak.confidence > 60) {
          console.log(`[TA] 🔴 PEAK DETECTED: ${peak.reason}`);
          return { shouldSell: true, reason: `🎯 ${peak.reason}` };
        }

        console.log(`[TA] RSI: ${rsi.rsi}, Peak: ${peak.isPeak ? 'YES' : 'NO'}, Momentum: ${peak.momentum}`);
      }
    } catch (error) {
      console.error('[TA] Technical analysis failed:', error);
      // Continuar com lógica tradicional
    }

    // PRIORIDADE 1: SINAL SELL
    if (signal.signal_type === 'SELL') {
      return { shouldSell: true, reason: 'Sinal SELL emitido' };
    }

    // ============================================================================
    // PRIORIDADE MÁXIMA: TEMPO MÁXIMO DE HOLD (10 minutos) - VERIFICAR PRIMEIRO
    // ============================================================================
    // CRÍTICO: Verificar tempo ANTES de qualquer validação de preço
    // Se passou 10 minutos, vender SEMPRE, independente de preço válido ou não
    // CORRIGIDO: Usar holdTimeMinutes passado diretamente da query SQL (já calculado corretamente)
    console.log(`[Executor] ⏱️ Checking hold time for position: ${holdTimeMinutes.toFixed(2)} minutes (threshold: 10 minutes)`);
    if (holdTimeMinutes >= 10) {
      console.error(`[Executor] 🚨🚨🚨 VENDA FORÇADA ABSOLUTA (PRIORIDADE MÁXIMA): ${holdTimeMinutes.toFixed(2)} minutos >= 10 minutos - FORÇANDO VENDA SEM EXCEÇÕES 🚨🚨🚨`);
      console.error(`[Executor] Position details:`, {
        user_id: userId,
        token_id: tokenId,
        hold_time_minutes: holdTimeMinutes.toFixed(2),
        current_time: new Date().toISOString()
      });
      return { shouldSell: true, reason: `🚨 VENDA FORÇADA ABSOLUTA: ${holdTimeMinutes.toFixed(0)} minutos - limite de segurança` };
    }

    // Buscar perfil de risco do usuário
    const profileResult = await this.pool.query('SELECT risk_profile, max_loss_percent, max_gain_percent FROM user_profiles WHERE user_id = $1', [
      userId,
    ]);
    const profile = profileResult.rows[0];
    const maxLossPercent = Number(profile?.max_loss_percent ?? 10);
    const maxGainPercent = Number(profile?.max_gain_percent ?? 25);

    // Calcular ganho/perda e tempo de hold
    // Validações: evitar divisão por zero e garantir valores válidos
    if (buyPrice <= 0 || isNaN(buyPrice) || !isFinite(buyPrice)) {
      console.error(`[Executor] Invalid buyPrice: ${buyPrice}, using currentPrice as fallback`);
      // Se passou 5 minutos sem preço válido, vender por segurança
      if (holdTimeMinutes >= 5) {
        return { shouldSell: true, reason: `⚠️ Venda forçada: preço inválido após ${holdTimeMinutes.toFixed(0)} minutos` };
      }
      return { shouldSell: false, reason: `Preço de compra inválido: ${buyPrice}` };
    }
    if (currentPrice <= 0 || isNaN(currentPrice) || !isFinite(currentPrice)) {
      console.error(`[Executor] Invalid currentPrice: ${currentPrice}`);
      // Se passou 5 minutos sem preço válido, vender por segurança
      if (holdTimeMinutes >= 5) {
        return { shouldSell: true, reason: `⚠️ Venda forçada: preço atual inválido após ${holdTimeMinutes.toFixed(0)} minutos` };
      }
      return { shouldSell: false, reason: `Preço atual inválido: ${currentPrice}` };
    }

    const gainPercent = ((currentPrice / buyPrice - 1) * 100);
    const lossPercent = ((buyPrice - currentPrice) / buyPrice) * 100;
    const holdTimeHours = holdTimeMinutes / 60;

    // Validação: garantir que os percentuais são números válidos
    if (isNaN(gainPercent) || !isFinite(gainPercent)) {
      console.error(`[Executor] Invalid gainPercent calculated: ${gainPercent}`);
      // Se passou 5 minutos com cálculo inválido, vender por segurança
      if (holdTimeMinutes >= 5) {
        return { shouldSell: true, reason: `⚠️ Venda forçada: erro no cálculo após ${holdTimeMinutes.toFixed(0)} minutos` };
      }
      return { shouldSell: false, reason: `Erro no cálculo de ganho: ${gainPercent}` };
    }
    if (isNaN(lossPercent) || !isFinite(lossPercent)) {
      console.error(`[Executor] Invalid lossPercent calculated: ${lossPercent}`);
      // Se passou 5 minutos com cálculo inválido, vender por segurança
      if (holdTimeMinutes >= 5) {
        return { shouldSell: true, reason: `⚠️ Venda forçada: erro no cálculo após ${holdTimeMinutes.toFixed(0)} minutos` };
      }
      return { shouldSell: false, reason: `Erro no cálculo de perda: ${lossPercent}` };
    }

    // ============================================================================
    // PRIORIDADE 1: STOP-LOSS ABSOLUTO (configuração do usuário)
    // ============================================================================
    // CORRIGIDO: Stop-loss absoluto deve ter PRIORIDADE MÁXIMA
    // Se a perda atingir ou exceder o limite configurado, vender SEMPRE, independente de tempo
    if (lossPercent >= maxLossPercent) {
      console.error(`[Executor] 🚨🚨🚨 STOP-LOSS ABSOLUTO (PRIORIDADE 1): ${lossPercent.toFixed(2)}% >= ${maxLossPercent}% - VENDENDO IMEDIATAMENTE 🚨🚨🚨`);
      return { shouldSell: true, reason: `🛑 Stop-loss absoluto: ${lossPercent.toFixed(2)}% (limite: ${maxLossPercent}%)` };
    }

    // VENDA FORÇADA após 7 minutos se não houver lucro significativo (>1%) OU se houver perda > 0.5%
    // Ajustado: Aumentado tempo de 5 para 7 minutos e threshold de lucro de 0.5% para 1%
    // Isso dá mais tempo para posições lucrarem antes de forçar venda
    if (holdTimeMinutes >= 7 && (gainPercent < 1.0 || lossPercent > 0.5)) {
      console.log(`[Executor] ⏰ VENDA FORÇADA POR TEMPO: ${holdTimeMinutes.toFixed(0)} minutos sem lucro significativo (>1%) ou com perda >0.5% (${gainPercent >= 0 ? '+' : ''}${gainPercent.toFixed(2)}%, loss: ${lossPercent.toFixed(2)}%)`);
      return { shouldSell: true, reason: `⏰ VENDA FORÇADA: ${holdTimeMinutes.toFixed(0)} minutos sem lucro significativo (>1%) ou com perda >0.5% (${gainPercent >= 0 ? '+' : ''}${gainPercent.toFixed(2)}%)` };
    }

    // VENDA FORÇADA após 5 minutos APENAS se houver perda significativa (>1%)
    // Isso protege contra perdas maiores enquanto dá mais tempo para posições neutras lucrarem
    if (holdTimeMinutes >= 5 && lossPercent > 1.0) {
      console.log(`[Executor] ⏰ VENDA FORÇADA POR PERDA: ${holdTimeMinutes.toFixed(0)} minutos com perda significativa (${lossPercent.toFixed(2)}%)`);
      return { shouldSell: true, reason: `⏰ VENDA FORÇADA: ${holdTimeMinutes.toFixed(0)} minutos com perda significativa (${lossPercent.toFixed(2)}%)` };
    }

    // ============================================================================
    // PRIORIDADE 3: STOP-LOSS AGRESSIVO (proteger capital rapidamente)
    // ============================================================================

    // STOP-LOSS CRÍTICO: 2% de perda após 3 minutos → VENDE IMEDIATAMENTE
    if (holdTimeMinutes >= 3 && lossPercent >= 2.0) {
      console.error(`[Executor] 🚨 STOP-LOSS CRÍTICO: ${lossPercent.toFixed(2)}% após ${holdTimeMinutes.toFixed(0)} minutos`);
      return { shouldSell: true, reason: `🛑 STOP-LOSS: ${lossPercent.toFixed(2)}% após ${holdTimeMinutes.toFixed(0)} minutos` };
    }

    // STOP-LOSS PREVENTIVO: 1% de perda após 5 minutos → VENDE
    if (holdTimeMinutes >= 5 && lossPercent >= 1.0) {
      console.warn(`[Executor] ⚠️ STOP-LOSS PREVENTIVO: ${lossPercent.toFixed(2)}% após ${holdTimeMinutes.toFixed(0)} minutos`);
      return { shouldSell: true, reason: `⚠️ Stop-loss preventivo: ${lossPercent.toFixed(2)}% após ${holdTimeMinutes.toFixed(0)} minutos` };
    }

    // STOP-LOSS ULTRA-PREVENTIVO: 0.5% de perda após 10 minutos → VENDE
    if (holdTimeMinutes >= 10 && lossPercent >= 0.5) {
      console.warn(`[Executor] ⚠️ STOP-LOSS ULTRA-PREVENTIVO: ${lossPercent.toFixed(2)}% após ${holdTimeMinutes.toFixed(0)} minutos`);
      return { shouldSell: true, reason: `⚠️ Stop-loss: ${lossPercent.toFixed(2)}% após ${holdTimeMinutes.toFixed(0)} minutos` };
    }

    // ============================================================================
    // PRIORIDADE 4: VENDA RÁPIDA DE LUCROS (realização rápida)
    // ============================================================================

    // VENDA ULTRA-RÁPIDA (2-5 min): Qualquer lucro > 0.5% → vende imediatamente
    if (holdTimeMinutes >= 2 && holdTimeMinutes < 5 && gainPercent > 0.5) {
      console.log(`[Executor] 🎯 VENDA ULTRA-RÁPIDA: ${gainPercent.toFixed(2)}% após ${holdTimeMinutes.toFixed(0)} minutos`);
      return { shouldSell: true, reason: `🎯 Venda ultra-rápida: ${gainPercent.toFixed(2)}% após ${holdTimeMinutes.toFixed(0)} minutos` };
    }

    // VENDA RÁPIDA (5-10 min): Lucro > 0.3% → vende
    if (holdTimeMinutes >= 5 && holdTimeMinutes < 10 && gainPercent > 0.3) {
      console.log(`[Executor] ⚡ VENDA RÁPIDA: ${gainPercent.toFixed(2)}% após ${holdTimeMinutes.toFixed(0)} minutos`);
      return { shouldSell: true, reason: `⚡ Venda rápida: ${gainPercent.toFixed(2)}% após ${holdTimeMinutes.toFixed(0)} minutos` };
    }

    // VENDA MODERADA (10-30 min): Se lucro > 0.2% e não está subindo muito → vende
    if (holdTimeMinutes >= 10 && holdTimeMinutes < 30 && gainPercent > 0.2) {
      // Se lucro > 1% e ainda subindo, pode segurar mais um pouco
      if (gainPercent <= 1.0) {
        console.log(`[Executor] 💰 VENDA MODERADA: ${gainPercent.toFixed(2)}% após ${holdTimeMinutes.toFixed(0)} minutos`);
        return { shouldSell: true, reason: `💰 Venda moderada: ${gainPercent.toFixed(2)}% após ${holdTimeMinutes.toFixed(0)} minutos` };
      }
    }

    // ============================================================================
    // PRIORIDADE 5: TAKE-PROFIT E GANHO MÁXIMO
    // ============================================================================

    // TAKE-PROFIT: 30% do alvo → vende rápido
    const targetPrice = buyPrice * potentialMultiplier;
    if (currentPrice >= targetPrice * 0.3) {
      console.log(`[Executor] 🎉 TAKE-PROFIT: ${gainPercent.toFixed(2)}% (30% do alvo)`);
      return { shouldSell: true, reason: `🎉 Take-profit: ${gainPercent.toFixed(2)}% (30% do alvo)` };
    }

    // Ganho máximo atingido
    if (gainPercent >= maxGainPercent) {
      console.log(`[Executor] 🎊 GANHO MÁXIMO: ${gainPercent.toFixed(2)}%`);
      return { shouldSell: true, reason: `🎊 Ganho máximo: ${gainPercent.toFixed(2)}%` };
    }

    // ============================================================================
    // PRIORIDADE 6: HOLD PERSISTENTE SEM MOVIMENTO
    // ============================================================================

    // Se sinal HOLD e sem movimento significativo após 5 minutos → vende
    if (signal.signal_type === 'HOLD' && holdTimeMinutes >= 5) {
      const priceChange = Math.abs((currentPrice - buyPrice) / buyPrice) * 100;
      if (priceChange < 1.0) { // Sem movimento significativo (<1%)
        console.log(`[Executor] 📊 HOLD sem movimento: ${priceChange.toFixed(2)}% após ${holdTimeMinutes.toFixed(0)} minutos`);
        return { shouldSell: true, reason: `📊 HOLD sem movimento (${priceChange.toFixed(2)}%) após ${holdTimeMinutes.toFixed(0)} minutos` };
      }
    }

    // Não vender ainda - aguardando condições favoráveis
    return { shouldSell: false, reason: `Aguardando (${gainPercent >= 0 ? '+' : ''}${gainPercent.toFixed(2)}%, ${holdTimeMinutes.toFixed(0)}min)` };
  }

  /**
   * Monitora posições abertas e executa vendas automáticas quando necessário
   */
  async monitorPositions(): Promise<void> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    // Logs críticos no início - sempre usar console.error para garantir visibilidade
    console.error(`[Executor] 🔍🔍🔍 ========== STARTING POSITION MONITORING (${timestamp}) ==========`);
    console.error(`[Executor] 🔍 Monitoring started at ${timestamp}`);

    try {

      // Criar notificação de verificação de monitoramento (apenas para usuários com posições)
      const allPositionsResult = await this.pool.query(
        `SELECT DISTINCT user_id FROM positions WHERE status = 'open'`
      );

      console.error(`[Executor] 📊 Found ${allPositionsResult.rows.length} user(s) with open positions`);

      // Log crítico se não encontrar posições mas deveria ter
      if (allPositionsResult.rows.length === 0) {
        const totalPositionsCheck = await this.pool.query(
          `SELECT COUNT(*) as count FROM positions WHERE status = 'open'`
        );
        const totalCount = Number(totalPositionsCheck.rows[0]?.count ?? 0);
        if (totalCount > 0) {
          console.error(`[Executor] ⚠️⚠️⚠️ WARNING: Found ${totalCount} open positions but query returned 0 users! ⚠️⚠️⚠️`);
        } else {
          console.error(`[Executor] ℹ️ No open positions found`);
        }
      }

      // NOVO: Primeiro, processar todos os sinais SELL ativos para posições abertas
      // Isso garante que sinais SELL sejam processados imediatamente
      // IMPORTANTE: Buscar TODOS os sinais SELL recentes e depois verificar se há posições correspondentes
      const sellSignalsResult = await this.pool.query(
        `SELECT 
           s.*, 
           p.user_id,
           p.id as position_id,
           p.token_balance,
           t.symbol,
           t.name
         FROM signals s
         JOIN tokens t ON s.token_id = t.id
         JOIN positions p ON s.token_id = p.token_id AND p.status = 'open'
         WHERE s.signal_type = 'SELL'
         AND s.is_active = true
         AND s.created_at > NOW() - INTERVAL '24 hours'
         ORDER BY s.created_at DESC`
      );

      console.log(`[Executor] 🔍 Found ${sellSignalsResult.rows.length} active SELL signals for open positions`);

      // Log detalhado para debug
      if (sellSignalsResult.rows.length > 0) {
        console.log(`[Executor] 📊 SELL signals details:`, sellSignalsResult.rows.map((r: any) => ({
          signal_id: r.id,
          token_id: r.token_id,
          symbol: r.symbol,
          user_id: r.user_id,
          position_id: r.position_id,
          token_balance: r.token_balance,
          created_at: r.created_at
        })));
      } else {
        // Verificar se há sinais SELL no banco (mesmo sem posições)
        const allSellSignalsCheck = await this.pool.query(
          `SELECT COUNT(*) as count FROM signals 
           WHERE signal_type = 'SELL' 
           AND is_active = true 
           AND created_at > NOW() - INTERVAL '24 hours'`
        );
        const allSellSignalsCount = Number(allSellSignalsCheck.rows[0]?.count ?? 0);
        console.log(`[Executor] ⚠️ No SELL signals matched with open positions, but found ${allSellSignalsCount} total SELL signals in DB`);

        // Verificar se há posições abertas
        const openPositionsCheck = await this.pool.query(
          `SELECT COUNT(*) as count FROM positions WHERE status = 'open'`
        );
        const openPositionsCount = Number(openPositionsCheck.rows[0]?.count ?? 0);
        console.log(`[Executor] 📊 Total open positions: ${openPositionsCount}`);

        // Verificar mismatch de token_id entre sinais SELL e posições
        if (allSellSignalsCount > 0 && openPositionsCount > 0) {
          const mismatchCheck = await this.pool.query(
            `SELECT DISTINCT s.token_id, s.id as signal_id, t.symbol
             FROM signals s
             JOIN tokens t ON s.token_id = t.id
             WHERE s.signal_type = 'SELL'
             AND s.is_active = true
             AND s.created_at > NOW() - INTERVAL '24 hours'
             AND NOT EXISTS (
               SELECT 1 FROM positions p 
               WHERE p.token_id = s.token_id 
               AND p.status = 'open'
             )
             LIMIT 5`
          );
          if (mismatchCheck.rows.length > 0) {
            console.log(`[Executor] ⚠️ Found ${mismatchCheck.rows.length} SELL signals without matching open positions:`,
              mismatchCheck.rows.map((r: any) => ({ signal_id: r.signal_id, token_id: r.token_id, symbol: r.symbol }))
            );
          }
        }
      }

      // Processar cada sinal SELL
      for (const sellSignal of sellSignalsResult.rows) {
        const userId = sellSignal.user_id;
        const tokenId = sellSignal.token_id;
        const tokenBalance = Number(sellSignal.token_balance ?? 0);

        console.log(`[Executor] 🔍 Processing SELL signal for ${sellSignal.symbol}:`, {
          signal_id: sellSignal.id,
          user_id: userId,
          token_id: tokenId,
          token_balance: tokenBalance,
          position_id: sellSignal.position_id
        });

        // Verificar se o bot está habilitado
        const botEnabled = await this.isBotEnabled(userId);
        if (!botEnabled) {
          console.log(`[Executor] ⚠️ Bot disabled for user ${userId}, skipping SELL signal`);
          continue;
        }

        if (tokenBalance <= 0) {
          console.log(`[Executor] ⚠️ Zero token balance for position ${sellSignal.position_id}, skipping SELL signal`);
          continue;
        }

        try {
          console.log(`[Executor] 🔴 Processing SELL signal for ${sellSignal.symbol} (user: ${userId}, balance: ${tokenBalance})`);
          const order = await this.executeSell({ token_id: tokenId, signal_id: sellSignal.id, amount_token: tokenBalance, order_type: 'SELL' }, userId);

          // Buscar profit/loss da ordem
          const orderResult = await this.pool.query(
            'SELECT profit_loss_usd, profit_loss_percent FROM orders WHERE id = $1',
            [order.id]
          );
          const orderData = orderResult.rows[0];
          const profitLoss = Number(orderData?.profit_loss_usd ?? 0);
          const profitLossPercent = Number(orderData?.profit_loss_percent ?? 0);
          const isProfit = profitLoss >= 0;

          console.log(`[Executor] ✅ SELL executed: ${isProfit ? 'PROFIT' : 'LOSS'} of $${Math.abs(profitLoss).toFixed(2)} (${Math.abs(profitLossPercent).toFixed(2)}%)`);

          await this.createNotification(
            userId,
            isProfit ? 'profit_realized' : 'loss_realized',
            isProfit ? 'success' : 'warning',
            isProfit ? 'Lucro realizado!' : 'Perda realizada',
            `🤖 ${isProfit ? '🎉' : '⚠️'} Sinal SELL processado! Fechei a posição em ${sellSignal.symbol}. ${isProfit ? 'Ganho' : 'Perda'} de $${Math.abs(profitLoss).toFixed(2)} (${Math.abs(profitLossPercent).toFixed(2)}%).`,
            { order_id: order.id, symbol: sellSignal.symbol, profit_loss: profitLoss, profit_loss_percent: profitLossPercent, signal_id: sellSignal.id }
          );
        } catch (error: any) {
          console.error(`[Executor] ❌ Error processing SELL signal for ${sellSignal.symbol}:`, error.message);
          // Continuar para próxima posição
        }
      }

      // Buscar todas posições abertas com preço ATUALIZADO do token
      // IMPORTANTE: Usar o preço mais recente do token para decisões de venda
      // Se o preço não estiver atualizado, usar o preço da posição atualizado (current_price_usd)
      const positionsResult = await this.pool.query(
        `SELECT 
           p.*, 
           COALESCE(t.price_usd, p.current_price_usd, p.buy_price_usd) as current_price,
           t.price_usd as token_price_usd,
           p.current_price_usd as position_current_price,
           s.id as signal_id, 
           s.signal_type, 
           s.potential_multiplier,
           t.symbol,
           t.name,
           EXTRACT(EPOCH FROM (NOW() - p.buy_time)) / 60 as hold_time_minutes
         FROM positions p
         JOIN tokens t ON p.token_id = t.id
         LEFT JOIN signals s ON p.token_id = s.token_id AND s.is_active = true AND s.signal_type != 'SELL'
         WHERE p.status = 'open'
         ORDER BY p.buy_time ASC`
      );

      console.error(`[Executor] 🔍🔍🔍 Found ${positionsResult.rows.length} open positions to monitor 🔍🔍🔍`);

      // Log detalhado de cada posição encontrada
      if (positionsResult.rows.length > 0) {
        console.error(`[Executor] 📊📊📊 Positions details:`, positionsResult.rows.map((p: any) => ({
          position_id: p.id,
          user_id: p.user_id,
          symbol: p.symbol,
          buy_time: p.buy_time,
          hold_time_minutes: Number(p.hold_time_minutes ?? 0).toFixed(1),
          buy_price: p.buy_price_usd,
          current_price: p.current_price,
          token_balance: p.token_balance,
          invested: p.invested_amount_usd
        })));

        // Verificar quantas posições estão há mais de 10 minutos
        const oldPositions = positionsResult.rows.filter((p: any) => Number(p.hold_time_minutes ?? 0) >= 10);
        if (oldPositions.length > 0) {
          console.error(`[Executor] 🚨🚨🚨 CRITICAL: ${oldPositions.length} position(s) open for more than 10 minutes! 🚨🚨🚨`);
          oldPositions.forEach((p: any) => {
            console.error(`[Executor] 🚨 OLD POSITION: ${p.symbol} - ${Number(p.hold_time_minutes ?? 0).toFixed(1)} minutes - MUST SELL!`);
          });
        }
      } else {
        console.error(`[Executor] ⚠️ No open positions found to monitor`);
      }

      // Notificação de verificação para cada usuário com posições
      // Criar apenas uma notificação consolidada por usuário para não spam
      const userPositionsMap = new Map<string, number>();
      positionsResult.rows.forEach((p: any) => {
        const count = userPositionsMap.get(p.user_id) || 0;
        userPositionsMap.set(p.user_id, count + 1);
      });

      // IMPORTANTE: Não criar notificação para cada verificação de monitoramento
      // Isso cria MUITAS notificações e lota o banco
      // Apenas criar notificação se houver mudanças importantes (vendidas, novos sinais)
      // Removido: criação automática de notificação de verificação

      // Se não houver posições, criar notificação informativa apenas uma vez
      if (userPositionsMap.size === 0) {
        const defaultUserId = await this.ensureDefaultUser();
        const recentNotification = await this.pool.query(
          `SELECT id FROM bot_notifications 
             WHERE user_id = $1 
             AND notification_type = 'monitoring_check'
             AND title = 'Monitoramento ativo'
             AND created_at > NOW() - INTERVAL '30 minutes'
             LIMIT 1`,
          [defaultUserId]
        );

        if (recentNotification.rows.length === 0) {
          await this.createNotification(
            defaultUserId,
            'monitoring_check',
            'info',
            'Monitoramento ativo',
            `🤖 Bot está ativo e monitorando! Nenhuma posição aberta no momento. Aguardando sinais BUY para abrir novas posições...`,
            { status: 'active', positions: 0 }
          );
        }
      }

      for (const pos of positionsResult.rows) {
        const userId = pos.user_id;
        const tokenId = pos.token_id;

        // Verificar se o bot está habilitado para este usuário
        const botEnabled = await this.isBotEnabled(userId);
        if (!botEnabled) {
          console.error(`[Executor] ⚠️ Bot disabled for user ${userId}, skipping position ${pos.symbol} (${pos.id})`);
          continue; // Pular se bot desabilitado
        }
        const buyPrice = Number(pos.buy_price_usd);
        // CORRIGIDO: Usar hold_time_minutes já calculado pela query SQL ao invés de recalcular
        const holdTimeMinutes = Number(pos.hold_time_minutes ?? 0);
        // Priorizar: token.price_usd > position.current_price_usd > buy_price_usd
        const tokenPriceUsd = Number(pos.token_price_usd ?? null);
        const positionCurrentPrice = Number(pos.position_current_price ?? null);
        const currentPrice = tokenPriceUsd || positionCurrentPrice || buyPrice;
        const potentialMultiplier = Number(pos.potential_multiplier ?? 1.0);
        const tokenBalance = Number(pos.token_balance ?? 0);

        // VALIDAÇÃO CRÍTICA: Se hold_time_minutes >= 10, forçar venda ANTES de qualquer outra verificação
        if (holdTimeMinutes >= 10) {
          console.error(`[Executor] 🚨🚨🚨 FORÇANDO VENDA IMEDIATA: Posição ${pos.symbol} há ${holdTimeMinutes.toFixed(2)} minutos (>= 10 minutos) 🚨🚨🚨`);
          console.error(`[Executor] Position details:`, {
            position_id: pos.id,
            user_id: userId,
            symbol: pos.symbol,
            hold_time_minutes: holdTimeMinutes.toFixed(2),
            token_balance: tokenBalance
          });

          // Executar venda imediatamente sem chamar shouldSellPosition
          if (tokenBalance > 0) {
            try {
              console.error(`[Executor] 🚀🚀🚀 Executing FORCED SELL order for ${pos.symbol}: ${tokenBalance} tokens 🚀🚀🚀`);
              const order = await this.executeSell({ token_id: tokenId, amount_token: tokenBalance, order_type: 'SELL' }, userId);
              console.error(`[Executor] ✅✅✅ VENDA FORÇADA EXECUTADA COM SUCESSO: Order ${order.id} para ${pos.symbol} ✅✅✅`);

              await this.createNotification(
                userId,
                'position_closed',
                'warning',
                'Posição fechada automaticamente',
                `🤖 Fechei a posição em ${pos.symbol} automaticamente após ${holdTimeMinutes.toFixed(0)} minutos (limite de segurança)`,
                { order_id: order.id, symbol: pos.symbol, reason: `Venda forçada após ${holdTimeMinutes.toFixed(0)} minutos` }
              );
              continue; // Pular para próxima posição
            } catch (error: any) {
              console.error(`[Executor] ❌❌❌ FAILED TO FORCE-SELL POSITION ${pos.id} (${pos.symbol}):`, {
                error_message: error.message,
                error_stack: error.stack,
                position_id: pos.id,
                user_id: userId,
                token_id: tokenId,
                symbol: pos.symbol,
                token_balance: tokenBalance,
                hold_time_minutes: holdTimeMinutes.toFixed(2)
              });
              await this.createNotification(
                userId,
                'error_occurred',
                'error',
                'Erro ao vender posição',
                `🤖 ⚠️ Erro ao vender ${pos.symbol} automaticamente após ${holdTimeMinutes.toFixed(0)} minutos: ${error.message}`,
                { symbol: pos.symbol, error: error.message, position_id: pos.id }
              );
              continue; // Pular para próxima posição mesmo com erro
            }
          } else {
            console.error(`[Executor] 🚨 CRITICAL: Should force sell ${pos.symbol} but tokenBalance is ${tokenBalance}!`);
            continue; // Pular para próxima posição
          }
        }

        // Log detalhado do preço usado
        if (tokenPriceUsd && tokenPriceUsd !== buyPrice) {
          console.log(`[Executor] 💰 Using token price for ${pos.symbol}: $${tokenPriceUsd.toFixed(8)} (buy: $${buyPrice.toFixed(8)})`);
        } else if (positionCurrentPrice && positionCurrentPrice !== buyPrice) {
          console.log(`[Executor] 💰 Using position current price for ${pos.symbol}: $${positionCurrentPrice.toFixed(8)} (buy: $${buyPrice.toFixed(8)})`);
        } else {
          console.log(`[Executor] ⚠️ Using buy price as current for ${pos.symbol}: $${buyPrice.toFixed(8)} (price may not be updated)`);
        }

        // Buscar sinal atual - priorizar SELL se existir, senão buscar o mais recente
        let signal: Signal;

        // Primeiro, tentar buscar sinal SELL ativo para este token
        const sellSignalResult = await this.pool.query(
          `SELECT * FROM signals 
           WHERE token_id = $1 
           AND signal_type = 'SELL' 
           AND is_active = true 
           AND created_at > NOW() - INTERVAL '24 hours'
           ORDER BY created_at DESC 
           LIMIT 1`,
          [tokenId]
        );

        if (sellSignalResult.rows.length > 0) {
          // Usar sinal SELL se encontrado
          signal = sellSignalResult.rows[0] as Signal;
          console.log(`[Executor] 🔴 Found active SELL signal for ${pos.symbol}, will force sell`);
        } else if (pos.signal_id) {
          // Usar sinal da posição
          const signalResult = await this.pool.query('SELECT * FROM signals WHERE id = $1', [pos.signal_id]);
          if (signalResult.rows.length > 0) {
            signal = signalResult.rows[0] as Signal;
          } else {
            // Criar sinal HOLD temporário
            signal = {
              id: '',
              token_id: tokenId,
              signal_type: 'HOLD',
              confidence_score: 50,
              potential_multiplier: 1.0,
            } as Signal;
          }
        } else {
          // Criar sinal HOLD temporário
          signal = {
            id: '',
            token_id: tokenId,
            signal_type: 'HOLD',
            confidence_score: 50,
            potential_multiplier: 1.0,
          } as Signal;
        }

        // Verificar se deve vender usando hold_time_minutes da query SQL
        const decision = await this.shouldSellPosition(
          userId,
          tokenId,
          signal,
          currentPrice,
          buyPrice,
          holdTimeMinutes, // CORRIGIDO: Passar hold_time_minutes da query SQL
          potentialMultiplier
        );

        // Log detalhado da decisão de venda
        const gainPercent = ((currentPrice / buyPrice - 1) * 100);
        const lossPercent = ((buyPrice - currentPrice) / buyPrice) * 100;
        const holdTimeHours = holdTimeMinutes / 60;

        console.log(`[Executor] 🔍 Position monitoring for ${pos.symbol}:`, {
          user_id: userId,
          position_id: pos.id,
          buy_price: buyPrice.toFixed(8),
          current_price: currentPrice.toFixed(8),
          gain_percent: gainPercent.toFixed(2),
          loss_percent: lossPercent.toFixed(2),
          hold_time_minutes: holdTimeMinutes.toFixed(0),
          hold_time_hours: holdTimeHours.toFixed(2),
          signal_type: signal.signal_type,
          token_balance: tokenBalance,
          should_sell: decision.shouldSell,
          reason: decision.reason || 'Não atende critérios de venda'
        });

        // Log crítico se deveria vender mas não vai
        if (decision.shouldSell && tokenBalance <= 0) {
          console.error(`[Executor] 🚨🚨🚨 CRITICAL: Should sell ${pos.symbol} but tokenBalance is ${tokenBalance}! 🚨🚨🚨`);
          console.error(`[Executor] Position details:`, {
            position_id: pos.id,
            user_id: userId,
            symbol: pos.symbol,
            token_balance: tokenBalance,
            should_sell: decision.shouldSell,
            reason: decision.reason
          });
        }

        if (decision.shouldSell && tokenBalance > 0) {
          console.error(`[Executor] ⚡⚡⚡ AUTO-SELLING POSITION: ${pos.symbol} - ${decision.reason} ⚡⚡⚡`);
          console.error(`[Executor] 📊 Position details:`, {
            position_id: pos.id,
            user_id: userId,
            symbol: pos.symbol,
            buy_price: buyPrice.toFixed(8),
            current_price: currentPrice.toFixed(8),
            gain_percent: gainPercent.toFixed(2),
            loss_percent: lossPercent.toFixed(2),
            hold_time_minutes: holdTimeMinutes.toFixed(0),
            token_balance: tokenBalance,
            should_sell: decision.shouldSell,
            reason: decision.reason
          });

          try {
            console.error(`[Executor] 🚀🚀🚀 Executing SELL order for ${pos.symbol}: ${tokenBalance} tokens 🚀🚀🚀`);
            console.error(`[Executor] Request params:`, { token_id: tokenId, amount_token: tokenBalance, user_id: userId });
            const order = await this.executeSell({ token_id: tokenId, amount_token: tokenBalance, order_type: 'SELL' }, userId);
            console.error(`[Executor] ✅✅✅ VENDA EXECUTADA COM SUCESSO: Order ${order.id} para ${pos.symbol} ✅✅✅`);

            // Criar notificação baseada no motivo
            let notificationType = 'position_closed';
            let notificationTitle = 'Posição fechada automaticamente';
            let notificationMessage = `🤖 Fechei a posição em ${pos.symbol} automaticamente: ${decision.reason}`;

            if (decision.reason.includes('Take-profit')) {
              notificationType = 'take_profit_hit';
              notificationTitle = 'Take-profit atingido!';
              notificationMessage = `🤖 🎉 Take-profit atingido em ${pos.symbol}! Lucro realizado. Fechando posição agora!`;
            } else if (decision.reason.includes('Stop-loss')) {
              notificationType = 'stop_loss_hit';
              notificationTitle = 'Stop-loss atingido';
              notificationMessage = `🤖 ⚠️ Stop-loss atingido em ${pos.symbol}. Perda limitada. Fechando posição para proteger capital...`;
            }

            await this.createNotification(
              userId,
              notificationType,
              notificationType.includes('profit') || notificationType.includes('take') ? 'success' : 'warning',
              notificationTitle,
              notificationMessage,
              { order_id: order.id, symbol: pos.symbol, reason: decision.reason }
            );
          } catch (error: any) {
            console.error(`[Executor] ❌❌❌ FAILED TO AUTO-SELL POSITION ${pos.id} (${pos.symbol}):`, {
              error_message: error.message,
              error_stack: error.stack,
              position_id: pos.id,
              user_id: userId,
              token_id: tokenId,
              symbol: pos.symbol,
              token_balance: tokenBalance,
              hold_time_minutes: holdTimeMinutes.toFixed(0),
              reason: decision.reason
            });
            await this.createNotification(
              userId,
              'error_occurred',
              'error',
              'Erro ao vender posição',
              `🤖 ⚠️ Erro ao vender ${pos.symbol} automaticamente: ${error.message}. Tentarei novamente na próxima verificação.`,
              { symbol: pos.symbol, error: error.message, position_id: pos.id, stack: error.stack }
            );
          }
        }
      }

      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);
      console.error(`[Executor] ✅✅✅ ========== POSITION MONITORING COMPLETED (${duration}s) ========== ✅✅✅`);
    } catch (error: any) {
      console.error('[Executor] ❌❌❌ CRITICAL ERROR monitoring positions:', error);
      console.error('[Executor] ❌ Error message:', error.message);
      console.error('[Executor] ❌ Error stack:', error.stack);

      // Se houver erro crítico, criar notificação
      try {
        const defaultUserId = await this.ensureDefaultUser();
        await this.createNotification(
          defaultUserId,
          'error_occurred',
          'error',
          'Erro crítico no monitoramento',
          `🚨 Erro crítico ao monitorar posições: ${error.message}. Verifique os logs do Executor Service!`,
          { error: error.message, stack: error.stack }
        );
      } catch (notifError) {
        console.error('[Executor] Failed to create error notification:', notifError);
      }
    }
  }

  /**
   * Verifica se o bot está habilitado para o usuário
   * Suporta tanto valores boolean quanto string 'true'/'false'
   */
  private async isBotEnabled(userId: string): Promise<boolean> {
    try {
      const result = await this.pool.query(
        'SELECT bot_enabled FROM user_profiles WHERE user_id = $1',
        [userId]
      );

      if (result.rows.length === 0) {
        console.log(`[Executor] ⚠️ No profile found for user ${userId}`);
        return false;
      }

      const botEnabledValue = result.rows[0].bot_enabled;

      // Lidar com diferentes tipos
      if (typeof botEnabledValue === 'boolean') {
        return botEnabledValue;
      }

      if (typeof botEnabledValue === 'string') {
        return botEnabledValue.toLowerCase() === 'true' || botEnabledValue === '1';
      }

      // Para valores numéricos (0/1)
      if (typeof botEnabledValue === 'number') {
        return botEnabledValue !== 0;
      }

      // Default: tentar converter para boolean
      return Boolean(botEnabledValue);
    } catch (error: any) {
      console.error(`[Executor] ❌ Error checking bot enabled for user ${userId}:`, {
        message: error.message,
        stack: error.stack
      });
      return false;
    }
  }

  /**
   * Cria notificação do bot
   */
  private async createNotification(
    userId: string,
    type: string,
    severity: 'success' | 'info' | 'warning' | 'error',
    title: string,
    message: string,
    data?: any
  ): Promise<void> {
    try {
      // IMPORTANTE: Limitar criação de notificações para evitar lotar o banco
      // Não criar notificação se já existe uma similar recente (últimos 5 minutos)
      if (severity === 'info' && type !== 'error' && type !== 'trade_executed' && type !== 'position_opened' && type !== 'position_closed') {
        const recentNotification = await this.pool.query(
          `SELECT id FROM bot_notifications 
           WHERE user_id = $1 
           AND notification_type = $2 
           AND title = $3
           AND created_at > NOW() - INTERVAL '5 minutes'
           LIMIT 1`,
          [userId, type, title]
        );

        if (recentNotification.rows.length > 0) {
          console.log(`[Executor] ⏭️ Skipping duplicate notification: ${type} - ${title}`);
          return; // Não criar notificação duplicada
        }
      }

      // Limitar número total de notificações por usuário (manter apenas últimas 1000)
      const countResult = await this.pool.query(
        `SELECT COUNT(*) as count FROM bot_notifications WHERE user_id = $1`,
        [userId]
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      if (totalCount > 1000) {
        // Deletar notificações lidas mais antigas
        await this.pool.query(
          `DELETE FROM bot_notifications 
           WHERE user_id = $1 
           AND is_read = true 
           AND id IN (
             SELECT id FROM bot_notifications 
             WHERE user_id = $1 AND is_read = true 
             ORDER BY created_at ASC 
             LIMIT $2
           )`,
          [userId, totalCount - 900] // Manter 900, deletar o restante
        );
        console.log(`[Executor] 🧹 Cleaned up old read notifications for user ${userId}`);
      }

      await this.pool.query(
        `INSERT INTO bot_notifications (user_id, notification_type, severity, title, message, data)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [userId, type, severity, title, message, data ? JSON.stringify(data) : null]
      );
    } catch (error: any) {
      console.warn('[Executor] Failed to create notification:', error.message);
    }
  }

  async processSignal(signal: Signal): Promise<void> {
    const tokenId = signal.token_id;
    const signalType = signal.signal_type;
    const tokenSymbol = (signal as any).symbol || (signal as any).name || 'unknown';

    try {
      console.log(`[Executor] 📥 Received ${signalType} signal for ${tokenSymbol} (tokenId: ${tokenId})`);
      console.log(`[Executor] 📥 Signal details:`, {
        id: signal.id,
        token_id: tokenId,
        signal_type: signalType,
        confidence_score: signal.confidence_score,
        potential_multiplier: signal.potential_multiplier,
        symbol: tokenSymbol
      });

      // Buscar TODOS os usuários com bot habilitado
      // Suportar tanto boolean true quanto string 'true'
      const usersResult = await this.pool.query(
        `SELECT user_id, bot_enabled 
         FROM user_profiles 
         WHERE bot_enabled = true OR bot_enabled = 'true' OR bot_enabled = '1'`
      );

      console.log(`[Executor] 🔍 Found ${usersResult.rows.length} user(s) with bot potentially enabled`);

      // Filtrar apenas usuários realmente habilitados (double-check)
      const activeUsers: string[] = [];
      for (const row of usersResult.rows) {
        const botEnabled = await this.isBotEnabled(row.user_id);
        if (botEnabled) {
          activeUsers.push(row.user_id);
        } else {
          console.log(`[Executor] ⚠️ User ${row.user_id} marked as enabled but verification failed`);
        }
      }

      if (activeUsers.length === 0) {
        console.log(`[Executor] ⚠️ No users with bot enabled. Ensuring default user...`);
        // Garantir usuário padrão pelo menos
        const defaultUserId = await this.ensureDefaultUser();
        activeUsers.push(defaultUserId);
        console.log(`[Executor] ✅ Using default user ${defaultUserId}`);
      }

      console.log(`[Executor] 🔍 Processing ${signalType} signal for ${activeUsers.length} active user(s): ${activeUsers.join(', ')}`);

      // Processar sinal para cada usuário com bot habilitado
      let processedCount = 0;
      let errorCount = 0;

      for (const userId of activeUsers) {
        try {
          console.log(`[Executor] 🔄 Processing ${signalType} signal for user ${userId}...`);
          await this.processSignalForUser(signal, userId, tokenSymbol);
          processedCount++;
          console.log(`[Executor] ✅ Successfully processed ${signalType} signal for user ${userId}`);
        } catch (error: any) {
          errorCount++;
          console.error(`[Executor] ❌ Error processing ${signalType} signal for user ${userId}:`, {
            message: error.message,
            stack: error.stack,
            signal_id: signal.id,
            token_symbol: tokenSymbol
          });
          // Continuar para próximo usuário
        }
      }

      console.log(`[Executor] 📊 Signal processing complete: ${processedCount} succeeded, ${errorCount} failed`);

    } catch (error: any) {
      console.error(`[Executor] ❌ Critical error processing signal for ${tokenSymbol}:`, {
        message: error.message,
        stack: error.stack,
        signal_id: signal.id,
        token_id: tokenId,
        signal_type: signalType
      });
      throw error; // Re-throw para que o caller saiba que falhou
    }
  }

  private async processSignalForUser(signal: Signal, userId: string, tokenSymbol: string): Promise<void> {
    const signalType = signal.signal_type;
    const tokenId = signal.token_id;

    console.log(`[Executor] 🔄 Processing ${signalType} signal for user ${userId}, token ${tokenSymbol} (${tokenId})`);

    try {
      console.log(`[Executor] 🔄 Starting processing ${signalType} signal for user ${userId} - ${tokenSymbol} (tokenId: ${tokenId})`);

      // Verificar se o bot está habilitado para este usuário específico
      const botEnabled = await this.isBotEnabled(userId);
      if (!botEnabled) {
        console.log(`[Executor] ⏸️ Bot disabled for user ${userId}, skipping ${signalType} signal for ${tokenSymbol}`);
        await this.createNotification(
          userId,
          'info',
          'info',
          'Bot desabilitado',
          `🤖 Recebi um sinal ${signalType} para ${tokenSymbol}, mas o bot está desabilitado para este usuário.`,
          { signal_type: signalType, symbol: tokenSymbol, user_id: userId }
        );
        return;
      }

      console.log(`[Executor] ✅ Bot enabled for user ${userId}! Processing ${signalType} signal for ${tokenSymbol}...`);

      // Criar notificação de recebimento do sinal
      await this.createNotification(
        userId,
        'info',
        'info',
        'Sinal recebido',
        `🤖 Recebi um sinal ${signalType} para ${tokenSymbol} (confiança: ${signal.confidence_score}%, multiplicador: ${signal.potential_multiplier}x). Processando...`,
        {
          signal_id: signal.id,
          signal_type: signalType,
          symbol: tokenSymbol,
          confidence_score: signal.confidence_score,
          potential_multiplier: signal.potential_multiplier
        }
      );

      // Garantir que o usuário tenha perfil e saldo inicial
      const userProfileResult = await this.pool.query(
        'SELECT user_id FROM user_profiles WHERE user_id = $1',
        [userId]
      );

      if (userProfileResult.rows.length === 0) {
        // Criar perfil básico se não existir
        await this.pool.query(
          `INSERT INTO user_profiles (user_id, risk_profile, bot_enabled, bot_intensity, max_loss_percent, max_gain_percent, max_open_trades)
         VALUES ($1, 'moderate', true, 5, 10, 25, 3)
         ON CONFLICT (user_id) DO NOTHING`,
          [userId]
        );
        console.log(`[Executor] ✅ Created profile for user ${userId}`);
      }

      // Garantir saldo inicial para este usuário (apenas se em modo SIMULATION)
      if (this.executionMode === 'simulation') {
        const existingDeposit = await this.pool.query(
          `SELECT COUNT(*) as count FROM ledger_entries 
         WHERE user_id = $1 AND entry_type = 'deposit' AND description = 'Initial paper trading deposit'`,
          [userId]
        );

        // Se já existe depósito inicial, não criar outro
        if (Number(existingDeposit.rows[0]?.count ?? 0) === 0) {
          const balanceResult = await this.pool.query(
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
            await this.pool.query(
              `INSERT INTO ledger_entries (user_id, entry_type, amount_usd, description, balance_before, balance_after)
             VALUES ($1, 'deposit', $2, 'Initial paper trading deposit', $3, $4)`,
              [userId, depositAmount, currentBalance, currentBalance + depositAmount]
            );
            console.log(`[Executor] 💰 Created initial deposit of $${depositAmount} for user ${userId}`);

            // Criar notificação de saldo inicial
            await this.createNotification(
              userId,
              'order_executed',
              'success',
              'Sistema iniciado',
              `🤖 Sistema de trading iniciado! Saldo inicial de $${depositAmount} USD foi creditado. Aguardando oportunidades de trading...`,
              { amount: depositAmount, type: 'initial_deposit' }
            );
          }
        }
      }

      if (signal.signal_type === 'BUY') {
        try {
          // Verificar se já existe posição aberta para este token (evitar múltiplas compras)
          const existingPosition = await this.pool.query(
            `SELECT id, created_at FROM positions 
           WHERE user_id = $1 AND token_id = $2 AND status = 'open'`,
            [userId, tokenId]
          );

          if (existingPosition.rows.length > 0) {
            const positionAge = Date.now() - new Date(existingPosition.rows[0].created_at).getTime();
            const positionAgeMinutes = positionAge / (1000 * 60);

            // Se a posição foi criada há menos de 5 minutos, não comprar novamente
            if (positionAgeMinutes < 5) {
              console.log(`[Executor] ⚠️ Position for ${tokenSymbol} was created ${positionAgeMinutes.toFixed(1)} minutes ago, skipping duplicate BUY`);
              return;
            }
          }

          // Verificar se já foi processado um sinal BUY para este token recentemente (últimos 2 minutos)
          const recentOrder = await this.pool.query(
            `SELECT id, created_at FROM orders 
           WHERE user_id = $1 AND token_id = $2 AND order_type = 'BUY' 
           AND created_at > NOW() - INTERVAL '2 minutes'
           ORDER BY created_at DESC LIMIT 1`,
            [userId, tokenId]
          );

          if (recentOrder.rows.length > 0) {
            const orderAge = Date.now() - new Date(recentOrder.rows[0].created_at).getTime();
            const orderAgeSeconds = orderAge / 1000;

            if (orderAgeSeconds < 120) {
              console.log(`[Executor] ⚠️ BUY order for ${tokenSymbol} was created ${orderAgeSeconds.toFixed(0)} seconds ago, skipping duplicate signal`);
              return;
            }
          }

          // Verificar limite de trades paralelos
          const profileResult = await this.pool.query(
            'SELECT max_open_trades FROM user_profiles WHERE user_id = $1',
            [userId]
          );
          const maxOpenTrades = Number(profileResult.rows[0]?.max_open_trades ?? 3);

          const openPositionsResult = await this.pool.query(
            'SELECT COUNT(*) as count FROM positions WHERE user_id = $1 AND status = $2',
            [userId, 'open']
          );
          const openPositionsCount = Number(openPositionsResult.rows[0]?.count ?? 0);

          if (openPositionsCount >= maxOpenTrades) {
            console.log(`[Executor] ⚠️ Max open trades (${maxOpenTrades}) reached, skipping BUY for ${tokenSymbol}`);
            await this.createNotification(
              userId,
              'error_occurred',
              'info',
              'Limite de trades atingido',
              `🤖 Tentei comprar ${tokenSymbol}, mas já tenho ${openPositionsCount} posições abertas (máximo: ${maxOpenTrades}). Vou aguardar...`,
              { symbol: tokenSymbol, open_positions: openPositionsCount, max_open_trades: maxOpenTrades }
            );
            return;
          }

          // Verificar saldo disponível antes de comprar (considerando posições abertas)
          const balanceCheck = await this.pool.query(
            `SELECT 
             COALESCE(SUM(CASE WHEN entry_type IN ('deposit', 'trade_profit') THEN amount_usd ELSE 0 END), 0) AS credits,
             COALESCE(SUM(CASE WHEN entry_type IN ('trade_loss', 'fee', 'gas') THEN ABS(amount_usd) ELSE 0 END), 0) AS debits
           FROM ledger_entries
           WHERE user_id = $1`,
            [userId]
          );
          const credits = Number(balanceCheck.rows[0]?.credits ?? 0);
          const debits = Number(balanceCheck.rows[0]?.debits ?? 0);
          const totalBalance = Math.max(0, credits - debits);

          // Buscar investido em posições abertas
          const openPositionsCheck = await this.pool.query(
            `SELECT COALESCE(SUM(invested_amount_usd), 0) AS total_invested
           FROM positions
           WHERE user_id = $1 AND status = 'open'`,
            [userId]
          );
          const investedInPositions = Number(openPositionsCheck.rows[0]?.total_invested ?? 0);

          // Saldo disponível = total - investido em posições abertas
          const availableBalance = Math.max(0, totalBalance - investedInPositions);

          console.log(`[Executor] 💰 Balance check before BUY for ${tokenSymbol}:`, {
            total_balance: totalBalance,
            invested_in_positions: investedInPositions,
            available_balance: availableBalance
          });

          if (availableBalance < 5) {
            console.log(`[Executor] ⚠️ Insufficient available balance ($${availableBalance.toFixed(2)}), skipping BUY for ${tokenSymbol}`);
            await this.createNotification(
              userId,
              'error_occurred',
              'warning',
              'Saldo insuficiente',
              `🤖 Tentei comprar ${tokenSymbol}, mas meu saldo disponível é de apenas $${availableBalance.toFixed(2)} (total: $${totalBalance.toFixed(2)}, investido: $${investedInPositions.toFixed(2)}). Mínimo necessário: $5.00. Aguardando mais capital...`,
              { symbol: tokenSymbol, total_balance: totalBalance, invested: investedInPositions, available_balance: availableBalance }
            );
            return;
          }

          console.log(`[Executor] 💰 Available balance: $${availableBalance.toFixed(2)} | Processing BUY for ${tokenSymbol}...`);
          const order = await this.executeBuy({ token_id: tokenId, signal_id: signal.id, order_type: 'BUY' }, userId);
          console.log(`[Executor] ✅ BUY order executed: ${order.id} for ${tokenSymbol} | Amount: $${Number(order.amount_usd ?? 0).toFixed(2)}`);

          await this.createNotification(
            userId,
            'order_executed',
            'success',
            'Ordem BUY executada',
            `🤖 Executei uma ordem BUY de $${Number(order.amount_usd ?? 0).toFixed(2)} em ${tokenSymbol}! Simulando execução...`,
            { order_id: order.id, symbol: tokenSymbol, amount: order.amount_usd, type: 'BUY' }
          );
        } catch (error: any) {
          console.error(`[Executor] ❌ Failed to execute BUY for ${tokenSymbol}:`, error.message);
          await this.createNotification(
            userId,
            'error_occurred',
            'error',
            'Erro ao executar BUY',
            `🤖 ⚠️ Ops! Erro ao executar BUY em ${tokenSymbol}: ${error.message}. Continuando operação...`,
            { symbol: tokenSymbol, error: error.message }
          );
          throw error;
        }
      } else if (signal.signal_type === 'SELL') {
        try {
          console.log(`[Executor] 🔴 Processing SELL signal for ${tokenSymbol} (tokenId: ${tokenId}, userId: ${userId})`);

          // IMPORTANTE: Buscar posição aberta para este token e usuário
          const positionResult = await this.pool.query(
            `SELECT p.*, t.symbol, t.name 
           FROM positions p
           JOIN tokens t ON p.token_id = t.id
           WHERE p.user_id = $1 
           AND p.token_id = $2 
           AND p.status = 'open'`,
            [userId, tokenId]
          );

          console.log(`[Executor] 🔍 Found ${positionResult.rows.length} open position(s) for ${tokenSymbol}`);

          if (positionResult.rows.length > 0) {
            for (const pos of positionResult.rows) {
              const balance = Number(pos.token_balance ?? 0);
              const positionId = pos.id;

              console.log(`[Executor] 🔍 Position details:`, {
                position_id: positionId,
                token_balance: balance,
                invested_amount: pos.invested_amount_usd,
                buy_price: pos.buy_price_usd
              });

              if (balance > 0) {
                console.log(`[Executor] 💰 Executing SELL for ${tokenSymbol}: selling ${balance} tokens`);
                const order = await this.executeSell({ token_id: tokenId, signal_id: signal.id, amount_token: balance, order_type: 'SELL' }, userId);
                console.log(`[Executor] ✅ SELL order executed: ${order.id} for ${tokenSymbol}`);

                // Buscar profit/loss atualizado da ordem
                const orderResult = await this.pool.query(
                  'SELECT profit_loss_usd, profit_loss_percent FROM orders WHERE id = $1',
                  [order.id]
                );
                const orderData = orderResult.rows[0];

                const profitLoss = Number(orderData?.profit_loss_usd ?? 0);
                const profitLossPercent = Number(orderData?.profit_loss_percent ?? 0);
                const isProfit = profitLoss >= 0;

                console.log(`[Executor] 💰 SELL completed: ${isProfit ? 'PROFIT' : 'LOSS'} of $${Math.abs(profitLoss).toFixed(2)} (${Math.abs(profitLossPercent).toFixed(2)}%)`);

                await this.createNotification(
                  userId,
                  isProfit ? 'profit_realized' : 'loss_realized',
                  isProfit ? 'success' : 'warning',
                  isProfit ? 'Lucro realizado!' : 'Perda realizada',
                  `🤖 ${isProfit ? '🎉' : '⚠️'} Fechei a posição em ${tokenSymbol}! ${isProfit ? 'Ganho' : 'Perda'} de $${Math.abs(profitLoss).toFixed(2)} (${Math.abs(profitLossPercent).toFixed(2)}%). Continuando análise...`,
                  { order_id: order.id, symbol: tokenSymbol, profit_loss: profitLoss, profit_loss_percent: profitLossPercent }
                );
              } else {
                console.log(`[Executor] ⚠️ Position ${positionId} for ${tokenSymbol} has zero balance, skipping sell`);
              }
            }
          } else {
            console.log(`[Executor] ⚠️ No open position found for ${tokenSymbol} (tokenId: ${tokenId}) when processing SELL signal`);
            await this.createNotification(
              userId,
              'signal_received',
              'info',
              'Sinal SELL recebido',
              `🤖 Recebi um sinal SELL para ${tokenSymbol}, mas não há posição aberta para vender. Aguardando novas oportunidades...`,
              { symbol: tokenSymbol, signal_type: 'SELL' }
            );
          }
        } catch (error: any) {
          console.error(`[Executor] ❌ Error processing SELL signal for ${tokenSymbol}:`, error);
          console.error(`[Executor] ❌ Error stack:`, error.stack);
          await this.createNotification(
            userId,
            'error_occurred',
            'error',
            'Erro ao processar sinal SELL',
            `🤖 ⚠️ Erro ao processar sinal SELL para ${tokenSymbol}: ${error.message}. Verificando novamente...`,
            { symbol: tokenSymbol, error: error.message }
          );
          console.error(`[Executor] ⚠️ Error stack:`, error.stack);
          // Não propagar erro - pode não ter posição para vender
        }
      } else if (signal.signal_type === 'HOLD') {
        console.log(`[Executor] ⏸️ HOLD signal for ${tokenSymbol} - no action taken for user ${userId}`);
        await this.createNotification(
          userId,
          'info',
          'info',
          'Sinal HOLD',
          `🤖 Recebi um sinal HOLD para ${tokenSymbol}. Aguardando confirmação antes de agir.`,
          { signal_type: 'HOLD', symbol: tokenSymbol, confidence_score: signal.confidence_score }
        );
      } else {
        console.log(`[Executor] ⚠️ Unknown signal type: ${signal.signal_type} for ${tokenSymbol} (user: ${userId})`);
        await this.createNotification(
          userId,
          'warning',
          'warning',
          'Tipo de sinal desconhecido',
          `🤖 ⚠️ Recebi um tipo de sinal desconhecido: ${signal.signal_type} para ${tokenSymbol}`,
          { signal_type: signal.signal_type, symbol: tokenSymbol }
        );
      }
    } catch (error: any) {
      console.error(`[Executor] ❌ Error processing ${signalType} signal for user ${userId} - ${tokenSymbol}:`, {
        message: error.message,
        stack: error.stack,
        signal_id: signal.id,
        token_id: tokenId,
        user_id: userId
      });

      // Tentar criar notificação de erro
      try {
        await this.createNotification(
          userId,
          'error_occurred',
          'error',
          'Erro ao processar sinal',
          `🤖 ⚠️ Erro ao processar sinal ${signalType} para ${tokenSymbol}: ${error.message}`,
          {
            signal_type: signalType,
            symbol: tokenSymbol,
            error: error.message,
            error_stack: error.stack,
            signal_id: signal.id
          }
        );
      } catch (notifError: any) {
        console.error(`[Executor] ❌ Failed to create error notification:`, notifError.message);
      }

      // Re-throw para que o caller saiba que falhou
      throw error;
    }
  }
}

