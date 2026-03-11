import './env';
import { } from 'ethers';
import axios from 'axios';
import { Pool } from 'pg';
import { Token, TokenRiskAssessment, TokenValidationResponse } from '@shared/types';
import { ExplorerClient } from './providers/explorer';
import { computeRiskAssessment, MarketPairData } from './risk-scoring';
import { FreeSecurityProviders } from './providers/FreeSecurityProviders';
import {
  ChainProvider,
  SupportedChain,
  createChainProvider,
  normalizeChainName,
  getEnabledChains
} from './chains';



const GECKO_API_URL = process.env.GECKOTERMINAL_BASE_URL || 'https://api.geckoterminal.com/api/v2';
const GECKO_HEADERS = {
  'User-Agent': 'TradingBotValidator/1.0 (+https://github.com/tradingbot)',
  Accept: 'application/json',
  Origin: 'https://geckoterminal.com',
  Referer: 'https://geckoterminal.com/',
  'X-Requested-With': 'XMLHttpRequest',
};

function parseNumber(value: string | number | undefined | null): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}



interface ExternalPoolListing {
  poolId?: string;
  pairAddress?: string;
  chainId?: string;
  baseToken?: {
    address?: string;
    symbol?: string;
    name?: string;
  };
  quoteToken?: {
    address?: string;
    symbol?: string;
    name?: string;
  };
  liquidityUsd?: number;
  volume24hUsd?: number;
  fdvUsd?: number;
  priceUsd?: number;
  dexId?: string;
}

export interface ValidationContext {
  pairAddress?: string;
  source?: string;
  rawListing?: ExternalPoolListing | null;
}

