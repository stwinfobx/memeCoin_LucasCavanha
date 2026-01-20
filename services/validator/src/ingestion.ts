import axios from 'axios';
import { Pool } from 'pg';
import { TokenValidator, ValidationContext } from './validator';

interface MemecoinIngestionOptions {
  validator: TokenValidator;
  pool: Pool;
  intervalMs: number;
  freshnessMinutes: number;
}

interface TokenListing {
  chainId: string;
  pairAddress: string;
  poolId?: string;
  pairCreatedAt?: number;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken?: {
    address: string;
    name: string;
    symbol: string;
  };
  dexId?: string;
  liquidityUsd?: number;
  volume24hUsd?: number;
  fdvUsd?: number;
  priceUsd?: number;
  priceChange1h?: number;
  priceChange6h?: number;
  priceChange24h?: number;
}

interface GeckoPool {
  id: string;
  type: string;
  attributes: {
    address: string;
    name?: string;
    dex_identifier?: string;
    pool_created_at?: string;
    liquidity_usd?: string | number;
    fdv_usd?: string | number;
    market_cap_usd?: string | number;
    volume_usd?: {
      m5?: string | number;
      h1?: string | number;
      h6?: string | number;
      h24?: string | number;
    };
    price_change_percentage?: {
      m5?: string | number;
      h1?: string | number;
      h6?: string | number;
      h24?: string | number;
    };
    base_token_price_usd?: string | number;
    token_reserves?: { token: { address: string; symbol: string; name: string } }[];
  };
  relationships?: {
    base_token?: { data?: { id: string } };
    quote_token?: { data?: { id: string } };
  };
}

interface GeckoToken {
  id: string;
  type: string;
  attributes: {
    address?: string;
    name?: string;
    symbol?: string;
  };
}

interface GeckoResponse {
  data: GeckoPool[];
  included?: GeckoToken[];
}

const INGESTION_PAIR_LIMIT = Number(process.env.INGESTION_PAIR_LIMIT || 50);
const MEME_KEYWORDS = ['INU', 'DOGE', 'PEPE', 'FLOKI', 'SHIB', 'ELON', 'MOON', 'BABY', 'PUMP', 'APE', 'MOG', 'WIF', 'LADY', 'BOBO', 'DEGEN'];
const STABLE_SYMBOLS = ['USDT', 'USDC', 'BUSD', 'DAI', 'EURT', 'TUSD', 'USD', 'USDD', 'USD1'];
const GECKO_BASE_URL = process.env.GECKOTERMINAL_BASE_URL || 'https://api.geckoterminal.com/api/v2';
const GECKO_NETWORK = process.env.GECKOTERMINAL_NETWORK || 'bsc';
const GECKO_PAGE = process.env.GECKOTERMINAL_PAGE || '1';
const GECKO_INCLUDE = 'include=base_token,quote_token';

