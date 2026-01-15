/**
 * Detecção de Picos de Preço (Peak Detection)
 * Identifica topos e fundos locais para otimizar vendas
 */

export interface PeakDetectionResult {
    isPeak: boolean;
    isTrough: boolean;
    confidence: number;
    priceChange24h: number;
    volumeTrend: 'INCREASING' | 'DECREASING' | 'STABLE';
    momentum: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    shouldSell: boolean;
    reason: string;
}

/**
 * Detecta picos de preço usando análise de múltiplos fatores
 * @param prices Array de preços (mais recente primeiro) - mínimo 20
 * @param volumes Array de volumes correspondentes
 */
export function detectPeak(
    prices: number[],
    volumes: number[]
): PeakDetectionResult {
    if (prices.length < 10 || volumes.length < 10) {
        return {
            isPeak: false,
            isTrough: false,
            confidence: 0,
            priceChange24h: 0,
            volumeTrend: 'STABLE',
            momentum: 'NEUTRAL',
            shouldSell: false,
            reason: 'Dados insuficientes para análise',
        };
    }

    const currentPrice = prices[0];
    const recentPrices = prices.slice(0, 10); // Últimos 10 períodos
    const olderPrices = prices.slice(10, 20); // 10-20 períodos atrás

    // 1. Análise de Pico (preço atingiu máximo local)
    const maxRecentPrice = Math.max(...recentPrices);
    const isNearPeak = currentPrice >= maxRecentPrice * 0.95; // 95% do máximo

    // 2. Análise de Volume (divergência bearish)
    const recentVolume = volumes.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
    const pastVolume = volumes.slice(3, 6).reduce((a, b) => a + b, 0) / 3;
    const volumeDecreasing = recentVolume < pastVolume * 0.8; // Volume 20% menor

    let volumeTrend: 'INCREASING' | 'DECREASING' | 'STABLE';
    if (recentVolume > pastVolume * 1.2) volumeTrend = 'INCREASING';
    else if (recentVolume < pastVolume * 0.8) volumeTrend = 'DECREASING';
    else volumeTrend = 'STABLE';

    // 3. Análise de Momentum (desaceleração)
    const recentChange = Math.abs((prices[0] - prices[1]) / prices[1]);
    const pastChange = Math.abs((prices[2] - prices[3]) / prices[3]);
    const isConsolidating = recentChange < pastChange * 0.5; // Movimento 50% menor

    // 4. Análise de Tendência
    const avgRecent = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
    const avgOlder = olderPrices.reduce((a, b) => a + b, 0) / olderPrices.length;
    const trendUp = avgRecent > avgOlder * 1.05;
    const trendDown = avgRecent < avgOlder * 0.95;

    let momentum: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    if (trendUp && !isConsolidating) momentum = 'BULLISH';
    else if (trendDown || isConsolidating) momentum = 'BEARISH';
    else momentum = 'NEUTRAL';

    // 5. Mudança de 24h
    const price24hAgo = prices[Math.min(24, prices.length - 1)];
    const priceChange24h = ((currentPrice - price24hAgo) / price24hAgo) * 100;

    // 6. Detectar Pico (múltiplos sinais confluentes)
    let peakSignals = 0;
    if (isNearPeak) peakSignals++;
    if (volumeDecreasing) peakSignals++;
    if (isConsolidating) peakSignals++;

    const isPeak = peakSignals >= 2; // Mínimo 2 de 3 sinais

    // 7. Detectar Fundo (oversold reversal)
    const minRecentPrice = Math.min(...recentPrices);
    const isNearTrough = currentPrice <= minRecentPrice * 1.05;
    const volumeIncreasingFromTrough = recentVolume > pastVolume * 1.2;
    const isTrough = isNearTrough && volumeIncreasingFromTrough;

    // 8. Calcular confiança
    let confidence = 0;
    if (isNearPeak) confidence += 35;
    if (volumeDecreasing) confidence += 30;
    if (isConsolidating) confidence += 25;
    if (priceChange24h > 50) confidence += 10; // Pump muito forte

    // 9. Decisão de venda
    let shouldSell = false;
    let reason = '';

    if (isPeak && confidence >= 60) {
        shouldSell = true;
        reason = `PICO DETECTADO (${confidence}%): Preço em máximo local com volume decrescente e momentum fraco`;
    } else if (priceChange24h > 100 && volumeDecreasing) {
        shouldSell = true;
        reason = `PUMP EXTREMO: +${priceChange24h.toFixed(1)}% em 24h com volume decrescente - realizar lucros`;
    } else if (isNearPeak && momentum === 'BEARISH') {
        shouldSell = false; // Considerar venda mas não forçar
        reason = `Pico possível (${confidence}%) mas aguardar confirmação`;
    } else {
        reason = `Sem sinal de pico - continuar holding (confiança: ${confidence}%)`;
    }

    return {
        isPeak,
        isTrough,
        confidence: Number(confidence.toFixed(2)),
        priceChange24h: Number(priceChange24h.toFixed(2)),
        volumeTrend,
        momentum,
        shouldSell,
        reason,
    };
}

/**
 * Análise simplificada para decisão rápida
 */
export function quickPeakCheck(
    currentPrice: number,
    prices: number[],
    volumes: number[]
): boolean {
    if (prices.length < 5) return false;

    const maxPrice = Math.max(...prices.slice(0, 10));
    const isAtPeak = currentPrice >= maxPrice * 0.98;

    const avgRecentVol = volumes.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
    const avgPastVol = volumes.slice(3, 6).reduce((a, b) => a + b, 0) / 3;
    const volumeDeclining = avgRecentVol < avgPastVol * 0.7;

    return isAtPeak && volumeDeclining;
}