export class TokenValidator {
  private providers: Map<SupportedChain, ChainProvider>;
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
    this.providers = new Map();
    this.initializeProviders();
  }

  private initializeProviders() {
    const enabledChains = getEnabledChains();

    console.log(`[Validator] Initializing providers for ${enabledChains.length} chains: ${enabledChains.join(', ')}`);

    for (const chain of enabledChains) {
      try {
        const provider = createChainProvider(chain);
        this.providers.set(chain, provider);
        console.log(`[Validator] ✓ ${chain} provider initialized`);
      } catch (error: any) {
        console.error(`[Validator] ✗ Failed to initialize ${chain} provider:`, error.message);
      }
    }
  }

  private getProvider(chain?: string): ChainProvider | null {
    const normalized = normalizeChainName(chain);
    if (!normalized) {
      console.warn(`[Validator] Unknown chain: ${chain}`);
      return null;
    }
    return this.providers.get(normalized) ?? null;
  }

  /**
   * Valida um token e retorna informações completas
   */
  async validateToken(
    contractAddress: string,
    chain: string = 'BSC',
    context?: ValidationContext
  ): Promise<TokenValidationResponse> {
    const issues: string[] = [];
    let safetyScore = 0;
    const normalizedChain = normalizeChainName(chain) || SupportedChain.BSC;
    const provider = this.getProvider(chain);

    if (!provider) {
      const reason = `Unsupported chain or missing RPC for ${chain}`;
      console.warn(reason);
      return {
        token: {} as Token,
        validation_result: {
          is_valid: false,
          safety_score: 0,
          is_honeypot: true,
          liquidity_locked: false,
          issues: [reason],
        },
      };
    }

    try {
      // Usar ChainProvider ao invés de ethers diretamente
      const tokenInfo = await provider.getTokenInfo(contractAddress);
      const { symbol, name, decimals, totalSupply } = tokenInfo;

      // --- SECURITY CONSENSUS (GoPlus + Honeypot.is + RugCheck via FreeSecurityProviders) ---
      let isHoneypot = false;
      try {
        let consensus;
        if (normalizedChain === SupportedChain.SOLANA) {
          consensus = await FreeSecurityProviders.checkSolana(contractAddress);
        } else {
          const chainNum = normalizedChain === SupportedChain.BASE ? '8453' : '56';
          consensus = await FreeSecurityProviders.checkEVM(contractAddress, chainNum as '56' | '8453');
        }

        isHoneypot = consensus.isHoneypot;
        issues.push(...consensus.issues);

        if (consensus.verdict === 'danger') {
          safetyScore -= 60;
          console.log(`[Validator] 🔴 DANGER consensus for ${contractAddress}: ${consensus.issues.join(', ')}`);
        } else if (consensus.verdict === 'warning') {
          safetyScore -= 15;
          console.log(`[Validator] ⚠️ WARNING consensus for ${contractAddress}: ${consensus.issues.join(', ')}`);
        } else if (consensus.verdict === 'safe') {
          safetyScore += 25; // Clean token bonus
          console.log(`[Validator] 🟢 SAFE consensus for ${contractAddress} (sources: ${Object.entries(consensus.sources)
              .filter(([, v]) => v?.checked)
              .map(([k]) => k).join(', ')
            })`);
        }

      } catch (e) {
        console.warn(`[Validator] Security consensus failed, falling back to provider check: ${e}`);
        isHoneypot = await provider.checkHoneypot(contractAddress);
        if (isHoneypot) {
          issues.push('Token is a honeypot (Provider Check)');
          safetyScore -= 50;
        }
      }

      const marketData = await provider.getMarketData(contractAddress, context);

      // liquidityLocked: checkLiquidityLocked retorna false sempre (não implementado)
      // Não penalizamos por isso para não distorcer os scores
      const liquidityLocked = await provider.checkLiquidityLocked(contractAddress);
      if (liquidityLocked) {
        safetyScore += 20; // Bônus apenas se realmente confirmado
      }

      const holdersCount = marketData.holdersCount || 0;
      // Só penalizar holders se TEMOS a informação e é baixa
      if (holdersCount > 0 && holdersCount < 10) {
        issues.push('Low number of holders');
        safetyScore -= 10;
      } else if (holdersCount > 100) {
        safetyScore += 15;
      }

      const volume24h = marketData.volume24h || 0;
      // Token novo: não penalizar por volume zero (ainda não foi indexado)
      if (volume24h > 0 && volume24h < 1000) {
        issues.push('Low 24h volume');
        safetyScore -= 10;
      } else if (volume24h > 10_000) {
        safetyScore += 15;
      }

      const liquidity = marketData.liquidity || 0;
      // Token novo: não penalizar por liquidez zero (ainda não foi indexado)
      if (liquidity > 0 && liquidity < 5_000) {
        issues.push('Low liquidity');
        safetyScore -= 15;
      } else if (liquidity > 50_000) {
        safetyScore += 20;
      }

      safetyScore = Math.max(0, Math.min(100, 50 + safetyScore));

      const token = await this.saveToken({
        contract_address: provider.normalizeAddress(contractAddress),
        chain: normalizedChain,
        symbol: String(symbol),
        name: String(name),
        decimals: Number(decimals),
        total_supply: BigInt(totalSupply || '0'),
        liquidity_usd: liquidity,
        liquidity_locked: liquidityLocked,
        holders_count: holdersCount,
        volume_24h_usd: volume24h,
        price_usd: marketData.price || undefined,
        safety_score: safetyScore,
        is_honeypot: isHoneypot,
        is_validated: true,
        validated_at: new Date(),
      });

      const rawPair = context?.rawListing || null;

      const resolveNumeric = (value: any): number => {
        if (typeof value === 'number') return value;
        if (typeof value === 'string') {
          const parsed = parseFloat(value);
          return Number.isFinite(parsed) ? parsed : 0;
        }
        if (value && typeof value === 'object' && 'usd' in value) {
          return resolveNumeric(value.usd);
        }
        return 0;
      };

      const explorerClient = new ExplorerClient(normalizedChain);
      const [contractCreation, holderList] = await Promise.all([
        explorerClient.getContractCreation(contractAddress),
        explorerClient.getTokenHolderConcentration(contractAddress, 10),
      ]);

      const marketSummary: MarketPairData = {
        pairAddress: context?.pairAddress || rawPair?.pairAddress,
        dexId: rawPair?.poolId, // GeckoTerminal uses poolId for pairId
        liquidityUsd: marketData.liquidity,
        fdvUsd: resolveNumeric(rawPair?.fdvUsd),
        volume24hUsd: marketData.volume24h,
        priceUsd: marketData.price,
        txCount5m: 0, // GeckoTerminal doesn't provide 5m tx count
        txCount1h: 0, // GeckoTerminal doesn't provide 1h tx count
        txCount6h: 0, // GeckoTerminal doesn't provide 6h tx count
        priceChange5m: resolveNumeric(rawPair?.priceUsd), // Price change is not directly available from GeckoTerminal
        priceChange1h: resolveNumeric(rawPair?.priceUsd), // Price change is not directly available from GeckoTerminal
        priceChange6h: resolveNumeric(rawPair?.priceUsd), // Price change is not directly available from GeckoTerminal
        pairCreatedAt: rawPair?.priceUsd ? Date.now() - 24 * 60 * 60 * 1000 : undefined, // Estimate if not available
        baseTokenSymbol: rawPair?.baseToken?.symbol || symbol,
        baseTokenName: rawPair?.baseToken?.name || name,
      };

      const riskAssessment = computeRiskAssessment({
        token,
        market: marketSummary,
        isHoneypot,
        liquidityLocked,
        holdersCount,
        contractCreation,
        topHolders: holderList,
      });

      const persistedRisk = await this.saveRiskAssessment(token, riskAssessment);

      await this.triggerSignalGeneration(token.id);

      return {
        token,
        validation_result: {
          is_valid: safetyScore >= 50 && !isHoneypot && liquidityLocked,
          safety_score: safetyScore,
          is_honeypot: isHoneypot,
          liquidity_locked: liquidityLocked,
          issues,
        },
        risk_assessment: persistedRisk,
      };
    } catch (error: any) {
      console.error('Validation error:', error);
      issues.push(`Validation failed: ${error.message}`);

      return {
        token: {} as Token,
        validation_result: {
          is_valid: false,
          safety_score: 0,
          is_honeypot: true,
          liquidity_locked: false,
          issues,
        },
      };
    }
  }



  /**
   * DEPRECATED METHODS - Kept for compatibility but no longer used
   * Now using ChainProvider methods directly
   */
  private async checkHoneypot(contractAddress: string, provider: any): Promise<boolean> {
    return false;
  }

  private async checkLiquidityLocked(contractAddress: string, chain: SupportedChain): Promise<boolean> {
    return false;
  }

  private async getMarketData(
    contractAddress: string,
    chain: SupportedChain,
    context?: ValidationContext
  ): Promise<{
    liquidity: number;
    volume24h: number;
    price: number;
    holdersCount: number;
    rawPair?: ExternalPoolListing | null;
  }> {
    // Fallback implementation - should not be called
    return { liquidity: 0, volume24h: 0, price: 0, holdersCount: 0, rawPair: null };
  }


  /**
   * Salva ou atualiza token no banco de dados
   */
  private async saveToken(tokenData: Partial<Token>): Promise<Token> {
    const chainValue = (tokenData.chain || 'BSC').toUpperCase();
    const result = await this.pool.query(
      `INSERT INTO tokens (
        contract_address, chain, symbol, name, decimals, total_supply,
        liquidity_usd, liquidity_locked, holders_count, volume_24h_usd,
        price_usd, safety_score, is_honeypot, is_validated, validated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (contract_address) 
      DO UPDATE SET
        chain = EXCLUDED.chain,
        symbol = EXCLUDED.symbol,
        name = EXCLUDED.name,
        liquidity_usd = EXCLUDED.liquidity_usd,
        liquidity_locked = EXCLUDED.liquidity_locked,
        holders_count = EXCLUDED.holders_count,
        volume_24h_usd = EXCLUDED.volume_24h_usd,
        price_usd = EXCLUDED.price_usd,
        safety_score = EXCLUDED.safety_score,
        is_honeypot = EXCLUDED.is_honeypot,
        is_validated = EXCLUDED.is_validated,
        validated_at = EXCLUDED.validated_at,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`,
      [
        tokenData.contract_address,
        chainValue,
        tokenData.symbol,
        tokenData.name,
        tokenData.decimals || 18,
        tokenData.total_supply,
        tokenData.liquidity_usd,
        tokenData.liquidity_locked || false,
        tokenData.holders_count || 0,
        tokenData.volume_24h_usd || 0,
        tokenData.price_usd,
        tokenData.safety_score,
        tokenData.is_honeypot || false,
        tokenData.is_validated || false,
        tokenData.validated_at,
      ]
    );

    return result.rows[0] as Token;
  }

  private async saveRiskAssessment(
    token: Token,
    assessment: TokenRiskAssessment
  ): Promise<TokenRiskAssessment> {
    const chainValue = assessment.chain?.toUpperCase() || token.chain;
    const result = await this.pool.query(
      `INSERT INTO token_risk_assessments (
        token_id, contract_address, chain, memecoin_score, risk_score, scam_probability, risk_level, indicators
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (token_id)
      DO UPDATE SET
        contract_address = EXCLUDED.contract_address,
        chain = EXCLUDED.chain,
        memecoin_score = EXCLUDED.memecoin_score,
        risk_score = EXCLUDED.risk_score,
        scam_probability = EXCLUDED.scam_probability,
        risk_level = EXCLUDED.risk_level,
        indicators = EXCLUDED.indicators,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`,
      [
        token.id,
        assessment.contract_address,
        chainValue,
        assessment.memecoin_score,
        assessment.risk_score,
        assessment.scam_probability,
        assessment.risk_level,
        assessment.indicators,
      ]
    );

    return result.rows[0] as TokenRiskAssessment;
  }

  private async triggerSignalGeneration(tokenId: string): Promise<void> {
    const baseUrl = process.env.SIGNAL_SERVICE_URL || 'http://localhost:4002';
    try {
      console.log(`[Validator] Triggering signal analysis for token ${tokenId}...`);
      const response = await axios.post(
        `${baseUrl}/analyze`,
        { token_id: tokenId },
        { timeout: Number(process.env.SIGNAL_REQUEST_TIMEOUT_MS || 5000) }
      );
      if (response.data?.data?.signal) {
        const signalType = response.data.data.signal.signal_type;
        const tokenSymbol = response.data.data.token?.symbol || 'unknown';
        console.log(`[Validator] Signal analysis completed: ${signalType} for ${tokenSymbol}`);
      }
    } catch (error: any) {
      const message = error?.response?.data?.error?.message || error?.message || error;
      console.warn(`[Validator] Unable to enqueue signal analysis for token ${tokenId}: ${message}`);
      // Não propagar erro - análise de sinal é opcional
    }
  }
}
