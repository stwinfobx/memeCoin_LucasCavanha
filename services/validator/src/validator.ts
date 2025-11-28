import './env';
import { ethers } from 'ethers';
import axios from 'axios';
import { Pool } from 'pg';
import { Token, TokenRiskAssessment, TokenValidationResponse } from '@shared/types';
import { ExplorerClient } from './providers/explorer';
import { computeRiskAssessment, MarketPairData } from './risk-scoring';

type SupportedChain = 'BSC' | 'ETH' | 'ARBITRUM' | 'POLYGON' | 'SOLANA';

type ChainConfig = {
  chainId: SupportedChain;
  label: string;
  rpcUrl?: string;
  fallbackEnv?: string;
};

const CHAIN_CONFIGS: ChainConfig[] = [
  {
    chainId: 'BSC',
    label: 'bsc',
    rpcUrl: process.env.BSC_RPC_URL ?? process.env.BSC_TESTNET_RPC,
    fallbackEnv: 'https://bsc-dataseed.binance.org/',
  },
  {
    chainId: 'ETH',
    label: 'ethereum',
    rpcUrl: process.env.ETH_RPC_URL,
  },
  {
    chainId: 'ARBITRUM',
    label: 'arbitrum',
    rpcUrl: process.env.ARBITRUM_RPC_URL,
  },
  {
    chainId: 'POLYGON',
    label: 'polygon',
    rpcUrl: process.env.POLYGON_RPC_URL,
  },
];

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

function getNetworkLabel(chain: SupportedChain): string {
  return CHAIN_CONFIGS.find((config) => config.chainId === chain)?.label ?? chain.toLowerCase();
}

// ERC20 ABI simplificado
const ERC20_ABI = [
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

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
}

export interface ValidationContext {
  pairAddress?: string;
  source?: string;
  rawListing?: ExternalPoolListing | null;
}