function toNumber(value: string | number | undefined | null): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function buildListing(pool: GeckoPool, tokens: Map<string, GeckoToken>): TokenListing | null {
  const baseTokenId = pool.relationships?.base_token?.data?.id;
  const quoteTokenId = pool.relationships?.quote_token?.data?.id;

  const reserves: any[] = (pool as any)?.attributes?.token_reserves ?? [];
  const baseReserveToken = reserves[0]?.token ?? {};
  const quoteReserveToken = reserves[1]?.token ?? {};

  const baseTokenAttrs = baseTokenId ? tokens.get(baseTokenId)?.attributes : undefined;
  const quoteTokenAttrs = quoteTokenId ? tokens.get(quoteTokenId)?.attributes : undefined;

  const volume24h = pool.attributes.volume_usd?.h24 ?? pool.attributes.volume_usd?.h6 ?? pool.attributes.volume_usd?.h1;
  const priceChange = pool.attributes.price_change_percentage;

  let pairCreatedAt: number | undefined;
  if (pool.attributes.pool_created_at) {
    const timestamp = Date.parse(pool.attributes.pool_created_at);
    pairCreatedAt = Number.isFinite(timestamp) ? timestamp : undefined;
  }

  const poolId = pool.id;
  const pairAddressFromAttributes = pool.attributes.address;
  const pairAddressFromId = poolId?.includes('_') ? poolId.split('_').pop() : undefined;
  const pairAddress = (pairAddressFromAttributes || pairAddressFromId)?.toLowerCase();

  const baseAddressCandidate = baseTokenAttrs?.address || baseReserveToken?.address || pairAddress;
  const quoteAddressCandidate = quoteTokenAttrs?.address || quoteReserveToken?.address;

  const baseSymbolCandidate = baseTokenAttrs?.symbol || baseReserveToken?.symbol;
  const baseNameCandidate = baseTokenAttrs?.name || baseReserveToken?.name;

  const quoteSymbolCandidate = quoteTokenAttrs?.symbol || quoteReserveToken?.symbol;
  const quoteNameCandidate = quoteTokenAttrs?.name || quoteReserveToken?.name;

  const baseAddress = baseAddressCandidate ? String(baseAddressCandidate).toLowerCase() : undefined;

  if (!poolId || !pairAddress || !baseAddress) {
    console.warn('[Ingestion] Ignorando pool por falta de endereço base', {
      poolId,
      pairAddress,
      baseAddressCandidate,
      baseSymbolCandidate,
    });
    return null;
  }

  const liquidityValue =
    toNumber((pool as any)?.attributes?.reserve_in_usd) ?? toNumber(pool.attributes.liquidity_usd);

  const volume24hValue =
    toNumber(pool.attributes.volume_usd?.h24) ??
    toNumber(pool.attributes.volume_usd?.h6) ??
    toNumber(pool.attributes.volume_usd?.h1);

  return {
    chainId: GECKO_NETWORK,
    pairAddress,
    poolId,
    pairCreatedAt,
    baseToken: {
      address: baseAddress,
      name: baseNameCandidate || pool.attributes.name || 'Unknown',
      symbol: (baseSymbolCandidate || 'TOKEN').toUpperCase(),
    },
    quoteToken: quoteAddressCandidate
      ? {
        address: String(quoteAddressCandidate).toLowerCase(),
        name: quoteNameCandidate || 'Quote',
        symbol: (quoteSymbolCandidate || '').toUpperCase(),
      }
      : undefined,
    dexId: pool.attributes.dex_identifier,
    liquidityUsd: liquidityValue,
    volume24hUsd: volume24hValue,
    fdvUsd:
      toNumber(pool.attributes.fdv_usd) ??
      toNumber(pool.attributes.market_cap_usd) ??
      toNumber((pool as any)?.attributes?.fully_diluted_valuation_usd),
    priceUsd: toNumber(pool.attributes.base_token_price_usd) ?? toNumber(baseReserveToken?.price_usd),
    priceChange1h: toNumber(priceChange?.h1),
    priceChange6h: toNumber(priceChange?.h6),
    priceChange24h: toNumber(priceChange?.h24),
  };
}

export class MemecoinIngestion {
  private readonly validator: TokenValidator;
  private readonly pool: Pool;
  private readonly intervalMs: number;
  private readonly freshnessMinutes: number;
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastRun?: Date;

  constructor(options: MemecoinIngestionOptions) {
    this.validator = options.validator;
    this.pool = options.pool;
    this.intervalMs = Math.max(options.intervalMs, 15_000);
    this.freshnessMinutes = Math.max(options.freshnessMinutes, 30);
  }

