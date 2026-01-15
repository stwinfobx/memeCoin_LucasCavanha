/**
 * Cálculo de RSI (Relative Strength Index)
 * Indicador de momentum que mede força de tendência
 */

export interface RSIResult {
    rsi: number;
    signal: 'OVERBOUGHT' | 'OVERSOLD' | 'NEUTRAL';
    confidence: number;
}

/**
 * Calcula RSI para uma série de preços
 * @param prices Array de preços (mais recente primeiro)
 * @param period Período do RSI (padrão: 14)
 */
export function calculateRSI(prices: number[], period: number = 14): RSIResult {
    if (prices.length < period + 1) {
        return { rsi: 50, signal: 'NEUTRAL', confidence: 0 };
    }

    // Inverter array para processar do mais antigo para o mais recente
    const reversedPrices = [...prices].reverse();

    // Calcular mudanças de preço
    const changes: number[] = [];
    for (let i = 1; i < reversedPrices.length; i++) {
        changes.push(reversedPrices[i] - reversedPrices[i - 1]);
    }

    // Separar ganhos e perdas
    let avgGain = 0;
    let avgLoss = 0;

    // Primeira média (SMA)
    for (let i = 0; i < period; i++) {
        if (changes[i] > 0) {
            avgGain += changes[i];
        } else {
            avgLoss += Math.abs(changes[i]);
        }
    }

    avgGain /= period;
    avgLoss /= period;

    // EMA para períodos subsequentes
    for (let i = period; i < changes.length; i++) {
        const gain = changes[i] > 0 ? changes[i] : 0;
        const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;

        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    // Calcular RSI
    let rsi: number;
    if (avgLoss === 0) {
        rsi = 100;
    } else {
        const rs = avgGain / avgLoss;
        rsi = 100 - 100 / (1 + rs);
    }

    // Determinar sinal
    let signal: 'OVERBOUGHT' | 'OVERSOLD' | 'NEUTRAL';
    let confidence: number;

    if (rsi >= 70) {
        signal = 'OVERBOUGHT';
        confidence = Math.min(100, (rsi - 70) * 3.33); // 0-100%
    } else if (rsi <= 30) {
        signal = 'OVERSOLD';
        confidence = Math.min(100, (30 - rsi) * 3.33);
    } else {
        signal = 'NEUTRAL';
        confidence = Math.max(0, 100 - Math.abs(rsi - 50) * 2.5);
    }

    return {
        rsi: Number(rsi.toFixed(2)),
        signal,
        confidence: Number(confidence.toFixed(2)),
    };
}

/**
 * Interpreta RSI para decisão de trading
 */
export function interpretRSI(rsi: number): {
    action: 'STRONG_SELL' | 'SELL' | 'HOLD' | 'BUY' | 'STRONG_BUY';
    reason: string;
} {
    if (rsi > 80) {
        return {
            action: 'STRONG_SELL',
            reason: `RSI extremamente sobrecomprado (${rsi.toFixed(1)}) - forte indicação de reversão`,
        };
    } else if (rsi > 70) {
        return {
            action: 'SELL',
            reason: `RSI sobrecomprado (${rsi.toFixed(1)}) - considerar realizar lucros`,
        };
    } else if (rsi < 20) {
        return {
            action: 'STRONG_BUY',
            reason: `RSI extremamente sobrevendido (${rsi.toFixed(1)}) - forte oportunidade de compra`,
        };
    } else if (rsi < 30) {
        return {
            action: 'BUY',
            reason: `RSI sobrevendido (${rsi.toFixed(1)}) - possível oportunidade de compra`,
        };
    } else {
        return {
            action: 'HOLD',
            reason: `RSI neutro (${rsi.toFixed(1)}) - manter posição`,
        };
    }
}
