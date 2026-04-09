import './env';
import { } from 'ethers';
import axios from 'axios';
import { Pool } from 'pg';
import { Token, TokenRiskAssessment, TokenValidationResponse } from '@shared/types';
import { ExplorerClient, ContractCreationInfo, TokenHolderInfo } from './providers/explorer';
import { computeRiskAssessment, MarketPairData } from './risk-scoring';
import { FreeSecurityProviders, SecurityConsensus } from './providers/FreeSecurityProviders';
import {
  ChainProvider,
  SupportedChain,
  createChainProvider,
  normalizeChainName,
  getEnabledChains
} from './chains';
import { SettingsManager } from './utils/settings';



const GECKO_API_URL = process.env.GECKOTERMINAL_BASE_URL || 'https://api.geckoterminal.com/api/v2';
const GECKO_HEADERS = {
  'User-Agent': 'TradingBotValidator/1.0 (+https://github.com/tradingbot)',
  Accept: 'application/json',
  Origin: 'https://geckoterminal.com',
  Referer: 'https://geckoterminal.com/',
  'X-Requested-With': 'XMLHttpRequest',
};

// --- BLACKLIST CACHE (Tier 4) ---
// Saves API credits by blocking known-bad addresses for 5 minutes
const BLACKLIST_TTL_MS = 5 * 60 * 1000; // 5 minutes
const BLACKLIST_MAX_SIZE = 1000;
const blacklistCache = new Map<string, { reason: string; expiresAt: number }>();

function isBlacklisted(address: string): string | null {
  const entry = blacklistCache.get(address.toLowerCase());
  if (entry && entry.expiresAt > Date.now()) return entry.reason;
  if (entry) blacklistCache.delete(address.toLowerCase());
  return null;
}

function addToBlacklist(address: string, reason: string): void {
  blacklistCache.set(address.toLowerCase(), { reason, expiresAt: Date.now() + BLACKLIST_TTL_MS });
  // Prevent memory leak
  if (blacklistCache.size > BLACKLIST_MAX_SIZE) {
    const firstKey = blacklistCache.keys().next().value;
    if (firstKey) blacklistCache.delete(firstKey);
  }
}

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
  first_seen_at?: number;
}

export class TokenValidator {
  private providers: Map<SupportedChain, ChainProvider>;
  private pool: Pool;
  private settings: SettingsManager;

