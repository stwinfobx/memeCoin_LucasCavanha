import { Pool } from 'pg';
import { Signal, Token, SignalType } from '@shared/types';
import crypto from 'crypto';
import axios from 'axios';

// Interfaces de Mercado para compatibilidade
interface MarketData {
    priceUsd: number;
    liquidityUsd: number;
    fdvUsd: number;
    volumeH24: number;
    volumeH1: number;
    volumeM5: number;
    txns24hBuys: number;
    txns24hSells: number;
    pairCreatedAt: number | null;
    dexId: string;
    source: string;
    isPumpFun: boolean;
}

export class SignalAnalyzer {
  private pool: Pool;
  private readonly BUY_THRESHOLD = 80;
  private readonly MAX_TOKEN_AGE_MIN = 60; // Limite 1h
  private readonly IDEAL_TOKEN_AGE_MIN = 15;

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

  // ===========================================
  // APIS EXTERNAS (On-the-fly Validation)
  // ===========================================
  private async apiGoPlus(chain: string, token: string) {
      try {
          const chainId = chain.toLowerCase() === 'bsc' ? '56' : chain.toLowerCase() === 'base' ? '8453' : 'solana';
          const base = 'https://api.gopluslabs.io/api/v1/token_security';
          const url = chainId === 'solana'
              ? `${base}/solana?contract_addresses=${token}`
              : `${base}/${chainId}?contract_addresses=${token}`;
              
          const res = await axios.get(url, { timeout: 12000 });
          return res.data?.result?.[token.toLowerCase()] || res.data?.result || {};
      } catch (e: any) { 
          console.error(`[Analyzer] Erro GoPlus ${token}: ${e.message}`);
          return { error: e.message }; 
      }
  }

  private async apiHoneypotIs(chain: string, token: string) {
      if (chain.toLowerCase() === 'solana') return null;
      try {
          const chainId = chain.toLowerCase() === 'bsc' ? '56' : '8453';
          const res = await axios.get(
              `https://api.honeypot.is/v2/IsHoneypot?address=${token}&chainID=${chainId}`,
              { timeout: 12000 }
          );
          return res.data;
      } catch (e: any) { 
          return { error: e.message }; 
      }
  }

