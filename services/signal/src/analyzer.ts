import { Pool } from 'pg';
import { Signal, Token, SignalType } from '@shared/types';
import crypto from 'crypto';

export class SignalAnalyzer {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Gera fator único baseado no contract_address para diferenciar tokens
   */
  private getTokenUniquenessFactor(contractAddress: string): number {
    const hash = crypto.createHash('md5').update(contractAddress).digest('hex');
    const hashNum = parseInt(hash.substring(0, 8), 16);
    return (hashNum % 100) / 1000; // 0-0.1 (variação sutil de 0-10%)
  }

  /**
   * Detecta se um token tem características de meme coin
   * Meme coins geralmente têm: alta volatilidade, volume alto, muitos holders, idade recente
   */
  private isMemecoin(
    volume24h: number,
    liquidityUsd: number,
    holdersCount: number,
    ageDays: number
  ): boolean {
    // Calcular relação volume/liquidez (alta = alta volatilidade)
    const volumeLiquidityRatio = liquidityUsd > 0 ? volume24h / liquidityUsd : 0;
    
    // Critérios para meme coin:
    // 1. Volume alto em relação à liquidez (volatilidade alta)
    // 2. Muitos holders (comunidade grande)
    // 3. Token novo (idade < 30 dias)
    // 4. Volume absoluto alto (> $50k)
    const hasHighVolatility = volumeLiquidityRatio > 5; // Volume 5x maior que liquidez
    const hasManyHolders = holdersCount > 500;
    const isNewToken = ageDays < 30;
    const hasHighVolume = volume24h > 50_000;
    
    // É meme coin se atender pelo menos 3 dos 4 critérios
    const criteriaMet = [hasHighVolatility, hasManyHolders, isNewToken, hasHighVolume].filter(Boolean).length;
    return criteriaMet >= 3;
  }

