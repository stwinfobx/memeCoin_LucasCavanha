import axios, { AxiosInstance } from 'axios';
import { heliusClient, SolanaHolderInfo } from './helius';

type SupportedExplorer = 'bsc' | 'eth' | 'base' | 'solana';

interface ExplorerResponse<T = any> {
  status: string;
  message: string;
  result: T;
}

export interface ContractCreationInfo {
  contractAddress: string;
  contractCreator: string;
  txHash: string;
  blockNumber?: string;
  timestamp?: number;
}

export interface TokenHolderInfo {
  address: string;
  value: string;
  percentage: number;
}

const EXPLORER_CONFIG: Record<string, { baseUrl: string; apiKey?: string }> = {
  bsc: {
    baseUrl: 'https://api.bscscan.com/api',
    apiKey: process.env.BSCSCAN_API_KEY,
  },
  eth: {
    baseUrl: 'https://api.etherscan.io/api',
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  base: {
    baseUrl: 'https://api.basescan.org/api',
    apiKey: process.env.BASESCAN_API_KEY,
  },
};

export class ExplorerClient {
  private readonly explorer: SupportedExplorer;
  private readonly http: AxiosInstance;
  private readonly apiKey?: string;
  private readonly isSolana: boolean;

  constructor(chain: string) {
    const normalized = chain.toLowerCase();

    if (normalized.includes('solana') || normalized === 'sol') {
      this.explorer = 'solana';
      this.isSolana = true;
      this.http = axios.create({ timeout: 10_000 });
      return;
    }

    this.isSolana = false;

    if (normalized.includes('base')) {
      this.explorer = 'base';
    } else if (normalized.includes('eth')) {
      this.explorer = 'eth';
    } else {
      this.explorer = 'bsc';
    }

    const config = EXPLORER_CONFIG[this.explorer];
    this.apiKey = config?.apiKey;
    this.http = axios.create({
      baseURL: config?.baseUrl,
      timeout: 10_000,
    });
  }

  private canCall(): boolean {
    if (this.isSolana) return heliusClient.isAvailable();
    return Boolean(this.apiKey);
  }

  async getContractCreation(contractAddress: string): Promise<ContractCreationInfo | null> {
    // Solana: no contract creation concept via block explorer
    if (this.isSolana) return null;
    if (!this.canCall()) return null;

    try {
      const { data } = await this.http.get<ExplorerResponse<ContractCreationInfo[]>>('', {
        params: {
          module: 'contract',
          action: 'getcontractcreation',
          contractaddresses: contractAddress,
          apikey: this.apiKey,
        },
      });

      if (data.status !== '1' || !Array.isArray(data.result) || data.result.length === 0) {
        return null;
      }

      const info = data.result[0];
      return info;
    } catch (error) {
      console.warn(`[ExplorerClient] Failed to get contract creation for ${contractAddress}`, error);
      return null;
    }
  }

  async getTokenHolderConcentration(contractAddress: string, limit = 10): Promise<TokenHolderInfo[] | null> {
    // --- Solana: use Helius DAS API ---
    if (this.isSolana) {
      try {
        const holders = await heliusClient.getTopHolders(contractAddress, limit);
        if (!holders || holders.length === 0) return null;

        return holders.map((h: SolanaHolderInfo) => ({
          address: h.address,
          value: h.amount,
          percentage: h.percentage,
        }));
      } catch (error: any) {
        console.warn(`[ExplorerClient/Helius] Failed to get Solana holders for ${contractAddress}: ${error.message}`);
        return null;
      }
    }

    // --- EVM: use BscScan/EtherScan/BaseScan ---
    if (!this.canCall()) return null;

    try {
      const { data } = await this.http.get<ExplorerResponse<TokenHolderInfo[]>>('', {
        params: {
          module: 'token',
          action: 'tokenholderlist',
          contractaddress: contractAddress,
          page: 1,
          offset: limit,
          apikey: this.apiKey,
        },
      });

      if (data.status !== '1' || !Array.isArray(data.result)) {
        return null;
      }

      return data.result;
    } catch (error) {
      console.warn(`[ExplorerClient] Failed to get holder list for ${contractAddress}`, error);
      return null;
    }
  }
}
