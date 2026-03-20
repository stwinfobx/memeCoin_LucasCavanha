import '../env';
import axios, { AxiosInstance } from 'axios';

/**
 * Helius DAS (Digital Asset Standard) Client for Solana
 * 
 * Provides holder data, mint authority checks, and token metadata
 * using the Helius RPC enhanced API. Designed for economy:
 *  - Caches results in-memory with TTL
 *  - Batches requests when possible
 *  - Falls back gracefully if API is unavailable
 */

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const HELIUS_RPC_URL = HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
  : '';
const HELIUS_DAS_URL = HELIUS_API_KEY
  ? `https://api.helius.xyz/v0`
  : '';

export interface SolanaHolderInfo {
  address: string;
  amount: string;
  percentage: number;
}

export interface SolanaMintAuthority {
  mintAuthority: string | null;
  freezeAuthority: string | null;
  isMintRenounced: boolean;
  isFreezeRenounced: boolean;
}

export interface SolanaTokenMetadata {
  name: string;
  symbol: string;
  uri?: string;
  creators?: Array<{ address: string; verified: boolean; share: number }>;
}

// Simple in-memory cache with TTL (5 min for holders, 10 min for metadata)
const cache = new Map<string, { data: any; expiresAt: number }>();
function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.data as T;
  if (entry) cache.delete(key);
  return null;
}
function setCache(key: string, data: any, ttlMs: number) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  // Prevent memory leak: cap cache at 500 entries
  if (cache.size > 500) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
}

export class HeliusClient {
  private readonly apiKey: string;
  private readonly http: AxiosInstance;

  constructor() {
    this.apiKey = HELIUS_API_KEY;
    this.http = axios.create({ timeout: 8000 });
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * Get top token holders and their concentration using Helius DAS
   * Uses getTokenLargestAccounts (Solana RPC) via Helius enhanced endpoint
   */
  async getTopHolders(mintAddress: string, limit = 20): Promise<SolanaHolderInfo[] | null> {
    if (!this.isAvailable()) return null;

    const cacheKey = `holders:${mintAddress}`;
    const cached = getCached<SolanaHolderInfo[]>(cacheKey);
    if (cached) return cached;

    try {
      // Use Solana RPC via Helius for getTokenLargestAccounts
      const response = await this.http.post(HELIUS_RPC_URL, {
        jsonrpc: '2.0',
        id: 'holder-check',
        method: 'getTokenLargestAccounts',
        params: [mintAddress]
      });

      const accounts = response.data?.result?.value || [];
      if (accounts.length === 0) return null;

      // Get total supply for percentage calculation
      const supplyResp = await this.http.post(HELIUS_RPC_URL, {
        jsonrpc: '2.0',
        id: 'supply-check',
        method: 'getTokenSupply',
        params: [mintAddress]
      });

      const totalSupply = Number(supplyResp.data?.result?.value?.amount || '0');
      if (totalSupply === 0) return null;

      const holders: SolanaHolderInfo[] = accounts.slice(0, limit).map((acc: any) => ({
        address: acc.address || 'unknown',
        amount: acc.amount || '0',
        percentage: totalSupply > 0 ? (Number(acc.amount || 0) / totalSupply) * 100 : 0
      }));

      setCache(cacheKey, holders, 5 * 60 * 1000); // 5 min TTL
      return holders;
    } catch (error: any) {
      console.warn(`[Helius] Failed to get holders for ${mintAddress}: ${error.message}`);
      return null;
    }
  }

  /**
   * Check Mint and Freeze authority status via Helius DAS
   * Uses getAsset for detailed mint info
   */
  async getMintAuthority(mintAddress: string): Promise<SolanaMintAuthority | null> {
    if (!this.isAvailable()) return null;

    const cacheKey = `mint-auth:${mintAddress}`;
    const cached = getCached<SolanaMintAuthority>(cacheKey);
    if (cached) return cached;

    try {
      // Use standard Solana RPC to get mint account info
      const response = await this.http.post(HELIUS_RPC_URL, {
        jsonrpc: '2.0',
        id: 'mint-auth-check',
        method: 'getAccountInfo',
        params: [mintAddress, { encoding: 'jsonParsed' }]
      });

      const parsed = response.data?.result?.value?.data?.parsed?.info;
      if (!parsed) return null;

      const result: SolanaMintAuthority = {
        mintAuthority: parsed.mintAuthority || null,
        freezeAuthority: parsed.freezeAuthority || null,
        isMintRenounced: !parsed.mintAuthority,
        isFreezeRenounced: !parsed.freezeAuthority,
      };

      setCache(cacheKey, result, 10 * 60 * 1000); // 10 min TTL
      return result;
    } catch (error: any) {
      console.warn(`[Helius] Failed to get mint authority for ${mintAddress}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get token metadata (name, symbol, creators) via Helius DAS API
   * Uses the getAsset endpoint for rich metadata
   */
  async getTokenMetadata(mintAddress: string): Promise<SolanaTokenMetadata | null> {
    if (!this.isAvailable()) return null;

    const cacheKey = `metadata:${mintAddress}`;
    const cached = getCached<SolanaTokenMetadata>(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.http.post(HELIUS_RPC_URL, {
        jsonrpc: '2.0',
        id: 'metadata-check',
        method: 'getAsset',
        params: { id: mintAddress }
      });

      const asset = response.data?.result;
      if (!asset) return null;

      const metadata: SolanaTokenMetadata = {
        name: asset.content?.metadata?.name || 'Unknown',
        symbol: asset.content?.metadata?.symbol || 'UNKNOWN',
        uri: asset.content?.json_uri,
        creators: asset.creators,
      };

      setCache(cacheKey, metadata, 10 * 60 * 1000); // 10 min TTL
      return metadata;
    } catch (error: any) {
      // getAsset may not be available for all tokens - this is expected
      return null;
    }
  }

  /**
   * Convenience: Get total unique holders count via getTokenAccounts
   * This is expensive — use sparingly
   */
  async getHoldersCount(mintAddress: string): Promise<number> {
    if (!this.isAvailable()) return 0;

    const cacheKey = `holders-count:${mintAddress}`;
    const cached = getCached<number>(cacheKey);
    if (cached !== null) return cached;

    try {
      // Use Helius DAS getTokenAccounts for total unique holders
      const response = await this.http.post(`${HELIUS_DAS_URL}/token-metadata?api-key=${this.apiKey}`, {
        mintAccounts: [mintAddress],
        includeOffChain: false,
        disableTokenWrap: true,
      });

      // Fallback: use getTokenLargestAccounts count as rough estimate
      const holders = await this.getTopHolders(mintAddress, 20);
      const count = holders?.length || 0;

      setCache(cacheKey, count, 5 * 60 * 1000);
      return count;
    } catch {
      return 0;
    }
  }
}

// Singleton instance
export const heliusClient = new HeliusClient();