  /**
   * Analisa um token e gera um sinal (BUY/SELL/HOLD)
   */
  async analyzeToken(tokenId: string): Promise<Signal> {
    try {
      // Buscar token do banco
      const tokenResult = await this.pool.query('SELECT * FROM tokens WHERE id = $1', [tokenId]);

      if (tokenResult.rows.length === 0) {
        throw new Error('Token not found');
      }

      const token: Token = tokenResult.rows[0];

      // Calcular scores individuais
      const volume24h = Number((token as any).volume_24h_usd ?? 0);
      const liquidityUsd = Number((token as any).liquidity_usd ?? 0);
      const holdersCount = Number((token as any).holders_count ?? 0);
      const priceAtSignal = token.price_usd != null ? Number(token.price_usd) : null;

      // Calcular idade do token em dias
      const firstSeen = (token as any).first_seen_at ?? (token as any).created_at ?? null;
      const ageDays = firstSeen 
        ? (Date.now() - new Date(firstSeen).getTime()) / (1000 * 60 * 60 * 24)
        : 0;

      // Detectar se é meme coin
      const isMemecoin = this.isMemecoin(volume24h, liquidityUsd, holdersCount, ageDays);

      const volumeScore = this.calculateVolumeScore(volume24h);
      const liquidityScore = this.calculateLiquidityScore(liquidityUsd);
      const holdersScore = this.calculateHoldersScore(holdersCount);
      const ageScore = this.calculateAgeScore(firstSeen);
      const safetyScore = ((token.safety_score as any) || 0) / 100; // Normalizar para 0-1

      // Calcular score geral (pesos conforme especificação)
      const overallScore =
        volumeScore * 0.3 +
        liquidityScore * 0.25 +
        holdersScore * 0.2 +
        ageScore * 0.15 +
        safetyScore * 0.1;

      // Fator único por token para criar variação
      const uniquenessFactor = this.getTokenUniquenessFactor(token.contract_address);

      // Calcular desvio padrão dos scores individuais (medida de consistência)
      const scores = [volumeScore, liquidityScore, holdersScore, ageScore, safetyScore];
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      const variance = scores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / scores.length;
      const stdDev = Math.sqrt(variance);

      // Calcular confiança melhorada (30% a 95%)
      // Baseado em overall_score, mas ajustado por consistência (stdDev) e fatores únicos
      const consistencyBonus = (1 - stdDev) * 15; // Mais consistente = maior confiança
      const baseConfidence = overallScore * 100;
      const adjustedConfidence = Math.max(
        30,
        Math.min(95, baseConfidence + consistencyBonus + uniquenessFactor * 100)
      );
      const confidenceScore = Number(adjustedConfidence.toFixed(2));

      // Determinar tipo de sinal
      let signalType: SignalType = 'HOLD';
      let potentialMultiplier: number | undefined;
      let reasoning = '';

      // Calcular relação volume/liquidez para ajustar multiplicador
      const volumeLiquidityRatio = liquidityUsd > 0 ? volume24h / liquidityUsd : 0;
      const volumeLiquidityFactor = Math.min(1.5, Math.max(0.5, volumeLiquidityRatio / 10));

      // Ajustar thresholds baseado em se é meme coin
      // Para meme coins: thresholds mais baixos para movimentos rápidos
      // BUY threshold: 0.50 para meme coins (vs 0.55 normal)
      // SELL threshold: 0.30 para meme coins (vs 0.25 normal) - mais conservador para evitar vendas prematuras
      const buyThreshold = isMemecoin ? 0.50 : 0.55;
      const sellThreshold = isMemecoin ? 0.30 : 0.25;
      
      if (overallScore >= buyThreshold && !token.is_honeypot && liquidityUsd > 1_000) {
        signalType = 'BUY';
        // Para meme coins: multiplicadores mais agressivos (movimentos rápidos esperados)
        const memecoinMultiplier = isMemecoin ? 1.2 : 1.0; // 20% extra para meme coins
        const baseMultiplier = 1 + (overallScore - buyThreshold) * 12; // Mais sensível para scores menores
        const volumeLiquidityBonus = (volumeLiquidityFactor - 1) * 0.5;
        const safetyBonus = safetyScore * 2; // Até 2x extra para segurança alta
        potentialMultiplier = Number(
          Math.min(5, Math.max(1.1, baseMultiplier * memecoinMultiplier + volumeLiquidityBonus + safetyBonus + uniquenessFactor * 2)).toFixed(2)
        );
        const memecoinTag = isMemecoin ? ' [MEME COIN]' : '';
        reasoning = `Fundamentos positivos${memecoinTag}: volume ${Math.round(volumeScore * 100)}% | liquidez ${Math.round(
          liquidityScore * 100
        )}% | holders ${Math.round(holdersScore * 100)}% | segurança ${Math.round(safetyScore * 100)}%`;
      } else if (overallScore < sellThreshold || token.is_honeypot) {
        signalType = 'SELL';
        // Para meme coins: multiplicador SELL mais conservador (evitar vendas prematuras)
        const memecoinSellFactor = isMemecoin ? 0.95 : 1.0; // 5% menos agressivo para meme coins
        const severity = token.is_honeypot ? 0.3 : (sellThreshold - overallScore) / sellThreshold;
        potentialMultiplier = Number(Math.max(0.4, Math.min(0.9, (1 - severity * 0.6) * memecoinSellFactor + uniquenessFactor * 0.1)).toFixed(2));
        const memecoinTag = isMemecoin ? ' [MEME COIN]' : '';
        reasoning = token.is_honeypot
          ? 'Honeypot detectado - risco extremo'
          : `Indicadores críticos${memecoinTag}: score geral ${Math.round(overallScore * 100)}% abaixo do mínimo`;
      } else {
        signalType = 'HOLD';
        // Multiplicador HOLD varia de 0.8x a 1.5x baseado no drift do score
        const drift = overallScore - 0.4; // Centro em 0.4 (40%)
        const driftMultiplier = drift * 1.75; // Ajuste mais sensível
        potentialMultiplier = Number(
          Math.min(1.5, Math.max(0.8, 1 + driftMultiplier + uniquenessFactor * 0.3)).toFixed(2)
        );
        const memecoinTag = isMemecoin ? ' [MEME COIN - aguardar movimento]' : '';
        reasoning = `Contexto neutro${memecoinTag}: score geral ${Math.round(overallScore * 100)}% | consistência ${Math.round(
          (1 - stdDev) * 100
        )}% - aguardar confirmação`;
      }

      const metrics = {
        token_id: tokenId,
        signal_type: signalType,
        confidence_score: confidenceScore,
        potential_multiplier: potentialMultiplier,
        reasoning,
        is_active: true,
        volume_score: Number((volumeScore * 100).toFixed(2)),
        liquidity_score: Number((liquidityScore * 100).toFixed(2)),
        holders_score: Number((holdersScore * 100).toFixed(2)),
        age_score: Number((ageScore * 100).toFixed(2)),
        safety_score: Number((safetyScore * 100).toFixed(2)),
        overall_score: Number((overallScore * 100).toFixed(2)),
        price_at_signal: priceAtSignal,
      } as const;

      const latestSignal = await this.getLatestSignal(tokenId);

      if (latestSignal) {
        const sameType = latestSignal.signal_type === signalType;
        const confidenceDiff = Math.abs(Number(latestSignal.confidence_score ?? 0) - metrics.confidence_score);
        const overallDiff = Math.abs(Number(latestSignal.overall_score ?? 0) - metrics.overall_score);
        const previousPrice = Number(latestSignal.price_at_signal ?? latestSignal.price_usd ?? 0);
        const currentPrice = priceAtSignal ?? previousPrice;
        const priceDiff = previousPrice > 0 ? Math.abs(previousPrice - currentPrice) / previousPrice : 0;

        const confidenceThreshold = Number(process.env.SIGNAL_CONFIDENCE_THRESHOLD ?? 2);
        const overallThreshold = Number(process.env.SIGNAL_OVERALL_THRESHOLD ?? 2.5);
        const priceThreshold = Number(process.env.SIGNAL_PRICE_THRESHOLD ?? 0.02);

        const metricsShifted = confidenceDiff > 0 || overallDiff > 0 || priceDiff > 0;
        const withinThresholds =
          confidenceDiff <= confidenceThreshold && overallDiff <= overallThreshold && priceDiff <= priceThreshold;

        // IMPORTANTE: Não criar novo sinal se for igual ao anterior
        // Isso evita lotar o banco com sinais HOLD repetidos
        if (sameType && withinThresholds) {
          if (metricsShifted) {
            const updated = await this.updateSignal(latestSignal.id, metrics);
            console.log(`[Signal Analyzer] 🔄 Updated existing signal ${latestSignal.id} for token ${tokenId} (avoided duplicate)`);
            return updated;
          }
          console.log(`[Signal Analyzer] ⏭️ Skipping duplicate signal for token ${tokenId} (same as latest)`);
          return latestSignal;
        }
      }

      const signal = await this.saveSignal(metrics);
      await this.deactivateOtherSignals(tokenId, signal.id);
      return signal;
    } catch (error: any) {
      console.error('Analysis error:', error);
      throw error;
    }
  }

