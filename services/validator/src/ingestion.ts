import { ethers } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';
import { Pool } from 'pg';
import { TokenValidator, ValidationContext } from './validator';

const BSC_WS_URL = process.env.BSC_WS_URL;
const BASE_WS_URL = process.env.BASE_WS_URL;
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL;
const SOLANA_WS_URL = process.env.SOLANA_WS_URL;

const PANCAKE_FACTORY_V2 = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';
const UNISWAP_V2_FACTORY_BASE = '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6'; // Uniswap V2 Base Factory
const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfX9PNnZz4n9n9fpxc6';

const PAIR_CREATED_ABI = [
  'event PairCreated(address indexed token0, address indexed token1, address pair, uint)'
];

export interface MemecoinIngestionOptions {
  validator: TokenValidator;
  pool: Pool;
  intervalMs: number;
  freshnessMinutes: number;
}

export class MemecoinIngestion {
  private readonly validator: TokenValidator;
  private readonly pool: Pool;
  private readonly freshnessMinutes: number;
  private running = false;

  private evmProviders: { [network: string]: ethers.WebSocketProvider } = {};
  private solanaConnection?: Connection;
  private solanaSubscriptionId?: number;

  constructor(options: MemecoinIngestionOptions) {
    this.validator = options.validator;
    this.pool = options.pool;
    this.freshnessMinutes = Math.max(options.freshnessMinutes, 30);
  }

  start() {
    if (this.running) return;
    this.running = true;

    console.log(`🛰️ Memecoin Multichain Ingestion starting via WebSockets/Webhooks...`);

    this.monitorEVM('BSC', BSC_WS_URL || '', PANCAKE_FACTORY_V2);
    this.monitorEVM('Base', BASE_WS_URL || '', UNISWAP_V2_FACTORY_BASE);
    this.monitorSolana(SOLANA_RPC_URL || '', SOLANA_WS_URL || '');
  }

  stop() {
    this.running = false;
    Object.keys(this.evmProviders).forEach(network => {
      if (this.evmProviders[network].websocket && typeof (this.evmProviders[network].websocket as any).close === 'function') {
        try { (this.evmProviders[network].websocket as any).close(); } catch (e) { }
      }
    });

    if (this.solanaSubscriptionId) {
      clearInterval(this.solanaSubscriptionId as any);
      this.solanaSubscriptionId = undefined;
    }
  }

  private getTargetToken(chainId: string, token0: string, token1: string): string {
    const knownBaseTokens: { [chain: string]: string[] } = {
      'BSC': [
        '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', // WBNB
        '0xe9e7cea3dedca5984780bafc599bd69add087d56', // BUSD
        '0x55d398326f99059ff775485246999027b3197955'  // USDT
      ],
      'Base': [
        '0x4200000000000000000000000000000000000006', // WETH
        '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'  // USDC
      ]
    };

    const bases = knownBaseTokens[chainId] || [];
    if (bases.includes(token0.toLowerCase())) {
      return token1;
    }
    return token0;
  }

  private async processNewToken(chainId: string, tokenAddress: string, pairAddress: string, sourceDetails: string) {
    if (!this.running) return;

    try {
      console.log(`[Ingestion] 🔍 Processing new ${chainId} token: ${tokenAddress}`);

      // Check if we validated this token recently
      const shouldSkip = await this.shouldSkipToken(tokenAddress, chainId);
      if (shouldSkip) {
        console.log(`[Ingestion] ⏭️ Skipping ${tokenAddress} - already processed recently`);
        return;
      }

      const context: ValidationContext = {
        pairAddress: pairAddress,
        source: `websocket:${sourceDetails}`,
        rawListing: undefined,
      };

      const result = await this.validator.validateToken(tokenAddress, chainId, context);

      const label = `${result.token?.symbol || 'TOKEN'}-${chainId}`;
      const status = result.validation_result?.is_valid ? 'VALID' : 'WARN';
      console.log(`[Ingestion] ${status} ${label} | score=${result.validation_result?.safety_score ?? 0} | risk=${result.risk_assessment?.risk_level ?? 'n/a'}`);

      // Notify API Gateway for live streaming
      try {
        const payload = {
          token: result.token,
          risk: result.risk_assessment,
          validation: result.validation_result,
          chainId: chainId
        };
        await this.pool.query("SELECT pg_notify('new_token_scanned', $1)", [JSON.stringify(payload)]);
      } catch (notifyErr: any) {
        console.error(`[Ingestion] Failed to notify API gateway: ${notifyErr.message}`);
      }

      // TODO: In the execution refactoring phase, check if Admin is under "Monitoring Mode" or "Live Trading"
      // before dispatching the actual signal to the execution engine.
      // For now, validateToken inherently stores the token and generates signals via triggerSignal() internally.

    } catch (err: any) {
      console.error(`[Ingestion] ❌ Failed to process ${chainId} token ${tokenAddress}: ${err.message}`);
    }
  }

