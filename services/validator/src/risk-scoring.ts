import { differenceInMinutes, differenceInSeconds } from 'date-fns';
import { Token, TokenRiskAssessment, RiskLevel } from '@shared/types';
import { ContractCreationInfo, TokenHolderInfo } from './providers/explorer';
import { SecurityConsensus } from './providers/FreeSecurityProviders';

// Configurable thresholds per User Rules v3 + Financial Safety Patch
const WASH_TRADING_RATIO = 100; // User rule: 100x ratio = -30 pts
const TOP10_CONCENTRATION_DANGER = 50; // >50% in Top 10 = -25 pts
const TOP1_WHALE_DANGER = 20; // Top 1 holder > 20% = -50 pts (Soft Rug)
const MIN_LIQUIDITY_USD = 500; // Tier 1: Reject if liquidity < $500
const MIN_VOLUME_USD = 100; // Tier 1: Reject if volume < $100
const MIN_HOLDERS_SAFE = 20; // User rule: <20 holders = penalty

export interface MarketPairData {
  pairAddress?: string;
  dexId?: string;
  liquidityUsd?: number;
  fdvUsd?: number;
  volume24hUsd?: number;
  priceUsd?: number;
  txCount5m?: number;
  txCount1h?: number;
  txCount6h?: number;
  priceChange5m?: number;
  priceChange1h?: number;
  priceChange6h?: number;
  pairCreatedAt?: number;
  baseTokenSymbol?: string;
  baseTokenName?: string;
}

export interface RiskComputationInput {
  token: Token;
  market: MarketPairData;
  isHoneypot: boolean;
  liquidityLocked: boolean;
  holdersCount: number;
  contractCreation?: ContractCreationInfo | null;
  topHolders?: TokenHolderInfo[] | null;
  // Security consensus results
  security?: SecurityConsensus;
  first_seen_at?: number; // Discovery timestamp fallback
}

const normalizeNumber = (value: number | undefined | null, defaultValue = 0): number =>
  Number.isFinite(value) ? Number(value) : defaultValue;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/**
 * Validator v3: Unified Scoring Engine
 * Focuses strictly on Mathematical Security and User Weights.
 */