  constructor(pool: Pool) {
    this.pool = pool;
    this.settings = new SettingsManager(this.pool);
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
    const validationStartMs = Date.now();
    const issues: string[] = [];
    let safetyScore = 0;
    const normalizedChain = normalizeChainName(chain) || SupportedChain.BSC;
    const provider = this.getProvider(chain);
    const isPumpFun = normalizedChain === SupportedChain.SOLANA && contractAddress.endsWith('pump');

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

    // --- TIER 4: BLACKLIST CACHE CHECK (Cost: 0) ---
    const blacklistReason = isBlacklisted(contractAddress);
    if (blacklistReason) {
      console.log(`[Validator] ⚫ Blacklisted: ${contractAddress} (${blacklistReason})`);
      return {
        token: {} as Token,
        validation_result: {
          is_valid: false,
          safety_score: 0,
          is_honeypot: false,
          liquidity_locked: false,
          issues: [`Blacklisted: ${blacklistReason}`],
        },
      };
    }

    try {
      // Usar ChainProvider ao invés de ethers diretamente
      const tokenInfo = await provider.getTokenInfo(contractAddress);
      const { symbol, name, decimals, totalSupply } = tokenInfo;

      const marketData = await provider.getMarketData(contractAddress, context);
      const liquidityLocked = await provider.checkLiquidityLocked(contractAddress);

      const volume24h = marketData.volume24h || 0;
      const liquidity = marketData.liquidity || 0;
      let holdersCount = marketData.holdersCount || 0;

      // --- TIER 2: CONTRACT SECURITY (Cheap) ---
      // Only proceed if the contract passes security checks
      let isHoneypot = false;
      let securityConsensus: SecurityConsensus | undefined;

      try {
        if (normalizedChain === SupportedChain.SOLANA) {
          securityConsensus = await FreeSecurityProviders.checkSolana(contractAddress);
        } else {
          const chainNum = normalizedChain === SupportedChain.BASE ? '8453' : '56';
          securityConsensus = await FreeSecurityProviders.checkEVM(contractAddress, chainNum as '56' | '8453');
        }
        
        if (securityConsensus) {
          isHoneypot = securityConsensus.isHoneypot;
          issues.push(...securityConsensus.issues);
        }
      } catch (e) {
        console.warn(`[Validator] Security consensus failed, falling back to provider check: ${e}`);
        isHoneypot = await provider.checkHoneypot(contractAddress);
        if (isHoneypot) issues.push('Token is a honeypot (Provider Check)');
      }

      // Tier 2 Early Exit: If honeypot confirmed, blacklist and skip expensive calls
      if (isHoneypot) {
        addToBlacklist(contractAddress, 'Honeypot');
        console.log(`[Validator] 💀 Tier 2 REJECT: ${symbol} is Honeypot. Blacklisted for 5min.`);
      }

      // --- TIER 3: EXPENSIVE DATA (Explorers / Holders) ---
      // Only call these expensive APIs if the token passed Tiers 1 & 2
      const explorerClient = new ExplorerClient(normalizedChain);
      let contractCreation: ContractCreationInfo | null = null;
      let holderList: TokenHolderInfo[] | null = null;

      if (!isHoneypot) {
        [contractCreation, holderList] = await Promise.all([
          explorerClient.getContractCreation(contractAddress),
          explorerClient.getTokenHolderConcentration(contractAddress, 10),
        ]);
      }

      // --- FIX: Holder Count Sync ---
      // Use the maximum between marketData count and explorer list length
      if (holderList && holderList.length > 0 && holdersCount === 0) {
        holdersCount = holderList.length;
        console.log(`[Validator] 🔧 Holder count synced from explorer list: ${holdersCount}`);
      }

      const rawPair = context?.rawListing || null;
      const marketSummary: MarketPairData = {
        pairAddress: context?.pairAddress || rawPair?.pairAddress,
        dexId: rawPair?.poolId,
        liquidityUsd: liquidity,
        fdvUsd: parseNumber(rawPair?.fdvUsd || 0), 
        volume24hUsd: volume24h,
        priceUsd: marketData.price,
        txCount5m: 0,
        txCount1h: 0,
        txCount6h: 0,
        priceChange5m: 0,
        priceChange1h: 0,
        priceChange6h: 0,
        baseTokenSymbol: symbol,
        baseTokenName: name,
      };

      // --- UNIFIED SCORING (Validator v3 + Financial Safety) ---
      const riskAssessment = computeRiskAssessment({
        token: { contract_address: contractAddress, chain: normalizedChain } as Token,
        market: marketSummary,
        isHoneypot,
        liquidityLocked,
        holdersCount,
        contractCreation,
        topHolders: holderList,
        security: securityConsensus,
        first_seen_at: context?.first_seen_at,
      });

      const safetyScore = riskAssessment.risk_score;
      const indexing = riskAssessment.is_indexing || false;

      // Blacklist tokens that score 0 to avoid re-processing
      // BUT ONLY IF NOT INDEXING (if indexing, we want to try again)
      if (safetyScore === 0 && !indexing) {
        const reason = riskAssessment.indicators?.rejectionReasons?.[0] || 'Score 0';
        addToBlacklist(contractAddress, reason);
      }

      // --- PERSISTENCE BYPASS ---
      // User feedback: Don't save to DB if still indexing.
      // Return the result immediately so ingestion can retry.
      if (indexing) {
        return {
          token: {
            contract_address: contractAddress,
            chain: normalizedChain,
            symbol: String(symbol),
            name: String(name),
          } as Token,
          validation_result: {
            is_valid: false,
            safety_score: 0,
            is_honeypot: false,
            liquidity_locked: false,
            issues: riskAssessment.indicators.rejectionReasons || [],
            is_indexing: true,
          },
          risk_assessment: riskAssessment,
        };
      }

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
      });

      // Sync risk_score with safety_score to ensure consistency across tables
      riskAssessment.risk_score = safetyScore;
      riskAssessment.memecoin_score = safetyScore;
      riskAssessment.token_id = token.id;
      const persistedRisk = await this.saveRiskAssessment(token, riskAssessment);

      await this.triggerSignalGeneration(token.id);

      // --- Latency monitoring ---
      const latencyMs = Date.now() - validationStartMs;
      const latencyLabel = latencyMs > 30_000 ? '🐢 SLOW' : '⚡';
      console.log(`[Validator] ${latencyLabel} Validation of ${symbol} (${normalizedChain}) took ${latencyMs}ms`);

      return {
        token,
        validation_result: {
          is_valid: safetyScore >= 80 && !isHoneypot,
          safety_score: safetyScore,
          is_honeypot: isHoneypot,
          liquidity_locked: liquidityLocked,
          issues: riskAssessment.indicators.rejectionReasons || [],
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
    // Use CURRENT_TIMESTAMP for validated_at to eliminate Node.js vs DB timezone drift
    const result = await this.pool.query(
      `INSERT INTO tokens (
        contract_address, chain, symbol, name, decimals, total_supply,
        liquidity_usd, liquidity_locked, holders_count, volume_24h_usd,
        price_usd, safety_score, is_honeypot, is_validated, validated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)
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
        validated_at = CURRENT_TIMESTAMP,
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
        { timeout: Number(process.env.SIGNAL_REQUEST_TIMEOUT_MS || 15000) }
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
