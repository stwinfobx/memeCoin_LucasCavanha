import { Pool } from 'pg';
import { Signal, UserProfile } from '@shared/types';

/**
 * Trading Strategies - Gerencia estratégias de trading
 */

export type TradingStrategy = 'scoring_based' | 'auto_buy_verified';

export interface StrategyConfig {
    strategy: TradingStrategy;
    minConfidence?: number;
    minMemecoinScore?: number;
    maxRiskScore?: number;
}

export class TradingStrategyManager {
    private pool: Pool;

    constructor(pool: Pool) {
        this.pool = pool;
    }

    /**
     * Determina se deve executar compra baseado na estratégia do usuário
     */
    async shouldBuy(
        userId: string,
        signal: Signal,
        tokenValidation: {
            memecoinScore: number;
            riskScore: number;
            scamProbability: number;
        }
    ): Promise<{ shouldBuy: boolean; reason: string }> {
        // Buscar estratégia do usuário
        const profileResult = await this.pool.query(
            'SELECT trading_strategy FROM user_profiles WHERE user_id = $1',
            [userId]
        );

        const strategy: TradingStrategy =
            profileResult.rows[0]?.trading_strategy || 'scoring_based';

        if (strategy === 'auto_buy_verified') {
            return this.aggressiveStrategy(signal, tokenValidation);
        } else {
            return this.scoringBasedStrategy(signal, tokenValidation);
        }
    }

    /**
     * Estratégia padrão: baseada em scoring
     */
    private scoringBasedStrategy(
        signal: Signal,
        validation: { memecoinScore: number; riskScore: number; scamProbability: number }
    ): { shouldBuy: boolean; reason: string } {
        // Verificações básicas
        if (signal.signal_type !== 'BUY') {
            return { shouldBuy: false, reason: 'Sinal não é BUY' };
        }

        // Threshold de confiança
        const minConfidence = 50; // 50%
        if ((signal.confidence_score ?? 0) < minConfidence) {
            return {
                shouldBuy: false,
                reason: `Confiança muito baixa (${signal.confidence_score}% < ${minConfidence}%)`,
            };
        }

        // Risk score mínimo
        const minRiskScore = 30; // 30 pontos
        if (validation.riskScore < minRiskScore) {
            return {
                shouldBuy: false,
                reason: `Risk score muito baixo (${validation.riskScore} < ${minRiskScore})`,
            };
        }

        // Scam probability máxima
        const maxScamProb = 70; // 70%
        if (validation.scamProbability > maxScamProb) {
            return {
                shouldBuy: false,
                reason: `Probabilidade de scam muito alta (${validation.scamProbability}% > ${maxScamProb}%)`,
            };
        }

        return {
            shouldBuy: true,
            reason: `Sinal BUY aprovado - Confiança: ${signal.confidence_score ?? 0}%, Risk: ${validation.riskScore}, Scam: ${validation.scamProbability}%`,
        };
    }

    /**
     * Estratégia agressiva: compra TODOS os tokens validados
     * Solicitação do cliente: "auto-buy all verified memecoins"
     */
    private aggressiveStrategy(
        signal: Signal,
        validation: { memecoinScore: number; riskScore: number; scamProbability: number }
    ): { shouldBuy: boolean; reason: string } {
        // Verificações mínimas de segurança
        const MIN_RISK_SCORE = 20; // Mínimo absoluto
        const MAX_SCAM_PROB = 90; // Máximo absoluto

        if (validation.riskScore < MIN_RISK_SCORE) {
            return {
                shouldBuy: false,
                reason: `⚠️ BLOQUEIO DE SEGURANÇA: Risk score crítico (${validation.riskScore} < ${MIN_RISK_SCORE})`,
            };
        }

        if (validation.scamProbability > MAX_SCAM_PROB) {
            return {
                shouldBuy: false,
                reason: `⚠️ BLOQUEIO DE SEGURANÇA: Scam probability crítica (${validation.scamProbability}% > ${MAX_SCAM_PROB}%)`,
            };
        }

        // MODO AGRESSIVO: Comprar qualquer token validado!
        return {
            shouldBuy: true,
            reason: `🔥 MODO AGRESSIVO: Comprando token validado - Memecoin: ${validation.memecoinScore}, Risk: ${validation.riskScore}`,
        };
    }

    /**
     * Atualiza estratégia do usuário
     */
    async updateStrategy(userId: string, strategy: TradingStrategy): Promise<void> {
        await this.pool.query(
            `UPDATE user_profiles 
       SET trading_strategy = $1, 
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2`,
            [strategy, userId]
        );

        console.log(`[Strategy] Updated user ${userId} to ${strategy}`);
    }

    /**
     * Obtém configuração de estratégia
     */
    async getStrategyConfig(userId: string): Promise<StrategyConfig> {
        const result = await this.pool.query(
            'SELECT trading_strategy FROM user_profiles WHERE user_id = $1',
            [userId]
        );

        const strategy: TradingStrategy = result.rows[0]?.trading_strategy || 'scoring_based';

        // Configurações padrão por estratégia
        if (strategy === 'auto_buy_verified') {
            return {
                strategy,
                minConfidence: 0, // Sem mínimo
                minMemecoinScore: 0,
                maxRiskScore: 20, // Bloqueio de segurança
            };
        } else {
            return {
                strategy,
                minConfidence: 50,
                minMemecoinScore: 30,
                maxRiskScore: 30,
            };
        }
    }
}