  start() {
    if (this.running) {
      return;
    }

    console.log(
      `🛰️  Memecoin ingestion running every ${Math.round(this.intervalMs / 1000)}s (freshness ${this.freshnessMinutes}min)`
    );

    this.running = true;
    this.executeCycle();
    this.timer = setInterval(() => this.executeCycle(), this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.running = false;
  }

  private async executeCycle() {
    try {
      this.lastRun = new Date();
      const listings = await this.fetchLatestListings();

      if (!listings.length) {
        console.log('🛰️  Nenhum novo listing encontrado');
        return;
      }

      let processed = 0;
      let skipped = 0;

      for (const listing of listings) {
        const baseAddress = listing.baseToken?.address;
        if (!baseAddress) {
          skipped += 1;
          console.warn('[Ingestion] Skip sem endereço base normalizado', listing);
          continue;
        }

        const chainId = listing.chainId || GECKO_NETWORK;
        if (!this.isMemecoinCandidate(listing)) {
          skipped += 1;
          continue;
        }

        const shouldSkip = await this.shouldSkipToken(baseAddress, chainId);
        if (shouldSkip) {
          skipped += 1;
          continue;
        }

        const context: ValidationContext = {
          pairAddress: listing.pairAddress,
          source: 'geckoterminal:listings',
          rawListing: listing,
        };

        const result = await this.validator.validateToken(baseAddress, chainId, context);
        processed += 1;

        const label = `${listing.baseToken.symbol || 'TOKEN'}-${chainId}`;
        const status = result.validation_result.is_valid ? 'VALID' : 'WARN';
        console.log(
          `[Ingestion] ${status} ${label} | score=${result.validation_result.safety_score} | risk=${result.risk_assessment?.risk_level ?? 'n/a'} | liquidity=$${result.token.liquidity_usd ?? 0}`
        );
      }

      console.log(
        `[Ingestion] Cycle done. processed=${processed} skipped=${skipped} listings=${listings.length}`
      );
    } catch (error) {
      console.error('❌ Ingestion cycle failed:', error);
    }
  }

  private async fetchLatestListings(): Promise<TokenListing[]> {
    const attempts = [
      {
        url: `${GECKO_BASE_URL}/networks/${GECKO_NETWORK}/pools?page=${GECKO_PAGE}&${GECKO_INCLUDE}`,
        label: 'gecko-pools',
      },
      {
        url: `${GECKO_BASE_URL}/networks/${GECKO_NETWORK}/pools?page=${GECKO_PAGE}&sort=h24_volume_usd_desc&${GECKO_INCLUDE}`,
        label: 'gecko-volume',
      },
      {
        url: `${GECKO_BASE_URL}/networks/${GECKO_NETWORK}/pools?page=${GECKO_PAGE}&sort=pool_created_at_desc&${GECKO_INCLUDE}`,
        label: 'gecko-recent',
      },
      {
        url: `${GECKO_BASE_URL}/networks/${GECKO_NETWORK}/pools?page=${GECKO_PAGE}&sort=h24_volume_usd_desc&${GECKO_INCLUDE}`, // Fallback ou preço alterado
        label: 'gecko-price-change',
      },
    ];

    for (const attempt of attempts) {
      try {
        const response = await axios.get<GeckoResponse>(attempt.url, {
          timeout: 15_000,
          headers: {
            'User-Agent': 'TradingBotValidator/1.0 (+https://github.com/tradingbot)',
            Accept: 'application/json',
            Origin: 'https://geckoterminal.com',
            Referer: 'https://geckoterminal.com/',
            'X-Requested-With': 'XMLHttpRequest',
          },
        });

        const pools = response.data?.data ?? [];
        if (!pools.length) {
          console.warn(`[Ingestion] Endpoint ${attempt.label} respondeu sem pools`);
          await new Promise(resolve => setTimeout(resolve, 3000));
          continue;
        }

        const tokenMap = new Map<string, GeckoToken>();

        if (response.data?.included?.length) {
          for (const token of response.data.included) {
            tokenMap.set(token.id, token);
          }
        }

        const listings = pools
          .slice(0, INGESTION_PAIR_LIMIT)
          .map((pool) => buildListing(pool, tokenMap))
          .filter((listing): listing is TokenListing => listing !== null);

        if (listings.length > 0) {
          console.log(`[Ingestion] Using listings from ${attempt.label} (${listings.length} pools)`);
          return listings;
        }
      } catch (error: any) {
        const status = error?.response?.status;
        const detail = error?.response?.data?.message ?? error?.message ?? error;
        console.warn(`[Ingestion] Failed ${attempt.label} (${attempt.url}): ${detail}`);

        if (status === 429) {
          console.warn('[Ingestion] Rate limited (429). Waiting 30s before next attempt...');
          await new Promise(resolve => setTimeout(resolve, 30000));
        } else {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }

        if (status === 404) {
          continue;
        }
      }
    }

    console.warn('[Ingestion] Nenhum endpoint de listings retornou dados');
    return [];
  }

  private async shouldSkipToken(contract: string, chain: string): Promise<boolean> {
    try {
      const freshnessInterval = `${this.freshnessMinutes} minutes`;
      const result = await this.pool.query(
        `SELECT 1 FROM tokens 
         WHERE contract_address = $1 
           AND chain = $2
           AND validated_at > NOW() - ($3::text)::interval
         LIMIT 1`,
        [contract, chain.toUpperCase(), freshnessInterval]
      );
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      console.error('Failed to check token freshness:', error);
      return false;
    }
  }

  private isMemecoinCandidate(listing: TokenListing): boolean {
    const symbol = (listing.baseToken?.symbol || '').toUpperCase();
    const name = (listing.baseToken?.name || '').toUpperCase();
    const keywordHit = MEME_KEYWORDS.some((keyword) => symbol.includes(keyword) || name.includes(keyword));

    const liquidityUsd = listing.liquidityUsd ?? 0;
    const fdvUsd = listing.fdvUsd ?? 0;

    if (STABLE_SYMBOLS.includes(symbol)) {
      return false;
    }

    if (keywordHit) {
      return true;
    }

    const pairCreatedAt = listing.pairCreatedAt;
    const now = Date.now();
    const ageMs = pairCreatedAt ? now - pairCreatedAt : Number.POSITIVE_INFINITY;
    const isVeryNew = ageMs < 1000 * 60 * 60 * 24 * 7; // < 7 dias

    const quoteSymbol = (listing.quoteToken?.symbol || '').toUpperCase();
    const isStablePair = ['BUSD', 'USDT', 'USDC', 'DAI'].includes(quoteSymbol);

    if (isStablePair) {
      return false;
    }

    if (isVeryNew && liquidityUsd <= 500_000 && fdvUsd <= 50_000_000) {
      return true;
    }

    if (symbol.length <= 5 && liquidityUsd < 250_000) {
      return true;
    }

    if ((listing.priceChange24h ?? 0) > 100 && (listing.volume24hUsd ?? 0) > 100_000) {
      return true;
    }

    return true;
  }
}
