import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import axios from 'axios';
import { Pool } from 'pg';

const SOLSCAN_API_URL = 'https://api.solscan.io';
const SOLANA_RPC = process.env.SOLANA_RPC_URL || clusterApiUrl('mainnet-beta');

export interface SolanaTokenInfo {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    supply: string;
    price?: number;
    volume24h?: number;
    holders?: number;
}

export class SolanaValidator {
    private connection: Connection;
    private pool: Pool;
    private solscanApiKey?: string;

    constructor(pool: Pool) {
        this.pool = pool;
        this.connection = new Connection(SOLANA_RPC, 'confirmed');
        this.solscanApiKey = process.env.SOLSCAN_API_KEY;
    }

    /**
     * Valida um token SPL na Solana
     */
    async validateToken(tokenAddress: string): Promise<{
        isValid: boolean;
        tokenInfo?: SolanaTokenInfo;
        error?: string;
    }> {
        try {
            console.log(`[Solana Validator] Validating token: ${tokenAddress}`);

            // Verificar se é um endereço válido
            let pubkey: PublicKey;
            try {
                pubkey = new PublicKey(tokenAddress);
            } catch {
                return { isValid: false, error: 'Invalid Solana address' };
            }

            // Buscar informações do token via Solscan API
            const tokenInfo = await this.getTokenInfo(tokenAddress);

            if (!tokenInfo) {
                return { isValid: false, error: 'Token not found on Solscan' };
            }

            // Validações básicas
            if (!tokenInfo.symbol || !tokenInfo.name) {
                return { isValid: false, error: 'Token missing basic info' };
            }

            // Verificar se tem holders mínimos (anti-scam)
            if (tokenInfo.holders && tokenInfo.holders < 10) {
                return { isValid: false, error: 'Insufficient holders (minimum 10)' };
            }

            console.log(`[Solana Validator] ✅ Token validated: ${tokenInfo.symbol}`);
            return { isValid: true, tokenInfo };
        } catch (error: any) {
            console.error('[Solana Validator] Validation error:', error.message);
            return { isValid: false, error: error.message };
        }
    }

    /**
     * Obtém informações do token via Solscan API
     */
    private async getTokenInfo(tokenAddress: string): Promise<SolanaTokenInfo | null> {
        try {
            const headers: any = {};
            if (this.solscanApiKey) {
                headers['token'] = this.solscanApiKey;
            }

            // Buscar metadados do token
            const metaResponse = await axios.get(
                `${SOLSCAN_API_URL}/token/meta`,
                {
                    params: { token: tokenAddress },
                    headers,
                    timeout: 10000,
                }
            );

            if (!metaResponse.data || metaResponse.data.error) {
                return null;
            }

            const meta = metaResponse.data;

            // Buscar holders count
            let holdersCount = 0;
            try {
                const holdersResponse = await axios.get(
                    `${SOLSCAN_API_URL}/token/holders`,
                    {
                        params: { token: tokenAddress, offset: 0, limit: 1 },
                        headers,
                        timeout: 5000,
                    }
                );
                holdersCount = holdersResponse.data?.total || 0;
            } catch {
                // Ignorar erro de holders
            }

            // Buscar preço e volume (se disponível)
            let price = 0;
            let volume24h = 0;
            try {
                const marketResponse = await axios.get(
                    `${SOLSCAN_API_URL}/market/token/${tokenAddress}`,
                    { headers, timeout: 5000 }
                );
                price = marketResponse.data?.priceUsdt || 0;
                volume24h = marketResponse.data?.volume24h || 0;
            } catch {
                // Ignorar erro de market data
            }

            return {
                address: tokenAddress,
                symbol: meta.symbol || 'UNKNOWN',
                name: meta.name || 'Unknown Token',
                decimals: meta.decimals || 9,
                supply: meta.supply || '0',
                price,
                volume24h,
                holders: holdersCount,
            };
        } catch (error: any) {
            console.error('[Solana Validator] Failed to get token info:', error.message);
            return null;
        }
    }

