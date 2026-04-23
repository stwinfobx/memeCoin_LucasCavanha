import axios from 'axios';
import { healthTracker } from '../utils/health';
import { DeFiScanner } from './defi-scanner';


export type SecurityVerdict = 'safe' | 'warning' | 'danger' | 'unknown';

export interface RugCheckHolder {
  address: string;
  pct: number;
  isInsider: boolean;
}

export interface SecurityConsensus {
  verdict: SecurityVerdict;
  isHoneypot: boolean;
  buyTax: number;
  sellTax: number;
  riskScore: number; // 0-100, where 0=safe and 100=very dangerous
  // On-chain authority state (populated by Helius/RPC layer, not here)
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  // Bundle / insider holder data from RugCheck full report
  rugcheckTopHolders?: RugCheckHolder[];
  sources: {
    goplus?: {
      checked: boolean;
      flagged: boolean;
      reason?: string;
      // EVM-specific fields from GoPlus
      isOpenSource?: boolean;
      ownerChangeBalance?: boolean;
      canTakeBackOwnership?: boolean;
      selfDestruct?: boolean;
      isBlacklisted?: boolean;
      ownerAddress?: string;
    };
    honeypotIs?: { checked: boolean; flagged: boolean; reason?: string };
    rugcheck?: { checked: boolean; score?: number; flagged: boolean; reason?: string };
    defiScanner?: { checked: boolean; flagged: boolean; score?: number; reason?: string };
  };
  issues: string[];
}

// --- GoPlus authenticated headers ---
function buildGoPlusHeaders(): Record<string, string> {
  const key = process.env.GOPLUS_API_KEY;
  if (key) {
    return { 'Authorization': `Bearer ${key}` };
  }
  return {};
}

// --- RugCheck authenticated headers ---
function buildRugCheckHeaders(): Record<string, string> {
  const key = process.env.RUGCHECK_API_KEY;
  if (key) {
    return { 'Authorization': `Bearer ${key}` };
  }
  return {};
}

/**
 * FreeSecurityProviders
 * Unified consensus engine using GoPlus, Honeypot.is, RugCheck, and De.Fi Scanner
 *
 * Verdict rules:
 * - 'danger':  Any single provider detects honeypot OR rug score > 700 OR ALL providers failed (safe-default)
 * - 'warning': Tax > 10% OR rug score 400-700 OR any provider is suspicious
 * - 'safe':    All providers agree token is reasonably clean
 * - 'unknown': Deprecated — now maps to 'danger' for safe-default
 */