export function computeRiskAssessment(input: RiskComputationInput): TokenRiskAssessment {
  const symbol = (input.market.baseTokenSymbol || input.token.symbol || 'TOKEN').toUpperCase();
  const isSolana = input.token.chain === 'SOLANA';
  let safetyScore = 65; // Base score (raised from 50 for sniping headroom)
  const rejectionReasons: string[] = [];

  // --- 1. IMMEDIATELY KILL (Score 0) ---
  if (input.isHoneypot) {
    console.log(`[RiskScoring] 💀 REJECTED ${symbol}: Honeypot Confirmed`);
    return shutDownWithScore(input, 0, 'Honeypot Confirmed');
  }

  // Solana: Check Mint/Freeze via GoPlus/RugCheck (stored in consensus issues/flags)
  if (isSolana && input.security?.isHoneypot) {
    console.log(`[RiskScoring] 💀 REJECTED ${symbol}: RugCheck/GoPlus Dangerous Flag`);
    return shutDownWithScore(input, 0, 'High Risk Solana Flag');
  }

  // --- TIER 1: FREE MARKET DATA FILTERS (Cost: 0 credits) ---
  const liquidityUsd = normalizeNumber(input.market.liquidityUsd);
  const volumeUsd = normalizeNumber(input.market.volume24hUsd);
  const fdvUsd = normalizeNumber(input.market.fdvUsd);

  // Liquidity Killswitch: Universal (all chains)
  if (liquidityUsd < MIN_LIQUIDITY_USD && !isSolana) {
    console.log(`[RiskScoring] 💀 REJECTED ${symbol}: Liquidity $${liquidityUsd} < $${MIN_LIQUIDITY_USD}`);
    return shutDownWithScore(input, 0, `Liquidity too low ($${liquidityUsd})`);
  }

  // Solana dynamic Tier 1: Relax 0-liq-killswitch for very fresh tokens (<120s)
  let ageSeconds = 0; // Default to 0 if no age data
  const now = new Date();
  let firstSeenDate: Date | null = null;
  if (input.contractCreation?.timestamp) {
    firstSeenDate = new Date(Number(input.contractCreation.timestamp) * 1000);
  } else if (input.market.pairCreatedAt) {
    firstSeenDate = new Date(input.market.pairCreatedAt);
  } else if (input.token.first_seen_at) {
    firstSeenDate = new Date(input.token.first_seen_at);
  } else if (input.first_seen_at) {
    firstSeenDate = new Date(input.first_seen_at);
  }

  if (firstSeenDate) {
    ageSeconds = differenceInSeconds(now, firstSeenDate);
  }

  if (isSolana) {
    if (liquidityUsd < 500 && fdvUsd < 5000) {
      if (ageSeconds > 300) { // Estendido de 120s para 300s (5 min) para carência de indexação
        console.log(`[RiskScoring] 💀 REJECTED ${symbol}: Solana Liq $${liquidityUsd} + MCAP $${fdvUsd} too low (Age: ${ageSeconds}s)`);
        return shutDownWithScore(input, 0, 'Solana Liq/MCAP too low');
      } else {
        console.log(`[RiskScoring] 🕒 INDEXING ${symbol}: Data not yet available (Age: ${ageSeconds}s). Deferring save.`);
        return {
          ...shutDownWithScore(input, 0, 'Indexing Data'),
          is_indexing: true
        };
      }
    }
  }

  // Volume filter: Avoid ghost/dead tokens
  // SNIPER FIX: Skip for very fresh Solana tokens (<5min) as volume indexing lags
  const skipVolumeFilter = isSolana && ageSeconds > 0 && ageSeconds < 300;
  
  if (!skipVolumeFilter && volumeUsd < MIN_VOLUME_USD && liquidityUsd < 1000) {
    console.log(`[RiskScoring] 💀 REJECTED ${symbol}: Volume $${volumeUsd} < $${MIN_VOLUME_USD} (ghost token)`);
    return shutDownWithScore(input, 0, `Ghost token (vol $${volumeUsd})`);
  }

  // REJECTION rule: Tax > 30%
  const maxTax = Math.max(input.security?.buyTax || 0, input.security?.sellTax || 0);
  if (maxTax > 30) {
    console.log(`[RiskScoring] 💀 REJECTED ${symbol}: Excessive Tax (${maxTax}%)`);
    return shutDownWithScore(input, 0, `Tax too high: ${maxTax}%`);
  }

  // --- 2. TIME RULES ---
  if (!firstSeenDate) {
    safetyScore -= 15;
    rejectionReasons.push('No age data (-15)');
  } else {
    const ageMin = differenceInMinutes(now, firstSeenDate);
    if (ageMin < 15) {
      safetyScore += 10;
      rejectionReasons.push('Fresh token bonus (+10)');
    } else if (ageMin <= 30) {
      safetyScore -= 8;
      rejectionReasons.push('15-30m age penalty (-8)');
    } else {
      safetyScore -= 20;
      rejectionReasons.push('Old token (>30m) penalty (-20)');
    }
  }

  // --- 3. FINANCIAL HEALTH ---

  if (!isSolana) {
    // BSC/Base Liquidity rules
    if (liquidityUsd > 0 && liquidityUsd < 5000) {
      safetyScore -= 15;
      rejectionReasons.push('Low liquidity (<$5k)');
    }
  } else {
    // Solana/Pump.fun MCAP rules
    if (fdvUsd < 20000) {
      safetyScore -= 10;
      rejectionReasons.push('Low MCAP (<$20k)');
    } else if (fdvUsd >= 20000 && fdvUsd <= 69000) {
      safetyScore += 10; // Bonus confidence
    }

    // Liquidity Bonuses (Encourage real backing)
    if (liquidityUsd >= 50000) {
      safetyScore += 20;
      rejectionReasons.push('Premium liquidity bonus (+20)');
    } else if (liquidityUsd >= 15000) {
      safetyScore += 15;
      rejectionReasons.push('Healthy liquidity bonus (+15)');
    } else if (liquidityUsd >= 5000) {
      safetyScore += 10;
      rejectionReasons.push('Moderate liquidity bonus (+10)');
    }
  }

  // Wash Trading
  const isWashTrading = liquidityUsd > 0 && volumeUsd > (WASH_TRADING_RATIO * liquidityUsd);
  if (isWashTrading) {
    safetyScore -= 30;
    rejectionReasons.push('Wash Trading Detected (-30)');
  }

  // --- 4. SECURITY (UNIFIED) ---
  if (input.security) {
    const s = input.security;
    
    // EVM Specifics (using structured GoPlus fields)
    if (!isSolana) {
      const g = s.sources.goplus;
      
      // KILLSWITCH: Unverified source code = cannot trust anything
      if (g?.checked && g.isOpenSource === false) {
        console.log(`[RiskScoring] 💀 REJECTED ${symbol}: Source code NOT verified on-chain`);
        return shutDownWithScore(input, 0, 'Contract NOT Verified (EVM)');
      }

      // Owner can change balances = critical manipulation risk
      if (g?.checked && g.ownerChangeBalance) {
        safetyScore -= 45;
        rejectionReasons.push('Owner can change balances (-45)');
      }

      // Self-destruct = rug pull risk
      if (g?.checked && g.selfDestruct) {
        safetyScore -= 35;
        rejectionReasons.push('Self-destruct capability (-35)');
      }

      // Can reclaim ownership after renouncing
      if (g?.checked && g.canTakeBackOwnership) {
        safetyScore -= 25;
        rejectionReasons.push('Owner can reclaim ownership (-25)');
      }

      // Blacklist function = can block your wallet from selling
      if (g?.checked && g.isBlacklisted) {
        safetyScore -= 15;
        rejectionReasons.push('Token has blacklist function (-15)');
      }

      // Proxy contract
      if (g?.checked && g.reason?.includes('Proxy')) {
        safetyScore -= 18;
        rejectionReasons.push('Proxy contract (-18)');
      }

      // Tax penalty
      if (maxTax > 10) {
        safetyScore -= 15;
        rejectionReasons.push(`High tax ${maxTax}% (-15)`);
      }

      // Low holders
      if (input.holdersCount < MIN_HOLDERS_SAFE && input.holdersCount > 0) {
        safetyScore -= 10;
        rejectionReasons.push('Low holder count (<20)');
      }
    }

    // Solana Specifics
    if (isSolana) {
      const g = s.sources.goplus;
      const r = s.sources.rugcheck;
      
      // Freeze/Mint Authority
      if (g?.reason?.includes('Freeze') || g?.reason?.includes('Mint')) {
        safetyScore -= 40;
        rejectionReasons.push('Freeze/Mint Auth Detected (-40)');
      }

      // RugCheck Score (Muffled for moderate risks to give sniping headroom)
      if (r?.score && r.score >= 700) {
        safetyScore -= 40;
        rejectionReasons.push(`RugCheck Score ${r.score} (-40)`);
      } else if (r?.score && r.score >= 500) {
        safetyScore -= 20; // Was -40, reduced for sniping
        rejectionReasons.push(`RugCheck Score ${r.score} (-20)`);
      } else if (r?.score && r.score >= 200) {
        safetyScore -= 10; // Was -25
        rejectionReasons.push(`RugCheck Score ${r.score} (-10)`);
      }
    }
  }

  // Holder Concentration (Universal) — Including Time-Scaled Whale Detection
  if (input.topHolders && input.topHolders.length > 0) {
    const ageMin = firstSeenDate ? Math.max(0, differenceInMinutes(now, firstSeenDate)) : 999;
    
    // Top 1 Whale check (Soft Rug protection) - SCALED BY TIME
    const top1Pct = Number(input.topHolders[0]?.percentage) || 0;
    if (top1Pct > TOP1_WHALE_DANGER) {
      let whalePenalty = 50; // Default (Old tokens)
      
      if (ageMin < 10) whalePenalty = 10; // Fresh tokens get a pass
      else if (ageMin < 30) whalePenalty = 25;
      
      safetyScore -= whalePenalty;
      rejectionReasons.push(`🐋 Top 1 holder owns ${top1Pct.toFixed(1)}% (-${whalePenalty}${ageMin < 30 ? ' scaled' : ''})`);
    }

    // Top 10 collective concentration - SCALED BY TIME
    const totalTop10 = input.topHolders
      .slice(0, 10)
      .reduce((acc, holder) => acc + (Number(holder.percentage) || 0), 0);
    
    if (totalTop10 > TOP10_CONCENTRATION_DANGER) {
      let concentrationPenalty = 25;
      
      if (ageMin < 10) concentrationPenalty = 5;
      else if (ageMin < 30) concentrationPenalty = 15;

      safetyScore -= concentrationPenalty;
      rejectionReasons.push(`High Top-10 Concentration ${totalTop10.toFixed(1)}% (-${concentrationPenalty}${ageMin < 30 ? ' scaled' : ''})`);
    }
  }

  const finalScore = clamp(safetyScore, 0, 100);
  const riskLevel = determineRiskLevel(finalScore);

  if (finalScore < 50 || rejectionReasons.length > 0) {
    console.log(`[RiskScoring] 📊 ${symbol} Score ${finalScore} | Reasons: ${rejectionReasons.join(', ') || 'None'}`);
  }

  return {
    contract_address: input.token.contract_address,
    chain: input.token.chain,
    memecoin_score: 0, // DEPRECATED
    risk_score: finalScore,
    scam_probability: 100 - finalScore,
    risk_level: riskLevel,
    indicators: {
      liquidityUsd,
      volume24hUsd: volumeUsd,
      fdvUsd,
      holdersCount: input.holdersCount,
      ageMinutes: firstSeenDate ? Math.max(0, differenceInMinutes(now, firstSeenDate)) : -1,
      honeypotDetected: input.isHoneypot,
      liquidityLocked: input.liquidityLocked,
      washTradingDetected: isWashTrading,
      rejectionReasons,
      topHolders: input.topHolders,
      securityVerdict: input.security?.verdict
    },
  };
}

function determineRiskLevel(score: number): RiskLevel {
  if (score <= 15) return 'critical';
  if (score <= 45) return 'high';
  if (score <= 75) return 'moderate';
  return 'low';
}

function shutDownWithScore(input: RiskComputationInput, score: number, reason: string): TokenRiskAssessment {
  return {
    contract_address: input.token.contract_address,
    chain: input.token.chain,
    memecoin_score: 0,
    risk_score: score,
    scam_probability: 100 - score,
    risk_level: 'critical',
    indicators: {
      rejectionReasons: [reason],
      honeypotDetected: input.isHoneypot || reason.includes('Honeypot'),
      securityVerdict: 'danger'
    }
  };
}