  private async shouldSkipToken(contract: string, chain: string): Promise<boolean> {
    try {
      const freshnessInterval = `${this.freshnessMinutes} minutes`;
      const result = await this.pool.query(
        `SELECT 1 FROM tokens 
             WHERE LOWER(contract_address) = $1 
               AND UPPER(chain) = $2
               AND validated_at > NOW() - ($3::text)::interval
             LIMIT 1`,
        [contract.toLowerCase(), chain.toUpperCase(), freshnessInterval]
      );
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      return false;
    }
  }

  private async monitorEVM(networkName: string, wsUrl: string, factoryAddress: string) {
    if (!wsUrl) {
      console.log(`[${networkName}] ❌ WS URL not configured in .env. Skipping...`);
      return;
    }

    try {
      const provider = new ethers.WebSocketProvider(wsUrl);
      this.evmProviders[networkName] = provider;
      const factory = new ethers.Contract(factoryAddress, PAIR_CREATED_ABI, provider);

      console.log(`[${networkName}] 🟢 Monitoring Factory ${factoryAddress}`);

      factory.on('PairCreated', async (token0: string, token1: string, pairAddress: string, pairIndex: any) => {
        const targetToken = this.getTargetToken(networkName, token0, token1);
        await this.processNewToken(networkName, targetToken, pairAddress, 'factory_event');
      });

      // Handle reconnects
      if (provider.websocket && typeof (provider.websocket as any).on === 'function') {
        (provider.websocket as any).on('close', () => {
          console.log(`[${networkName}] ⚠️ WebSocket closed. Reconnecting...`);
          setTimeout(() => {
            if (this.running) this.monitorEVM(networkName, wsUrl, factoryAddress);
          }, 5000);
        });
        (provider.websocket as any).on('error', (err: any) => {
          console.error(`[${networkName}] ❌ WebSocket Error: ${err.message}`);
        });
      }

    } catch (error: any) {
      console.error(`[${networkName}] ❌ Error connecting to WebSocket: ${error.message}`);
    }
  }

  private async monitorSolana(rpcUrl: string, wsUrl: string) {
    console.log(`[Solana] 🟢 Monitoring novas pools via GeckoTerminal Polling (Contornando Restrições RPC)...`);

    const pollGecko = async () => {
      if (!this.running) return;
      try {
        const url = `https://api.geckoterminal.com/api/v2/networks/solana/new_pools?include=base_token`;
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) return;

        const data = await res.json() as any;
        const pools = data?.data || [];
        const includes = data?.included || [];

        for (const pool of pools) {
          const baseTokenId = pool.relationships?.base_token?.data?.id;
          const baseTokenInfo = includes.find((i: any) => i.id === baseTokenId);
          const tokenAddr = baseTokenInfo?.attributes?.address || pool.attributes?.address;

          if (tokenAddr) {
            // processNewToken already skips internally if validated recently
            await this.processNewToken('Solana', tokenAddr, tokenAddr, 'gecko_polling');
          }
        }
      } catch (err: any) {
        // Silencioso para evitar poluição em caso de falha de conexão ou api limit
      }
    };

    if (this.running) {
      pollGecko();
      this.solanaSubscriptionId = setInterval(pollGecko, 10000) as any;
    }
  }
}