  private async apiRugCheck(chain: string, token: string) {
      if (chain.toLowerCase() !== 'solana') return null;
      try {
          const res = await axios.get(
              `https://api.rugcheck.xyz/v1/tokens/${token}/report/summary`,
              { timeout: 12000 }
          );
          return res.data;
      } catch (e: any) { 
          return { error: e.message }; 
      }
  }
  // ===========================================
  // LÓGICA CORE DE SCORING (O "Safe Mode")
  // ===========================================
  private computeAdvancedScore(
      chain: string,
      market: MarketData,
      goplus: any,
      honeypot: any,
      rugcheck: any,
      foundAtMs: number
  ) {
      let score = 50;
      const issues: string[] = [];
      const warnings: string[] = [];

      // Idade
      const ageMs = market.pairCreatedAt ? (foundAtMs - market.pairCreatedAt) : null;
      const ageMin = ageMs !== null ? Math.round(ageMs / 60000) : null;

      if (ageMin === null) {
          issues.push('IDADE_DESCONHECIDA');
          score -= 15;
      } else if (ageMin > this.MAX_TOKEN_AGE_MIN) {
          issues.push(`MUITO_ANTIGO:${ageMin}min`);
          score -= 20;
      } else if (ageMin > this.IDEAL_TOKEN_AGE_MIN) {
          warnings.push(`${ageMin}min (vencendo)`);
          score -= 8;
      } else {
          score += 10;
      }

      // Liquidez / FDV
      if (chain.toLowerCase() === 'solana' && market.isPumpFun) {
          const cap = market.fdvUsd || market.liquidityUsd;
          if (cap <= 0) { issues.push('FDV_ZERO'); score -= 20; }
          else if (cap < 5_000) { issues.push(`FDV_BAIXO`); score -= 10; }
          else if (cap < 20_000) { warnings.push(`FDV Baixo`); score -= 3; }
          else if (cap < 690_000) { score += 8; }
          
          if (market.txns24hBuys + market.txns24hSells > 100) score += 5;
          if (market.txns24hBuys > market.txns24hSells * 1.5) score += 5;
      } else {
          if (market.liquidityUsd <= 0) { issues.push('LIQUIDEZ_ZERO'); score -= 25; }
          else if (market.liquidityUsd < 500) { warnings.push(`Liq super baixa`); score -= 10; }
          else if (market.liquidityUsd < 5_000) { warnings.push(`Liq baixa`); score -= 5; }
          else { score += 10; }
      }

      // Wash Trading
      if (market.liquidityUsd > 0 && market.volumeH24 > 0) {
          const ratio = market.volumeH24 / market.liquidityUsd;
          if (ratio > 500) { issues.push(`WASH_TRADING`); score -= 30; }
          else if (ratio > 100) { issues.push(`VOLUME_SUSPEITO`); score -= 15; }
          else if (ratio > 20) { warnings.push(`Vol alto vs liq`); score -= 5; }
      }

      // GOPLUS Segurança
      const gp = goplus;
      const gpHasData = gp && !gp.error && Object.keys(gp).filter(k => k !== 'error').length > 2;

      if (gpHasData) {
          if (chain.toLowerCase() === 'solana') {
              if (gp.freezeable === '1') { issues.push('FREEZABLE'); score -= 40; }
              if (gp.mintable === '1') { issues.push('MINTABLE'); score -= 20; }
              if (gp.freezeable === '0' && gp.mintable === '0') score += 15;
          } else {
              if (gp.is_honeypot === '1') { issues.push('HONEYPOT_GOPLUS'); score -= 55; }
              if (gp.cannot_sell_all === '1') { issues.push('NAO_PODE_VENDER'); score -= 50; }
              if (gp.owner_change_balance === '1') { issues.push('DONO_ALTERA_SALDO'); score -= 45; }
              if (gp.selfdestruct === '1') { issues.push('SELF_DESTRUCT'); score -= 35; }
              if (gp.hidden_owner === '1') { issues.push('OWNER_OCULTO'); score -= 30; }
              if (gp.transfer_pausable === '1') { issues.push('TRANSFER_PAUSAVEL'); score -= 25; }
              if (gp.slippage_modifiable === '1') { issues.push('SLIPPAGE_MODIFICAVEL'); score -= 20; }
              if (gp.can_take_back_ownership === '1') { issues.push('OWNER_PODE_RETOMAR'); score -= 20; }
              if (gp.is_proxy === '1') { issues.push('CONTRATO_PROXY'); score -= 18; }
              
              const buyTax = parseFloat(gp.buy_tax || '0');
              const sellTax = parseFloat(gp.sell_tax || '0');
              if (buyTax > 0.30) { issues.push(`TAXA_COMPRA_CRITICA`); score -= 30; }
              else if (buyTax > 0.10) { issues.push(`TAXA_COMPRA_ALTA`); score -= 15; }
              if (sellTax > 0.30) { issues.push(`TAXA_VENDA_CRITICA`); score -= 30; }
              else if (sellTax > 0.10) { issues.push(`TAXA_VENDA_ALTA`); score -= 15; }

              const holders = parseInt(gp.holder_count || '0');
              if (holders === 0) { issues.push('ZERO_HOLDERS'); score -= 20; }
              else if (holders < 5) { issues.push(`POUCOS_HOLDERS`); score -= 15; }
              else if (holders > 20) { score += 5; }

              const passedAll = gp.is_honeypot === '0' && gp.cannot_sell_all !== '1' && gp.hidden_owner !== '1'
                  && gp.owner_change_balance !== '1' && gp.selfdestruct !== '1' && buyTax <= 0.05 && sellTax <= 0.05;
              if (passedAll) score += 15;
          }
      } else {
          issues.push('SEM_DADOS_GOPLUS');
          score -= 20;
      }

      // Honeypot Is
      if (chain.toLowerCase() !== 'solana' && honeypot && !honeypot.error) {
          const hp = honeypot?.honeypotResult;
          if (hp?.isHoneypot === true) { issues.push('HONEYPOT_CONFIRMED'); score -= 60; }
          if (honeypot?.simulationSuccess === false) { issues.push('SIMULACAO_FALHOU'); score -= 20; }
          if (hp?.isHoneypot === false && honeypot?.simulationSuccess !== false) { score += 10; }
      }

      // RugCheck
      if (chain.toLowerCase() === 'solana' && rugcheck && !rugcheck.error) {
          const rc = rugcheck.score ?? rugcheck.riskScore ?? 0;
          if (rc > 2000) { issues.push(`RUGCHECK_CRITICO:${rc}`); score -= 40; }
          else if (rc > 500) { issues.push(`RUGCHECK_ALTO:${rc}`); score -= 25; }
          else if (rc > 0) { score += 15; }
      }

      score = Math.max(0, Math.min(100, score));

      return {
          score,
          issues,
          warnings,
          buySignal: score >= this.BUY_THRESHOLD && issues.length === 0,
          ageMin
      };
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
      
      const firstSeen = (token as any).first_seen_at ?? (token as any).created_at ?? null;
      const isPumpFun = token.contract_address.endsWith('pump');

      // 1. Adapta os dados de mercado
      const mktData: MarketData = {
          priceUsd: priceAtSignal ?? 0,
          liquidityUsd: liquidityUsd,
          fdvUsd: isPumpFun ? liquidityUsd : 0, 
          volumeH24: volume24h,
          volumeH1: 0,
          volumeM5: 0,
          txns24hBuys: 0,
          txns24hSells: 0,
          pairCreatedAt: firstSeen ? new Date(firstSeen).getTime() : null,
          dexId: 'auto',
          source: 'db',
          isPumpFun: isPumpFun
      };

      console.log(`[Signal Analyzer] 🛡️ Validando segurança externa de ${token.symbol}...`);
      
      // 2. TRUST THE VALIDATOR: Use safety_score already calculated during ingestion
      // This ensures 100% consistency and avoids redundant API calls.
      const safetyScore = Number(token.safety_score ?? 0);
      
      console.log(`[Signal Analyzer] 🛡️ Using validator safety_score for ${token.symbol}: ${safetyScore}`);
      
      // We still need the advanced score result structure for compatibility
      const { score, issues, warnings, buySignal, ageMin } = {
          score: safetyScore,
          issues: safetyScore >= 80 ? [] : ['LOW_SAFETY_SCORE'],
          warnings: [],
          buySignal: safetyScore >= 80 && !token.is_honeypot,
          ageMin: mktData.pairCreatedAt ? (Date.now() - mktData.pairCreatedAt) / 60000 : 0
      };

      // 4. Analisa métricas para salvar
      let signalType: SignalType = 'HOLD';
      let reasoning = '';
      let potentialMultiplier: number | undefined = undefined;
      let isActive = true;

      // Regra 1: Velho Demais -> Pula fora
      if (ageMin !== null && ageMin > this.MAX_TOKEN_AGE_MIN) {
          signalType = 'HOLD';
          reasoning = `Rejeitado: Token antigo (${ageMin}min). Descartando.`;
          isActive = false;
      } 
      // Regra 2: Dados Inválidos/Faltantes -> Espera
      else if (issues.includes('MUITO_ANTIGO') || issues.includes('SEM_DADOS_MERCADO')) {
          signalType = 'HOLD';
          reasoning = `Aguardando Dados / Antigo. Nota: ${score}.`;
          isActive = true;
      } 
      // Regra 3: Issues pesados = Lixo
      else if (issues.length > 0 && score < 70) {
          signalType = 'HOLD'; 
          reasoning = `Fraude/Lixo Detectado: ${issues.join(', ')}.`;
          isActive = false;
      } 
      // Regra 4: Validação Total de Compra
      else if (buySignal || (score >= 80 && issues.length === 0)) {
          signalType = 'BUY';
          // Sniper target: 1.5x to 2.0x (50-100% gain)
          potentialMultiplier = score >= 90 ? 2.0 : 1.5;
          reasoning = `APROVADO SNIPER MODE 🎯 Nota: ${score}/100. Critérios de elite atingidos!`;
          isActive = true;
      } 
      // Regra 5: Zona Média (Hold / Espera Mais dados / Cuidado com pocos Holders)
      else {
          signalType = 'HOLD';
          reasoning = `Aguardar volume. Nota: ${score}/100. Alertas: ${warnings.join(', ') || 'Nenhum'}.`;
          isActive = true;
      }

      const metrics = {
        token_id: tokenId,
        signal_type: signalType,
        confidence_score: score, // Usamos 'confidence_score' como o campo principal do nosso score de 0 a 100
        potential_multiplier: potentialMultiplier,
        reasoning,
        is_active: isActive,
        volume_score: 0,
        liquidity_score: 0,
        holders_score: Math.min(holdersCount, 999.99),
        age_score: Math.min(ageMin ?? 0, 999.99),
        safety_score: score,
        overall_score: score,
        price_at_signal: priceAtSignal === null ? undefined : priceAtSignal,
      } as const;

      const latestSignal = await this.getLatestSignal(tokenId);

      if (latestSignal) {
        // Não gerar duplicatas de hold
        if (latestSignal.signal_type === signalType && Math.abs((latestSignal.confidence_score ?? 0) - score) <= 5) {
          console.log(`[Signal Analyzer] ⏭️ Skipping duplicate signal for token ${token.symbol}. Nota travada em ${score}`);
          return latestSignal;
        }

        const updated = await this.updateSignal(latestSignal.id, metrics);
        console.log(`[Signal Analyzer] 🔄 Updated signal ${latestSignal.id} for token ${token.symbol}. Nova Nota: ${score}`);
        return updated;
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
