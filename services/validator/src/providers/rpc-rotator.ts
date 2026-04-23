import '../env';
import { Connection, PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';
import axios from 'axios';
import { SolanaHolderInfo, SolanaMintAuthority } from './helius';
import { solscanClient } from './solscan';
import { healthTracker } from '../utils/health';

/**
 * RpcRotator
 * Manages a pool of Solana RPC endpoints and rotates through them on failure.
 *
 * Pool priority:
 *   1. Helius (primary — enhanced APIs + DAS)
 *   2. Solscan (paid fallback for holder data)
 *   3. Triton One public mainnet (free, no key)
 *   4. Solana Labs public RPC (free, last resort)
 *
 * Cache: 5-minute TTL for holders, 10-minute for mint authority.
 * Errors: On 429, the offending RPC is soft-banned for 2 minutes before retry.
 */

const RPC_POOL: string[] = [
  process.env.HELIUS_RPC_URL || '',
  'https://mainnet.rpcpool.com',           // Triton One public
  'https://api.mainnet-beta.solana.com',   // Solana Labs public
].filter(Boolean);

// Per-RPC cooldown tracker (soft-ban on 429)
const rpcCooldowns = new Map<string, number>(); // rpcUrl → expiresAt ms
const RPC_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes

function isRpcAvailable(url: string): boolean {
  const cooldown = rpcCooldowns.get(url);
  if (!cooldown) return true;
  if (Date.now() > cooldown) {
    rpcCooldowns.delete(url);
    return true;
  }
  return false;
}

function banRpc(url: string): void {
  rpcCooldowns.set(url, Date.now() + RPC_COOLDOWN_MS);
  console.warn(`[RpcRotator] ⚠️ RPC ${url.substring(0, 40)}... soft-banned for 2 minutes.`);
}

function getAvailableRpcs(): string[] {
  return RPC_POOL.filter(isRpcAvailable);
}

// Simple in-memory cache
const cache = new Map<string, { data: any; expiresAt: number }>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.data as T;
  if (entry) cache.delete(key);
  return null;
}

function setCache(key: string, data: any, ttlMs: number): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  if (cache.size > 500) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
}

/**
 * Get top token holders, rotating through RPC pool on failures.
 * Falls back to Solscan API before hitting the public RPCs.
 */
export async function getTopHoldersWithRotation(
  mintAddress: string,
  limit = 20
): Promise<SolanaHolderInfo[] | null> {
  const cacheKey = `rot:holders:${mintAddress}`;
  const cached = getCached<SolanaHolderInfo[]>(cacheKey);
  if (cached) return cached;

  const availableRpcs = getAvailableRpcs();

  for (const rpcUrl of availableRpcs) {
    try {
      const http = axios.create({ timeout: 8000 });

      const accountsResp = await http.post(rpcUrl, {
        jsonrpc: '2.0',
        id: 'holder-check',
        method: 'getTokenLargestAccounts',
        params: [mintAddress],
      });

      const accounts = accountsResp.data?.result?.value || [];
      if (accounts.length === 0) continue;

      const supplyResp = await http.post(rpcUrl, {
        jsonrpc: '2.0',
        id: 'supply-check',
        method: 'getTokenSupply',
        params: [mintAddress],
      });

      const totalSupply = Number(supplyResp.data?.result?.value?.amount || '0');
      if (totalSupply === 0) continue;

      const holders: SolanaHolderInfo[] = accounts.slice(0, limit).map((acc: any) => ({
        address: acc.address || 'unknown',
        amount: acc.amount || '0',
        percentage: (Number(acc.amount || 0) / totalSupply) * 100,
      }));

      setCache(cacheKey, holders, 5 * 60 * 1000);
      if (rpcUrl.includes('helius')) healthTracker.reportSuccess('HELIUS');
      return holders;
    } catch (err: any) {
      const status = err.response?.status;
      if (status === 429 || err.message?.includes('429')) {
        banRpc(rpcUrl);
        if (rpcUrl.includes('helius')) healthTracker.reportError('HELIUS', '429', true);
      } else {
        console.warn(`[RpcRotator] RPC ${rpcUrl.substring(0, 40)}... failed: ${err.message}`);
      }
    }
  }

  // All RPCs failed — try Solscan as last resort for holders
  console.warn('[RpcRotator] All RPCs failed for holders, trying Solscan...');
  const solscanHolders = await solscanClient.getTopHolders(mintAddress, limit);
  if (solscanHolders) {
    setCache(cacheKey, solscanHolders, 5 * 60 * 1000);
    return solscanHolders;
  }

  return null;
}

/**
 * Get mint and freeze authority state, rotating through RPC pool.
 * Falls back to Solscan for mint authority metadata.
 */
export async function getMintAuthorityWithRotation(
  mintAddress: string
): Promise<SolanaMintAuthority | null> {
  const cacheKey = `rot:mint-auth:${mintAddress}`;
  const cached = getCached<SolanaMintAuthority>(cacheKey);
  if (cached) return cached;

  const availableRpcs = getAvailableRpcs();

  for (const rpcUrl of availableRpcs) {
    try {
      const connection = new Connection(rpcUrl, 'confirmed');
      const mintPubkey = new PublicKey(mintAddress);
      const mintInfo = await getMint(connection, mintPubkey);

      const result: SolanaMintAuthority = {
        mintAuthority: mintInfo.mintAuthority?.toBase58() || null,
        freezeAuthority: mintInfo.freezeAuthority?.toBase58() || null,
        isMintRenounced: mintInfo.mintAuthority === null,
        isFreezeRenounced: mintInfo.freezeAuthority === null,
      };

      setCache(cacheKey, result, 10 * 60 * 1000);
      if (rpcUrl.includes('helius')) healthTracker.reportSuccess('HELIUS');
      return result;
    } catch (err: any) {
      const status = err.response?.status;
      if (status === 429 || err.message?.includes('429')) {
        banRpc(rpcUrl);
        if (rpcUrl.includes('helius')) healthTracker.reportError('HELIUS', '429', true);
      } else {
        // 'TokenAccountNotFound' can mean it's a valid SPL token but mint failed parsing
        console.warn(`[RpcRotator] getMint via ${rpcUrl.substring(0, 40)}... failed: ${err.message}`);
      }
    }
  }

  // All RPCs failed — try Solscan for authority metadata
  console.warn('[RpcRotator] All RPCs failed for mint authority, trying Solscan...');
  const solscanAuth = await solscanClient.getMintAuthority(mintAddress);
  if (solscanAuth) {
    setCache(cacheKey, solscanAuth, 10 * 60 * 1000);
    return solscanAuth;
  }

  return null;
}

/** For use in health diagnostics */
export function getRpcPoolStatus(): { url: string; available: boolean; bannedFor?: string }[] {
  return RPC_POOL.map(url => {
    const cooldown = rpcCooldowns.get(url);
    const available = !cooldown || Date.now() > cooldown;
    return {
      url: url.substring(0, 50) + '...',
      available,
      bannedFor: !available && cooldown ? `${Math.ceil((cooldown - Date.now()) / 1000)}s` : undefined,
    };
  });
}