    /**
     * Calcula risk score para token Solana
     */
    async calculateRiskScore(tokenInfo: SolanaTokenInfo): Promise<{
        memecoinScore: number;
        riskScore: number;
        scamProbability: number;
        riskLevel: 'critical' | 'high' | 'moderate' | 'low';
    }> {
        let riskScore = 0;
        let scamProbability = 100;
        let memecoinScore = 0;

        // Holders score (0-25 pontos)
        const holders = tokenInfo.holders || 0;
        if (holders > 10000) riskScore += 25;
        else if (holders > 5000) riskScore += 20;
        else if (holders > 1000) riskScore += 15;
        else if (holders > 100) riskScore += 10;
        else riskScore += 5;

        // Volume score (0-25 pontos)
        const volume = tokenInfo.volume24h || 0;
        if (volume > 100000) riskScore += 25;
        else if (volume > 50000) riskScore += 20;
        else if (volume > 10000) riskScore += 15;
        else if (volume > 1000) riskScore += 10;
        else riskScore += 5;

        // Price existence (0-20 pontos)
        if (tokenInfo.price && tokenInfo.price > 0) {
            riskScore += 20;
        }

        // Supply verification (0-15 pontos)
        const supply = BigInt(tokenInfo.supply || '0');
        if (supply > BigInt(0) && supply < BigInt('1000000000000000000')) {
            riskScore += 15;
        }

        // Metadata completeness (0-15 pontos)
        if (tokenInfo.symbol && tokenInfo.name) {
            riskScore += 15;
        }

        // Scam probability (inverso do risk score)
        scamProbability = Math.max(0, 100 - riskScore);

        // Memecoin detection
        const isHighVolume = volume > 50000;
        const isManyHolders = holders > 1000;
        const hasGoodLiquidity = tokenInfo.price && tokenInfo.price > 0;

        if (isHighVolume && isManyHolders && hasGoodLiquidity) {
            memecoinScore = 80;
        } else if (isHighVolume || isManyHolders) {
            memecoinScore = 60;
        } else {
            memecoinScore = 30;
        }

        // Risk level
        let riskLevel: 'critical' | 'high' | 'moderate' | 'low';
        if (riskScore >= 70) riskLevel = 'low';
        else if (riskScore >= 50) riskLevel = 'moderate';
        else if (riskScore >= 30) riskLevel = 'high';
        else riskLevel = 'critical';

        return {
            memecoinScore,
            riskScore,
            scamProbability,
            riskLevel,
        };
    }

    /**
     * Salva token validado no banco
     */
    async saveValidatedToken(
        tokenInfo: SolanaTokenInfo,
        riskAssessment: {
            memecoinScore: number;
            riskScore: number;
            scamProbability: number;
            riskLevel: string;
        }
    ): Promise<string> {
        // Inserir ou atualizar token
        const tokenResult = await this.pool.query(
            `INSERT INTO tokens (
        contract_address, chain, symbol, name, decimals, total_supply,
        price_usd, volume_24h_usd, holders_count, is_validated, validated_at, is_honeypot
      ) VALUES ($1, 'SOL', $2, $3, $4, $5, $6, $7, $8, true, CURRENT_TIMESTAMP, false)
      ON CONFLICT (contract_address, chain)
      DO UPDATE SET
        symbol = $2,
        name = $3,
        decimals = $4,
        price_usd = $6,
        volume_24h_usd = $7,
        holders_count = $8,
        is_validated = true,
        validated_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id`,
            [
                tokenInfo.address,
                tokenInfo.symbol,
                tokenInfo.name,
                tokenInfo.decimals,
                tokenInfo.supply,
                tokenInfo.price || 0,
                tokenInfo.volume24h || 0,
                tokenInfo.holders || 0,
            ]
        );

        const tokenId = tokenResult.rows[0].id;

        // Inserir ou atualizar risk assessment
        await this.pool.query(
            `INSERT INTO token_risk_assessments (
        token_id, contract_address, chain, memecoin_score, risk_score, scam_probability, risk_level, indicators
      ) VALUES ($1, $2, 'SOL', $3, $4, $5, $6, $7::jsonb)
      ON CONFLICT (token_id)
      DO UPDATE SET
        memecoin_score = $3,
        risk_score = $4,
        scam_probability = $5,
        risk_level = $6,
        indicators = $7::jsonb,
        updated_at = CURRENT_TIMESTAMP`,
            [
                tokenId,
                tokenInfo.address,
                riskAssessment.memecoinScore,
                riskAssessment.riskScore,
                riskAssessment.scamProbability,
                riskAssessment.riskLevel,
                JSON.stringify({
                    holders: tokenInfo.holders,
                    volume24h: tokenInfo.volume24h,
                    price: tokenInfo.price,
                }),
            ]
        );

        console.log(`[Solana Validator] ✅ Token saved: ${tokenInfo.symbol} (${tokenId})`);
        return tokenId;
    }
}
