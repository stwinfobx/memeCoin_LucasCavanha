import axios from 'axios';

/**
 * De.Fi Scanner — Third fallback for EVM security checks
 *
 * Only invoked when BOTH GoPlus and Honeypot.is are unavailable.
 * Requires DEFI_API_KEY (free account at https://de.fi/api).
 *
 * GraphQL endpoint: https://public-api.de.fi/graphql
 * Rate limit (free): ~100 requests/day — acceptable as last resort only.
 */

const DEFI_GQL_URL = 'https://public-api.de.fi/graphql';

export interface DeFiScanResult {
  isHoneypot: boolean;
  score: number;   // 0-100, higher = safer
  issues: string[];
  source: {
    checked: boolean;
    flagged: boolean;
    score?: number;
    reason?: string;
  };
}

const CHAIN_MAP: Record<string, string> = {
  '56': 'bsc',
  '8453': 'base',
};

export class DeFiScanner {
  /**
   * Check a token on BSC or Base using De.Fi Scanner.
   * Returns null if API key is missing or request fails.
   */
  static async checkEVM(
    address: string,
    chainId: '56' | '8453'
  ): Promise<DeFiScanResult | null> {
    const apiKey = process.env.DEFI_API_KEY;
    if (!apiKey) {
      // No key configured — silently skip, don't spam warnings
      return null;
    }

    const chain = CHAIN_MAP[chainId] || 'bsc';

    const query = `
      query TokenSecurity($address: String!, $chain: String!) {
        tokenSecurity(address: $address, chain: $chain) {
          is_honeypot
          buy_tax
          sell_tax
          score
          issues {
            title
            description
          }
        }
      }
    `;

    try {
      const resp = await axios.post(
        DEFI_GQL_URL,
        {
          query,
          variables: { address, chain },
        },
        {
          timeout: 8000,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const data = resp.data?.data?.tokenSecurity;
      if (!data) return null;

      const isHoneypot = data.is_honeypot === true;
      const score = Number(data.score ?? 50);
      const buyTax = Number(data.buy_tax ?? 0);
      const sellTax = Number(data.sell_tax ?? 0);
      const rawIssues: string[] = (data.issues || []).map(
        (i: { title: string; description?: string }) =>
          `De.Fi: ${i.title}${i.description ? ' — ' + i.description : ''}`
      );

      if (buyTax > 10) rawIssues.push(`De.Fi: High buy tax ${buyTax}%`);
      if (sellTax > 10) rawIssues.push(`De.Fi: High sell tax ${sellTax}%`);

      const flagged = isHoneypot || score < 40;

      return {
        isHoneypot,
        score,
        issues: rawIssues,
        source: {
          checked: true,
          flagged,
          score,
          reason: isHoneypot
            ? 'Honeypot'
            : score < 40
            ? `LowScore(${score})`
            : undefined,
        },
      };
    } catch (error: any) {
      const status = error.response?.status;
      if (status === 401 || status === 403) {
        console.warn('[DeFiScanner] Invalid or expired API key (401/403). Set DEFI_API_KEY in .env.');
      } else if (status === 429) {
        console.warn('[DeFiScanner] Rate limit reached (429). Daily limit exhausted.');
      } else {
        console.warn(`[DeFiScanner] Request failed: ${error.message}`);
      }
      return null;
    }
  }
}