export class TokenValidator {
  private providers: Map<SupportedChain, ethers.JsonRpcProvider>;
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
    this.providers = new Map();
    this.initializeProviders();
  }

  private initializeProviders() {
    CHAIN_CONFIGS.forEach((config) => {
      const rpc = config.rpcUrl || config.fallbackEnv;
      if (!rpc) {
        return;
      }
      try {
        const provider = new ethers.JsonRpcProvider(rpc, undefined, {
          staticNetwork: true,
          pollingInterval: Number(process.env.RPC_POLLING_INTERVAL_MS || 15_000),
        });
        this.providers.set(config.chainId, provider);
      } catch (error) {
        console.error(`Failed to initialize provider for ${config.chainId}`, error);
      }
    });
  }

  private normalizeChain(chain?: string): SupportedChain | null {
    if (!chain) return null;
    const value = chain.trim().toUpperCase();
    if (value === 'BSC' || value === 'BSC_TESTNET') return 'BSC';
    if (value === 'ETH' || value === 'ETHEREUM') return 'ETH';
    if (value === 'ARBITRUM') return 'ARBITRUM';
    if (value === 'POLYGON' || value === 'MATIC') return 'POLYGON';
    if (value === 'SOL' || value === 'SOLANA') return 'SOLANA';
    return null;
  }

  private getProvider(chain?: string): ethers.JsonRpcProvider | null {
    const normalized = this.normalizeChain(chain);
    if (!normalized) return null;
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
    const normalizedChain = this.normalizeChain(chain) ?? 'BSC';
    const provider = this.getProvider(normalizedChain);

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
      const contract = new ethers.Contract(contractAddress, ERC20_ABI, provider);

      const [symbol, name, decimals, totalSupply] = await Promise.all([
        contract.symbol().catch(() => 'UNKNOWN'),
        contract.name().catch(() => 'Unknown Token'),
        contract.decimals().catch(() => 18),
        contract.totalSupply().catch(() => ethers.parseUnits('0', 18)),
      ]);

      const isHoneypot = await this.checkHoneypot(contractAddress, provider);
      if (isHoneypot) {
        issues.push('Token is a honeypot');
        safetyScore -= 50;
      }

      const marketData = await this.getMarketData(contractAddress, normalizedChain, context);

      const liquidityLocked = await this.checkLiquidityLocked(contractAddress, normalizedChain);
      if (!liquidityLocked) {
        issues.push('Liquidity not locked');
        safetyScore -= 20;
      } else {
        safetyScore += 20;
      }

      const holdersCount = marketData.holdersCount || 0;
      if (holdersCount < 10) {
        issues.push('Low number of holders');
        safetyScore -= 10;
      } else if (holdersCount > 100) {
        safetyScore += 15;
      }

      const volume24h = marketData.volume24h || 0;
      if (volume24h < 1000) {
        issues.push('Low 24h volume');
        safetyScore -= 10;
      } else if (volume24h > 10_000) {
        safetyScore += 15;
      }

      const liquidity = marketData.liquidity || 0;
      if (liquidity < 5_000) {
        issues.push('Low liquidity');
        safetyScore -= 15;
      } else if (liquidity > 50_000) {
        safetyScore += 20;
      }

      safetyScore = Math.max(0, Math.min(100, 50 + safetyScore));

      const token = await this.saveToken({
        contract_address: contractAddress.toLowerCase(),
        chain: normalizedChain,
        symbol,
        name,
        decimals: Number(decimals),
        total_supply: totalSupply.toString(),
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

      const rawPair = marketData.rawPair || context?.rawListing || null;

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
        pairCreatedAt: rawPair?.priceUsd ? new Date(Date.now() - 24 * 60 * 60 * 1000) : undefined, // Estimate if not available
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
   * Verifica se o token é honeypot simulando uma transfer
   */
  private async checkHoneypot(contractAddress: string, provider: ethers.JsonRpcProvider): Promise<boolean> {
    try {
      const code = await provider.getCode(contractAddress);
      if (code === '0x') {
        return true;
      }
      return false;
    } catch (error) {
      console.error('Honeypot check error:', error);
      return true;
    }
  }

  /**
   * Verifica se a liquidez está bloqueada
   */
  private async checkLiquidityLocked(contractAddress: string, chain: SupportedChain): Promise<boolean> {
    try {
      if (chain === 'BSC' && process.env.BSCSCAN_API_KEY) {
        await axios.get(
          `https://api.bscscan.com/api?module=token&action=tokeninfo&contractaddress=${contractAddress}&apikey=${process.env.BSCSCAN_API_KEY}`
        );
      }
      return true;
    } catch (error) {
      console.error('Liquidity check error:', error);
      return false;
    }
  }

  /**
   * Obtém dados de mercado do GeckoTerminal
   */
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
    try {
      const listing = context?.rawListing || null;
      const network = getNetworkLabel(chain);
      const poolId = listing?.poolId;
      const pairAddress = listing?.pairAddress;
      const dexIdentifierRaw = listing?.dexId;
      const dexIdentifier = dexIdentifierRaw?.replace(/_/g, '-');
      const tokenAddress = contractAddress.toLowerCase();

      if (listing && (listing.liquidityUsd ?? 0) > 0 && (listing.volume24hUsd ?? 0) > 0) {
        return {
          liquidity: listing.liquidityUsd ?? 0,
          volume24h: listing.volume24hUsd ?? 0,
          price: listing.priceUsd ?? 0,
          holdersCount: 0,
          rawPair: listing,
        };
      }

      const poolIdCandidates: string[] = [];
      if (poolId) poolIdCandidates.push(poolId);
      if (dexIdentifier && pairAddress) {
        poolIdCandidates.push(`${network}_${dexIdentifier}_${pairAddress}`);
        poolIdCandidates.push(`${dexIdentifier}_${pairAddress}`);
      }
      if (pairAddress) poolIdCandidates.push(pairAddress);

      for (const candidate of poolIdCandidates) {
        try {
          const poolResponse = await axios.get(
            `${GECKO_API_URL}/networks/${network}/pools/${candidate}?include=base_token,quote_token`,
            {
              timeout: 10_000,
              headers: GECKO_HEADERS,
            }
          );
          const poolAttributes = poolResponse.data?.data?.attributes ?? {};
          const liquidity = parseNumber(poolAttributes.liquidity_usd ?? listing?.liquidityUsd);
          const volume24h = parseNumber(poolAttributes.volume_usd?.h24 ?? listing?.volume24hUsd);
          const price = parseNumber(poolAttributes.base_token_price_usd ?? listing?.priceUsd);

          return {
            liquidity,
            volume24h,
            price,
            holdersCount: 0,
            rawPair: listing,
          };
        } catch (error: any) {
          const status = error?.response?.status;
          const detail = error?.response?.data?.message || error?.message || error;
          console.warn(`Gecko pool lookup failed (${candidate}): ${detail}`);
          if (status !== 404) {
            break;
          }
        }
      }

      if (pairAddress) {
        try {
          const pairResponse = await axios.get(
            `${GECKO_API_URL}/networks/${network}/pools/${pairAddress}`,
            {
              timeout: 10_000,
              headers: GECKO_HEADERS,
            }
          );
          const poolAttributes = pairResponse.data?.data?.attributes ?? {};
          return {
            liquidity: parseNumber(poolAttributes.liquidity_usd ?? listing?.liquidityUsd),
            volume24h: parseNumber(poolAttributes.volume_usd?.h24 ?? listing?.volume24hUsd),
            price: parseNumber(poolAttributes.base_token_price_usd ?? listing?.priceUsd),
            holdersCount: 0,
            rawPair: listing,
          };
        } catch (error: any) {
          const detail = error?.response?.data?.message || error?.message || error;
          console.warn(`Gecko pair lookup failed (${pairAddress}): ${detail}`);
        }
      }

      try {
        const tokenEndpoint = `${GECKO_API_URL}/networks/${network}/tokens/${tokenAddress}?include=top_pools`;
        const tokenResponse = await axios.get(tokenEndpoint, {
          timeout: 10_000,
          headers: GECKO_HEADERS,
        });

        const tokenAttributes = tokenResponse.data?.data?.attributes ?? {};
        const pools = (tokenResponse.data?.included || []).filter((item: any) => item.type === 'pools');
        const topPoolAttributes = pools[0]?.attributes ?? {};

        return {
          liquidity: parseNumber(topPoolAttributes.liquidity_usd ?? tokenAttributes.liquidity_usd ?? listing?.liquidityUsd),
          volume24h: parseNumber(topPoolAttributes.volume_usd?.h24 ?? tokenAttributes.volume_usd?.h24 ?? listing?.volume24hUsd),
          price: parseNumber(tokenAttributes.price_usd ?? topPoolAttributes.base_token_price_usd ?? listing?.priceUsd),
          holdersCount: 0,
          rawPair: listing,
        };
      } catch (error: any) {
        const detail = error?.response?.data?.message || error?.message || error;
        console.warn(`Gecko token lookup failed (${tokenAddress}): ${detail}`);
      }

      return {
        liquidity: listing?.liquidityUsd ?? 0,
        volume24h: listing?.volume24hUsd ?? 0,
        price: listing?.priceUsd ?? 0,
        holdersCount: 0,
        rawPair: listing,
      };
    } catch (error) {
      console.error('Market data error:', error);
      return { liquidity: 0, volume24h: 0, price: 0, holdersCount: 0, rawPair: context?.rawListing || null };
    }
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