export class FreeSecurityProviders {
  /**
   * Run full security consensus for EVM (BSC/Base)
   */
  static async checkEVM(
    tokenAddress: string,
    chainId: '56' | '8453' // 56=BSC, 8453=Base
  ): Promise<SecurityConsensus> {
    const issues: string[] = [];
    let isHoneypot = false;
    let buyTax = 0;
    let sellTax = 0;

    const sources: SecurityConsensus['sources'] = {};

    // --- 1. GoPlus (with API key) ---
    try {
      const goplusUrl = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${tokenAddress}`;
      const goplusResp = await axios.get(goplusUrl, {
        timeout: 7000,
        headers: buildGoPlusHeaders(),
      });
      const goplusData = goplusResp.data?.result?.[tokenAddress.toLowerCase()];

      if (goplusData && Object.keys(goplusData).length > 0) {
        const hp = goplusData.is_honeypot === '1';
        const bt = parseFloat(goplusData.buy_tax || '0');
        const st = parseFloat(goplusData.sell_tax || '0');
        const isProxy = goplusData.is_proxy === '1';
        const isMintable = goplusData.is_mintable === '1';
        const isOpenSource = goplusData.is_open_source === '1';
        const ownerChangeBalance = goplusData.owner_change_balance === '1';
        const canTakeBack = goplusData.can_take_back_ownership === '1';
        const selfDestruct = goplusData.self_destruct === '1';
        const isBlacklisted = goplusData.is_blacklisted === '1';
        const ownerAddress = goplusData.owner_address || undefined;

        if (hp) issues.push('GoPlus: HONEYPOT');
        if (bt > 10) issues.push(`GoPlus: High buy tax ${bt}%`);
        if (st > 10) issues.push(`GoPlus: High sell tax ${st}%`);
        if (isProxy) issues.push('GoPlus: Proxy contract (upgradable risk)');
        if (isMintable) issues.push('GoPlus: Mint authority active (inflation risk)');
        if (!isOpenSource) issues.push('GoPlus: Source code NOT verified');
        if (ownerChangeBalance) issues.push('GoPlus: Owner can change balances');
        if (canTakeBack) issues.push('GoPlus: Owner can reclaim ownership');
        if (selfDestruct) issues.push('GoPlus: Self-destruct capability');
        if (isBlacklisted) issues.push('GoPlus: Token has blacklist function');

        if (hp) isHoneypot = true;
        buyTax = Math.max(buyTax, bt);
        sellTax = Math.max(sellTax, st);

        sources.goplus = {
          checked: true,
          flagged: hp || bt > 10 || st > 10 || !isOpenSource || ownerChangeBalance,
          reason: [hp && 'Honeypot', bt > 10 && `BuyTax ${bt}%`, st > 10 && `SellTax ${st}%`, !isOpenSource && 'NotVerified', ownerChangeBalance && 'BalanceManip']
            .filter(Boolean)
            .join(', ') || undefined,
          isOpenSource,
          ownerChangeBalance,
          canTakeBackOwnership: canTakeBack,
          selfDestruct,
          isBlacklisted,
          ownerAddress,
        };
        healthTracker.reportSuccess('GOPLUS');
      } else {
        sources.goplus = { checked: false, flagged: false };
        healthTracker.reportSuccess('GOPLUS');
      }
    } catch (error: any) {
      if (error.response?.status === 429) {
        healthTracker.reportError('GOPLUS', 'max usage reached (429)', true);
      } else {
        healthTracker.reportError('GOPLUS', error.message || 'Unknown error');
      }
      sources.goplus = { checked: false, flagged: false };
    }

    // --- 2. Honeypot.is ---
    try {
      const honeypotUrl = `https://api.honeypot.is/v2/IsHoneypot?address=${tokenAddress}&chainID=${chainId}`;
      const honeypotResp = await axios.get(honeypotUrl, { timeout: 6000 });
      const honeypotData = honeypotResp.data;

      if (honeypotData) {
        const hp = honeypotData.isHoneypot === true || honeypotData.honeypotResult?.isHoneypot === true;
        const bt = parseFloat(honeypotData.simulationResult?.buyTax || '0');
        const st = parseFloat(honeypotData.simulationResult?.sellTax || '0');
        const simFailed = honeypotData.simulationSuccess === false;

        if (hp) issues.push('Honeypot.is: HONEYPOT');
        if (simFailed) issues.push('Honeypot.is: Simulation failed (suspicious)');
        if (bt > 10) issues.push(`Honeypot.is: High buy tax ${bt}%`);
        if (st > 10) issues.push(`Honeypot.is: High sell tax ${st}%`);

        if (hp) isHoneypot = true;
        buyTax = Math.max(buyTax, bt);
        sellTax = Math.max(sellTax, st);

        sources.honeypotIs = {
          checked: true,
          flagged: hp || simFailed || bt > 10 || st > 10,
          reason: [hp && 'Honeypot', simFailed && 'SimFailed', bt > 10 && `BuyTax ${bt}%`]
            .filter(Boolean)
            .join(', ') || undefined,
        };
      } else {
        sources.honeypotIs = { checked: true, flagged: false };
      }
    } catch {
      sources.honeypotIs = { checked: false, flagged: false };
    }

    // --- 3. De.Fi Scanner (third fallback — only if both GoPlus and Honeypot.is failed) ---
    const evmCheckedCount = [sources.goplus?.checked, sources.honeypotIs?.checked].filter(Boolean).length;
    if (evmCheckedCount === 0) {
      try {
        const defiResult = await FreeSecurityProviders.checkDeFiEVM(tokenAddress, chainId);
        if (defiResult) {
          sources.defiScanner = defiResult.source;
          if (defiResult.isHoneypot) {
            isHoneypot = true;
            issues.push('De.Fi: HONEYPOT detected');
          }
          issues.push(...defiResult.issues);
        } else {
          sources.defiScanner = { checked: false, flagged: false };
        }
      } catch {
        sources.defiScanner = { checked: false, flagged: false };
      }
    }

    return this.buildConsensus(isHoneypot, buyTax, sellTax, sources, issues);
  }

