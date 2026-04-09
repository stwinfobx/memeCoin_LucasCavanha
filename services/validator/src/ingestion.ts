import { ethers } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';
import { Pool, Client } from 'pg';
import { TokenValidator, ValidationContext } from './validator';
import { SettingsManager } from './utils/settings';
import { heliusClient } from './providers/helius';
import { healthTracker } from './utils/health';

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

interface RetryState {
  attempts: number;
  lastAttempt: number;
  firstDiscovered: number; // For 5-minute timeout
}

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
  private settingsManager: SettingsManager;
  private dbClient?: Client;

  private evmProviders: { [network: string]: ethers.WebSocketProvider } = {};
  private solanaConnection?: Connection;
  private solanaSubscriptionId?: number;
  private retryMap: Map<string, RetryState> = new Map();

  constructor(options: MemecoinIngestionOptions) {
    this.validator = options.validator;
    this.pool = options.pool;
    this.freshnessMinutes = Math.max(options.freshnessMinutes, 30);
    this.settingsManager = new SettingsManager(this.pool);
    this.setupSettingsListener();
    this.startHeartbeat();
  }

  private startHeartbeat() {
    setInterval(async () => {
      try {
        const isActive = await this.settingsManager.getSetting('VALIDATOR_ENGINE_ACTIVE', 'true');
        if (isActive === 'true' && !this.running) {
          console.log('[Ingestion Heartbeat] 🟢 LIGANDO ENGINE (Recuperação de falha)...');
          this.start();
        } else if (isActive !== 'true' && this.running) {
          console.log('[Ingestion Heartbeat] 🔴 DESLIGANDO ENGINE (Recuperação de falha)...');
          this.stop();
        }
      } catch {}
    }, 60000); // Check a cada 60s
  }

  private async setupSettingsListener() {
    try {
      this.dbClient = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      });
      await this.dbClient.connect();
      await this.dbClient.query('LISTEN settings_changed');
      
      this.dbClient.on('notification', async (msg) => {
        if (msg.channel === 'settings_changed' && msg.payload) {
          const { key, value } = JSON.parse(msg.payload);
          console.log(`[Ingestion] Setting updated: ${key} = ${value}`);
          
          if (key === 'VALIDATOR_ENGINE_ACTIVE') {
            if (value === 'true' || value === true) {
              console.log('[Ingestion] 🟢 Reactivating engine via Admin command...');
              this.start();
            } else {
              console.log('[Ingestion] 🔴 Deactivating engine via Admin command...');
              this.stop();
            }
          }

          if (key === 'HELIUS_API_KEY') {
            console.log('[Ingestion] 🔑 Updating Helius API Key...');
            heliusClient.setApiKey(String(value));
          }

          // Atualiza cache local
          this.settingsManager.setSettingLocal(key, String(value));
        }
      });

      // Checagem inicial
      const isActive = await this.settingsManager.getSetting('VALIDATOR_ENGINE_ACTIVE', 'true');
      if (isActive !== 'true') {
        console.log('[Ingestion] ℹ️ Engine inactive by default in system_settings.');
        this.running = false;
      }
    } catch (error) {
      console.error('[Ingestion] Failed to setup DB listener:', error);
    }
  }

  async start() {
    if (this.running) return;
    
    // Verificar se pode ligar
    const isActive = await this.settingsManager.getSetting('VALIDATOR_ENGINE_ACTIVE', 'true');
    if (isActive !== 'true') {
      console.log('[Ingestion] ⚠️ Cannot start: Engine is disabled in Admin Panel.');
      return;
    }

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
      clearTimeout(this.solanaSubscriptionId as any);
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

      const retryState = this.retryMap.get(tokenAddress);
      const firstSeen = retryState?.firstDiscovered || Date.now();

      const context: ValidationContext = {
        pairAddress: pairAddress,
        source: `websocket:${sourceDetails}`,
        rawListing: undefined,
        first_seen_at: firstSeen,
      };

      const result = await this.validator.validateToken(tokenAddress, chainId, context);

      const label = `${result.token?.symbol || 'TOKEN'}-${chainId}`;
      const status = result.validation_result?.is_valid ? 'VALID' : 'WARN';
      const holders = result.token?.holders_count ?? 0;

      const safetyScore = result.validation_result?.safety_score ?? 0;
      const isIndexing = result.validation_result?.is_indexing || false;

      console.log(`[Ingestion] ${status} ${label} | score=${safetyScore} | holders=${holders} | risk=${result.risk_assessment?.risk_level ?? 'n/a'} ${isIndexing ? '(INDEXING)' : ''}`);

      // --- Retry Logic (Indexing or 0 Holders) ---
      const now = Date.now();
      const firstDiscovered = retryState?.firstDiscovered || now;
      const ageSeconds = (now - firstDiscovered) / 1000;

      // 1. Indexing Retry: If validator said 'indexing' and we are under 5 mins
      if (isIndexing && ageSeconds < 300 && this.running) {
        console.log(`[Ingestion] 🕒 Indexing in progress for ${label} (Age: ${ageSeconds.toFixed(0)}s). Retrying in 60s...`);
        this.retryMap.set(tokenAddress, { 
          attempts: (retryState?.attempts || 0) + 1, 
          lastAttempt: now,
          firstDiscovered: firstDiscovered
        });
        
        setTimeout(async () => {
          if (!this.running) return;
          await this.processNewToken(chainId, tokenAddress, pairAddress, `${sourceDetails}:indexing_retry`);
        }, 60_000); // 1 minute delay for indexing
        return; // Don't notify API yet
      }

      // 2. Holder Re-validation Logic: Original logic for 0 holders
      if (holders === 0 && ageSeconds < 300 && (!retryState || retryState.attempts < 3) && this.running) {
        console.log(`[Ingestion] 🕒 Holders indexer lag detected for ${label}. Scheduling re-validation in 120s...`);
        this.retryMap.set(tokenAddress, { 
          attempts: (retryState?.attempts || 0) + 1, 
          lastAttempt: now,
          firstDiscovered: firstDiscovered
        });
        
        setTimeout(async () => {
          if (!this.running) return;
          await this.processNewToken(chainId, tokenAddress, pairAddress, `${sourceDetails}:holder_retry`);
        }, 120_000);
      }

      // Clean up retry state if we completed successfully or timed out
      if (!isIndexing || ageSeconds >= 300) {
        this.retryMap.delete(tokenAddress);
      }

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
    console.log(`[Solana] 🟢 Monitoring novas pools via GeckoTerminal Polling (with exponential backoff)...`);

    let baseIntervalMs = 10_000;   // Start: 10s
    let currentIntervalMs = baseIntervalMs;
    const MAX_INTERVAL_MS = 5 * 60 * 1000; // Max: 5 minutes
    let consecutiveFailures = 0;

    const pollGecko = async () => {
      if (!this.running) return;
      try {
        const url = `https://api.geckoterminal.com/api/v2/networks/solana/new_pools?include=base_token`;
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });

        if (!res.ok) {
          consecutiveFailures++;
          const status = res.status;
          if (status === 429) {
            console.warn(`[Solana] ⚠️ GeckoTerminal rate limited (429). Backing off... (failures: ${consecutiveFailures})`);
            healthTracker.reportError('GECKO', 'max usage reached (429)', true);
          } else if (status === 403) {
            console.warn(`[Solana] 🚫 GeckoTerminal access denied (403). Check IP/proxy.`);
            healthTracker.reportError('GECKO', 'Forbidden (403)');
          } else {
            console.warn(`[Solana] ⚠️ GeckoTerminal HTTP ${status}. Backing off...`);
            healthTracker.reportError('GECKO', `HTTP ${status}`);
          }
          // Exponential backoff
          currentIntervalMs = Math.min(MAX_INTERVAL_MS, currentIntervalMs * 2);
          this.reschedulePolling(pollGecko, currentIntervalMs);
          return;
        }

        const data = await res.json() as any;
        const pools = data?.data || [];
        const includes = data?.included || [];

        // Success: reset backoff
        if (consecutiveFailures > 0) {
          console.log(`[Solana] ✅ GeckoTerminal recovered after ${consecutiveFailures} failures.`);
        }
        consecutiveFailures = 0;
        currentIntervalMs = baseIntervalMs;
        healthTracker.reportSuccess('GECKO');

        for (const pool of pools) {
          const baseTokenId = pool.relationships?.base_token?.data?.id;
          const baseTokenInfo = includes.find((i: any) => i.id === baseTokenId);
          const tokenAddr = baseTokenInfo?.attributes?.address || pool.attributes?.address;

          if (tokenAddr) {
            await this.processNewToken('Solana', tokenAddr, tokenAddr, 'gecko_polling');
          }
        }
      } catch (err: any) {
        consecutiveFailures++;
        if (consecutiveFailures <= 3 || consecutiveFailures % 10 === 0) {
          console.warn(`[Solana] ⚠️ Gecko poll error (failure #${consecutiveFailures}): ${err.message}`);
        }
        healthTracker.reportError('GECKO', err.message || 'Network error');
        currentIntervalMs = Math.min(MAX_INTERVAL_MS, currentIntervalMs * 2);
      }

      // Schedule next poll
      this.reschedulePolling(pollGecko, currentIntervalMs);
    };

    if (this.running) {
      pollGecko();
    }
  }

  private reschedulePolling(fn: () => Promise<void>, intervalMs: number) {
    if (!this.running) return;
    if (this.solanaSubscriptionId) {
      clearTimeout(this.solanaSubscriptionId as any);
    }
    this.solanaSubscriptionId = setTimeout(fn, intervalMs) as any;
  }
}
