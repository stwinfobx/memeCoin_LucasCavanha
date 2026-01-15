import { Pool } from 'pg';
import axios from 'axios';

/**
 * Worker para coletar preços a cada 1 minuto
 * Armazena histórico OHLCV para análise técnica
 */

export class PriceCollector {
    private pool: Pool;
    private interval: NodeJS.Timeout | null = null;
    private isRunning = false;

    constructor(pool: Pool) {
        this.pool = pool;
    }

    /**
     * Inicia coleta periódica de preços
     */
    start(intervalMinutes: number = 1): void {
        if (this.isRunning) {
            console.log('[Price Collector] Already running');
            return;
        }

        this.isRunning = true;
        const intervalMs = intervalMinutes * 60 * 1000;

        console.log(`[Price Collector] Starting with ${intervalMinutes}min interval`);

        // Executar imediatamente
        this.collectPrices();

        // Agendar coletas periódicas
        this.interval = setInterval(() => {
            this.collectPrices();
        }, intervalMs);
    }

    /**
     * Para a coleta
     */
    stop(): void {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this.isRunning = false;
        console.log('[Price Collector] Stopped');
    }

    /**
     * Coleta preços de todos os tokens validados
     */
    private async collectPrices(): Promise<void> {
        try {
            console.log('[Price Collector] 📊 Collecting prices...');

            // Buscar tokens validados
            const tokensResult = await this.pool.query(`
        SELECT id, contract_address, chain, symbol, price_usd, volume_24h_usd
        FROM tokens
        WHERE is_validated = true
        ORDER BY volume_24h_usd DESC
        LIMIT 100
      `);

            const tokens = tokensResult.rows;
            console.log(`[Price Collector] Found ${tokens.length} validated tokens`);

            let collected = 0;
            let failed = 0;

            for (const token of tokens) {
                try {
                    await this.collectTokenPrice(token);
                    collected++;
                } catch (error: any) {
                    failed++;
                    console.error(`[Price Collector] Failed for ${token.symbol}:`, error.message);
                }
            }

            console.log(`[Price Collector] ✅ Collected ${collected} prices, ${failed} failed`);
        } catch (error: any) {
            console.error('[Price Collector] Error:', error.message);
        }
    }

    /**
     * Coleta preço de um token específico
     */
    private async collectTokenPrice(token: any): Promise<void> {
        const { id, contract_address, chain, symbol, price_usd, volume_24h_usd } = token;

        // Usar preço atual do banco (já atualizado pelo validator)
        const currentPrice = Number(price_usd || 0);
        const currentVolume = Number(volume_24h_usd || 0);

        if (currentPrice <= 0) {
            return; // Sem preço válido
        }

        // Para simplicidade, vamos usar o preço atual como OHLC
        // Em produção, buscaria dados reais de exchange
        const candle = {
            open: currentPrice * 0.995, // Simular variação de 0.5%
            high: currentPrice * 1.002,
            low: currentPrice * 0.998,
            close: currentPrice,
            volume: currentVolume,
        };

        // Inserir candle de 1 minuto
        await this.insertCandle(id, '1m', candle);

        // A cada 5 minutos, inserir candle de 5m
        const now = new Date();
        if (now.getMinutes() % 5 === 0) {
            await this.insertCandle(id, '5m', candle);
        }

        // A cada 15 minutos, inserir candle de 15m
        if (now.getMinutes() % 15 === 0) {
            await this.insertCandle(id, '15m', candle);
        }

        // A cada hora, inserir candle de 1h
        if (now.getMinutes() === 0) {
            await this.insertCandle(id, '1h', candle);
        }
    }

    /**
     * Insere candle no banco
     */
    private async insertCandle(
        tokenId: string,
        interval: string,
        candle: {
            open: number;
            high: number;
            low: number;
            close: number;
            volume: number;
        }
    ): Promise<void> {
        const timestamp = new Date();
        timestamp.setSeconds(0, 0); // Arredondar para minuto exato

        await this.pool.query(
            `INSERT INTO price_candles (
        token_id, interval, timestamp, open_price, high_price, low_price, close_price, volume_usd
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (token_id, interval, timestamp) DO UPDATE SET
        high_price = GREATEST(price_candles.high_price, $5),
        low_price = LEAST(price_candles.low_price, $6),
        close_price = $7,
        volume_usd = $8`,
            [
                tokenId,
                interval,
                timestamp,
                candle.open,
                candle.high,
                candle.low,
                candle.close,
                candle.volume,
            ]
        );
    }

    /**
     * Obtém candles recentes de um token
     */
    async getRecentCandles(
        tokenId: string,
        interval: string = '1m',
        limit: number = 100
    ): Promise<any[]> {
        const result = await this.pool.query(
            `SELECT *
       FROM price_candles
       WHERE token_id = $1 AND interval = $2
       ORDER BY timestamp DESC
       LIMIT $3`,
            [tokenId, interval, limit]
        );

        return result.rows;
    }

    /**
     * Limpa candles antigos (manutenção)
     */
    async cleanupOldCandles(daysToKeep: number = 30): Promise<number> {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

        const result = await this.pool.query(
            `DELETE FROM price_candles
       WHERE timestamp < $1`,
            [cutoffDate]
        );

        const deleted = result.rowCount || 0;
        console.log(`[Price Collector] Cleaned up ${deleted} old candles`);
        return deleted;
    }
}