  /**
   * Run full security consensus for Solana
   */
  static async checkSolana(mintAddress: string): Promise<SecurityConsensus> {
    const issues: string[] = [];
    let isHoneypot = false;
    let buyTax = 0;
    let sellTax = 0;
    const sources: SecurityConsensus['sources'] = {};
    let rugcheckTopHolders: RugCheckHolder[] | undefined;

    const isPumpFun = mintAddress.endsWith('pump');

    // --- 1. GoPlus (Solana, with API key) ---
    try {
      const goplusUrl = `https://api.gopluslabs.io/api/v1/token_security/solana?contract_addresses=${mintAddress}`;
      const goplusResp = await axios.get(goplusUrl, {
        timeout: 7000,
        headers: buildGoPlusHeaders(),
      });
      const goplusData = goplusResp.data?.result?.[mintAddress.toLowerCase()];

      if (goplusData && Object.keys(goplusData).length > 0) {
        const hasFreeze = goplusData.freezeable === '1';
        const hasMint = goplusData.mintable === '1';

        if (hasFreeze) {
          issues.push('GoPlus: Freeze authority (tokens can be frozen)');
          // Freeze = honeypot on ALL tokens (including Pump.fun)
          isHoneypot = true;
        }

        if (hasMint) {
          issues.push('GoPlus: Mint authority active (inflation risk)');
          // Mint = honeypot only for NON-Pump.fun tokens
          // Pump.fun bonding curve legitimately holds mint authority during bonding
          if (!isPumpFun) {
            isHoneypot = true;
          }
        }

        sources.goplus = {
          checked: true,
          flagged: hasFreeze || hasMint,
          reason: [hasFreeze && 'FreezeAuth', hasMint && 'MintAuth'].filter(Boolean).join(', ') || undefined,
        };
        healthTracker.reportSuccess('GOPLUS');
      } else {
        sources.goplus = { checked: false, flagged: false };
        healthTracker.reportSuccess('GOPLUS');
      }
    } catch (error: any) {
      if (error.response?.status === 429) {
        healthTracker.reportError('GOPLUS', 'max usage reached (429)', true);
      } else {
        healthTracker.reportError('GOPLUS', error.message || 'Unknown error');
      }
      sources.goplus = { checked: false, flagged: false };
    }

    // --- 2. RugCheck FULL report (with API key for higher rate-limits and bundle data) ---
    try {
      // Use /report (full) instead of /report/summary — returns topHolders, insiders, bundle info
      const rugUrl = `https://api.rugcheck.xyz/v1/tokens/${mintAddress}/report`;
      const rugResp = await axios.get(rugUrl, {
        timeout: 8000,
        headers: buildRugCheckHeaders(),
      });
      const rugData = rugResp.data;

      if (rugData && typeof rugData.score === 'number') {
        const rugScore = rugData.score; // 0=good, 1000=rugged
        const rugRisks: string[] = (rugData.risks || []).map((r: any) => r.name).filter(Boolean);

        if (rugScore > 700) {
          issues.push(`RugCheck: HIGH RISK ${rugScore}/1000 — ${rugRisks.join(', ') || 'Multiple risks'}`);
          isHoneypot = true;
        } else if (rugScore > 400) {
          issues.push(`RugCheck: Moderate risk ${rugScore}/1000 — ${rugRisks.join(', ')}`);
        }

        // --- Extract bundle/insider holder data (only available in full /report endpoint) ---
        const topHoldersRaw: any[] = rugData.topHolders || [];
        if (topHoldersRaw.length > 0) {
          rugcheckTopHolders = topHoldersRaw.slice(0, 10).map((h: any) => ({
            address: h.address || 'unknown',
            pct: Number(h.pct || h.percentage || 0),
            isInsider: Boolean(h.insider || h.isInsider || false),
          }));

          // Check if insiders hold dangerous concentration
          const insiderTotal = rugcheckTopHolders
            .filter(h => h.isInsider)
            .reduce((acc, h) => acc + h.pct, 0);

          if (insiderTotal > 20) {
            issues.push(`RugCheck: Insider/Bundle wallets hold ${insiderTotal.toFixed(1)}% of supply`);
          }
        }

        sources.rugcheck = {
          checked: true,
          score: rugScore,
          flagged: rugScore > 400,
          reason: rugScore > 400 ? `Score ${rugScore}/1000` : undefined,
        };
      } else {
        sources.rugcheck = { checked: true, flagged: false };
      }
    } catch (error: any) {
      // Fallback to summary endpoint if full report fails (e.g. rate-limited even with key)
      try {
        const summaryUrl = `https://api.rugcheck.xyz/v1/tokens/${mintAddress}/report/summary`;
        const summaryResp = await axios.get(summaryUrl, { timeout: 6000 });
        const summaryData = summaryResp.data;
        if (summaryData && typeof summaryData.score === 'number') {
          const rugScore = summaryData.score;
          if (rugScore > 700) { isHoneypot = true; issues.push(`RugCheck(summary): HIGH RISK ${rugScore}/1000`); }
          else if (rugScore > 400) { issues.push(`RugCheck(summary): Moderate risk ${rugScore}/1000`); }
          sources.rugcheck = { checked: true, score: rugScore, flagged: rugScore > 400 };
        } else {
          sources.rugcheck = { checked: false, flagged: false };
        }
      } catch {
        sources.rugcheck = { checked: false, flagged: false };
      }
    }

    const consensus = this.buildConsensus(isHoneypot, buyTax, sellTax, sources, issues);

    // Attach bundle data to consensus result for use in risk-scoring
    if (rugcheckTopHolders && rugcheckTopHolders.length > 0) {
      consensus.rugcheckTopHolders = rugcheckTopHolders;
    }

    return consensus;
  }