  private async getLatestSignal(tokenId: string): Promise<Signal | null> {
    const result = await this.pool.query(
      `SELECT * FROM signals WHERE token_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [tokenId]
    );
    return result.rows[0] ?? null;
  }

  private async updateSignal(
    signalId: string,
    payload: {
      signal_type: SignalType;
      confidence_score: number;
      potential_multiplier?: number | undefined;
      reasoning: string;
      volume_score?: number;
      liquidity_score?: number;
      holders_score?: number;
      age_score?: number;
      safety_score?: number;
      overall_score?: number;
      price_at_signal?: number | null;
      is_active: boolean;
    }
  ): Promise<Signal> {
    const result = await this.pool.query(
      `UPDATE signals SET
         signal_type = $2,
         confidence_score = $3,
         potential_multiplier = $4,
         reasoning = $5,
         volume_score = $6,
         liquidity_score = $7,
         holders_score = $8,
         age_score = $9,
         safety_score = $10,
         overall_score = $11,
         price_at_signal = $12,
         is_active = $13
       WHERE id = $1
       RETURNING *`,
      [
        signalId,
        payload.signal_type,
        payload.confidence_score,
        payload.potential_multiplier ?? null,
        payload.reasoning,
        payload.volume_score ?? null,
        payload.liquidity_score ?? null,
        payload.holders_score ?? null,
        payload.age_score ?? null,
        payload.safety_score ?? null,
        payload.overall_score ?? null,
        payload.price_at_signal ?? null,
        payload.is_active,
      ]
    );

    return result.rows[0] as Signal;
  }

  private async deactivateOtherSignals(tokenId: string, activeId: string): Promise<void> {
    await this.pool.query(
      `UPDATE signals SET is_active = false, expires_at = NOW()
       WHERE token_id = $1 AND id <> $2 AND is_active = true`,
      [tokenId, activeId]
    );
  }

  /**
   * Salva um sinal no banco de dados
   */
  private async saveSignal(signalData: Partial<Signal> & {
    volume_score?: number;
    liquidity_score?: number;
    holders_score?: number;
    age_score?: number;
    safety_score?: number;
    overall_score?: number;
    price_at_signal?: number | null;
  }): Promise<Signal> {
    const result = await this.pool.query(
      `INSERT INTO signals (
        token_id, signal_type, confidence_score, potential_multiplier,
        volume_score, liquidity_score, holders_score, age_score, safety_score, overall_score,
        price_at_signal, reasoning, is_active, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
      RETURNING *`,
      [
        signalData.token_id,
        signalData.signal_type,
        signalData.confidence_score,
        signalData.potential_multiplier ?? null,
        signalData.volume_score ?? null,
        signalData.liquidity_score ?? null,
        signalData.holders_score ?? null,
        signalData.age_score ?? null,
        signalData.safety_score ?? null,
        signalData.overall_score ?? null,
        signalData.price_at_signal ?? null,
        signalData.reasoning,
        signalData.is_active ?? true,
      ]
    );

    return result.rows[0] as Signal;
  }

  /**
   * Calcula score de volume (0-1)
   */
  private calculateVolumeScore(volume24h: number): number {
    if (volume24h === 0) return 0;
    if (volume24h < 1000) return 0.2;
    if (volume24h < 5000) return 0.4;
    if (volume24h < 10000) return 0.6;
    if (volume24h < 50000) return 0.8;
    return 1.0;
  }

  /**
   * Calcula score de liquidez (0-1)
   */
  private calculateLiquidityScore(liquidity: number): number {
    if (liquidity === 0) return 0;
    if (liquidity < 1000) return 0.2;
    if (liquidity < 5000) return 0.4;
    if (liquidity < 10000) return 0.6;
    if (liquidity < 50000) return 0.8;
    return 1.0;
  }

  /**
   * Calcula score de holders (0-1)
   */
  private calculateHoldersScore(holders: number): number {
    if (holders === 0) return 0;
    if (holders < 50) return 0.2;
    if (holders < 100) return 0.4;
    if (holders < 500) return 0.6;
    if (holders < 1000) return 0.8;
    return 1.0;
  }

  /**
   * Calcula score de idade do token (0-1)
   */
  private calculateAgeScore(firstSeen: Date | string | null): number {
    if (!firstSeen) return 0.3; // Token novo, score médio

    const firstSeenDate = typeof firstSeen === 'string' ? new Date(firstSeen) : firstSeen;
    const now = new Date();
    const daysSince = (now.getTime() - firstSeenDate.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSince < 1) return 0.3; // Muito novo
    if (daysSince < 7) return 0.5; // Novinho
    if (daysSince < 30) return 0.7; // Estabelecido
    if (daysSince < 90) return 0.9; // Maduro
    return 1.0; // Muito antigo (confiável)
  }

  /**
   * Obtém sinais ativos
   */
  async getActiveSignals(limit: number = 50): Promise<any[]> {
    const result = await this.pool.query(
      `SELECT s.*, t.symbol, t.name, t.price_usd, t.liquidity_usd, t.volume_24h_usd
       FROM signals s
       JOIN tokens t ON s.token_id = t.id
       WHERE s.is_active = true
         AND (s.expires_at IS NULL OR s.expires_at > NOW())
       ORDER BY s.created_at DESC
       LIMIT $1`,
      [limit]
    );

    return result.rows;
  }

  async getSignalHistory(limit: number = 100): Promise<any[]> {
    const result = await this.pool.query(
      `SELECT s.*, t.symbol, t.name
       FROM signals s
       JOIN tokens t ON s.token_id = t.id
       ORDER BY s.created_at DESC
       LIMIT $1`,
      [limit]
    );

    return result.rows;
  }
}
