import axios, { AxiosInstance } from 'axios';
import { SolanaHolderInfo, SolanaMintAuthority, SolanaTokenMetadata } from './helius';

/**
 * Solscan Pro API v2.0 Client
 * 
 * Provides an alternative source for Solana token data when Helius is unavailable.
 * Documentation: https://pro-api.solscan.io/v2.0/docs
 */

const SOLSCAN_API_KEY = process.env.SOLSCAN_API_KEY || '';
const SOLSCAN_BASE_URL = 'https://pro-api.solscan.io/v2.0';

export class SolscanClient {
  private readonly http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: SOLSCAN_BASE_URL,
      timeout: 10000,
      headers: {
        'token': SOLSCAN_API_KEY,
        'Accept': 'application/json'
      }
    });
  }

  isAvailable(): boolean {
    return Boolean(SOLSCAN_API_KEY && SOLSCAN_API_KEY !== 'YOUR_SOLSCAN_API_KEY_HERE');
  }

  /**
   * Fetch top holders for a token
   */
  async getTopHolders(mintAddress: string, limit = 20): Promise<SolanaHolderInfo[] | null> {
    if (!this.isAvailable()) return null;

    try {
      const response = await this.http.get('/token/holders', {
        params: { address: mintAddress, page: 1, page_size: limit }
      });

      const holders = response.data?.data?.items || [];
      if (!Array.isArray(holders)) return null;

      return holders.map((h: any) => ({
        address: h.address || 'unknown',
        amount: h.amount?.toString() || '0',
        percentage: Number(h.percentage || 0)
      }));
    } catch (error: any) {
      console.warn(`[Solscan] Failed to get holders for ${mintAddress}: ${error.message}`);
      return null;
    }
  }

  /**
   * Fetch token metadata and authorities
   */
  async getTokenMetadata(mintAddress: string): Promise<SolanaTokenMetadata | null> {
    if (!this.isAvailable()) return null;

    try {
      const response = await this.http.get('/token/meta', {
        params: { address: mintAddress }
      });

      const data = response.data?.data;
      if (!data) return null;

      return {
        name: data.name || 'Unknown',
        symbol: data.symbol || 'UNKNOWN',
        uri: data.metadata?.metadata_uri
      };
    } catch (error: any) {
      console.warn(`[Solscan] Failed to get metadata for ${mintAddress}: ${error.message}`);
      return null;
    }
  }

  /**
   * Fetch mint authorities
   */
  async getMintAuthority(mintAddress: string): Promise<SolanaMintAuthority | null> {
    if (!this.isAvailable()) return null;

    try {
      const response = await this.http.get('/token/meta', {
        params: { address: mintAddress }
      });

      const meta = response.data?.data?.metadata;
      if (!meta) return null;

      return {
        mintAuthority: meta.mint_authority || null,
        freezeAuthority: meta.freeze_authority || null,
        isMintRenounced: !meta.mint_authority,
        isFreezeRenounced: !meta.freeze_authority
      };
    } catch (error: any) {
      console.warn(`[Solscan] Failed to get authorities for ${mintAddress}: ${error.message}`);
      return null;
    }
  }
}

export const solscanClient = new SolscanClient();