  /**
   * De.Fi Scanner check for EVM (third fallback)
   * Delegates to the dedicated DeFiScanner module.
   * Only called when both GoPlus and Honeypot.is are unavailable.
   */
  private static async checkDeFiEVM(
    address: string,
    chainId: '56' | '8453'
  ): Promise<{
    isHoneypot: boolean;
    issues: string[];
    source: { checked: boolean; flagged: boolean; score?: number; reason?: string };
  } | null> {
    const result = await DeFiScanner.checkEVM(address, chainId);
    if (!result) return null;
    return {
      isHoneypot: result.isHoneypot,
      issues: result.issues,
      source: result.source,
    };
  }

  private static buildConsensus(
    isHoneypot: boolean,
    buyTax: number,
    sellTax: number,
    sources: SecurityConsensus['sources'],
    issues: string[]
  ): SecurityConsensus {
    const checkedCount = [
      sources.goplus?.checked,
      sources.honeypotIs?.checked,
      sources.rugcheck?.checked,
      sources.defiScanner?.checked,
    ].filter(Boolean).length;

    let riskScore = 30; // baseline for unknown token
    let verdict: SecurityVerdict;

    // --- SAFE-DEFAULT: If ALL providers failed, treat as dangerous ---
    // It's safer to reject an unverifiable token than to let it through.
    if (checkedCount === 0) {
      console.warn('[SecurityProviders] ⚠️ ALL providers failed — applying safe-default DANGER verdict.');
      return {
        verdict: 'danger',
        isHoneypot,
        buyTax,
        sellTax,
        riskScore: 90,
        sources,
        issues: [...issues, 'All security providers unavailable — safe-default rejection'],
      };
    }

    if (isHoneypot) {
      riskScore = 95;
      verdict = 'danger';
    } else {
      // Tax penalty
      riskScore += Math.min(40, (buyTax + sellTax) * 1.5);
      // Flagged source penalty
      const flaggedCount = [
        sources.goplus?.flagged,
        sources.honeypotIs?.flagged,
        sources.rugcheck?.flagged,
        sources.defiScanner?.flagged,
      ].filter(Boolean).length;
      riskScore += flaggedCount * 15;

      if (riskScore >= 70) verdict = 'danger';
      else if (riskScore >= 40) verdict = 'warning';
      else verdict = 'safe';
    }

    return {
      verdict,
      isHoneypot,
      buyTax,
      sellTax,
      riskScore: Math.min(100, Math.round(riskScore)),
      sources,
      issues,
    };
  }
}
