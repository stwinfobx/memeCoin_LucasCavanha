import { differenceInHours } from 'date-fns';
import { Token, TokenRiskAssessment, RiskLevel } from '@shared/types';
import { ContractCreationInfo, TokenHolderInfo } from './providers/explorer';

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
}

const MEME_KEYWORDS = ['INU', 'DOGE', 'PEPE', 'FLOKI', 'SHIB', 'ELON', 'MOON', 'BABY', 'PUMP', 'APE', 'MOG', 'WIF', 'LADY', 'BOBO', 'DEGEN'];

const normalizeNumber = (value: number | undefined | null, defaultValue = 0): number =>
  Number.isFinite(value) ? Number(value) : defaultValue;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function calculateLiquidityScore(liquidityUsd: number): number {
  if (liquidityUsd <= 0) return 0.4;   // Desconhecido (token novo, API ainda não indexou)
  if (liquidityUsd <= 5_000) return 0.2;
  if (liquidityUsd <= 20_000) return 0.4;
  if (liquidityUsd <= 100_000) return 0.65;
  if (liquidityUsd <= 500_000) return 0.85;
  return 1;
}

function calculateVolumeScore(volumeUsd: number): number {
  if (volumeUsd <= 0) return 0.4;      // Desconhecido (token novo)
  if (volumeUsd <= 1_000) return 0.2;
  if (volumeUsd <= 5_000) return 0.4;
  if (volumeUsd <= 25_000) return 0.6;
  if (volumeUsd <= 100_000) return 0.8;
  return 0.95;
}

function calculateHolderScore(holdersCount: number): number {
  if (holdersCount <= 0) return 0.4;   // Desconhecido (token novo)
  if (holdersCount < 30) return 0.15;
  if (holdersCount < 100) return 0.35;
  if (holdersCount < 500) return 0.65;
  if (holdersCount < 2_000) return 0.85;
  return 1;
}

function calculateAgeScore(contractCreation: ContractCreationInfo | null, pairCreatedAt?: number): number {
  if (!contractCreation && !pairCreatedAt) {
    return 0.4;
  }

  const now = new Date();
  let firstSeenDate: Date | null = null;

  if (contractCreation?.timestamp) {
    firstSeenDate = new Date(Number(contractCreation.timestamp) * 1000);
  } else if (pairCreatedAt) {
    firstSeenDate = new Date(pairCreatedAt);
  }

  if (!firstSeenDate) {
    return 0.4;
  }

  const ageHours = differenceInHours(now, firstSeenDate);
  if (ageHours < 6) return 0.15;
  if (ageHours < 24) return 0.35;
  if (ageHours < 72) return 0.55;
  if (ageHours < 168) return 0.75;
  return 0.9;
}

function calculateHolderConcentration(topHolders?: TokenHolderInfo[] | null): number {
  if (!topHolders || topHolders.length === 0) {
    return 0.5;
  }

  const totalTop5 = topHolders
    .slice(0, 5)
    .reduce((acc, holder) => acc + (Number(holder.percentage) || 0), 0);

  if (totalTop5 >= 95) return 0.05;
  if (totalTop5 >= 80) return 0.2;
  if (totalTop5 >= 60) return 0.4;
  if (totalTop5 >= 40) return 0.6;
  if (totalTop5 >= 25) return 0.8;
  return 0.9;
}

function deriveMemecoinScore(input: RiskComputationInput): number {
  const { market, token } = input;
  const symbol = (market.baseTokenSymbol || token.symbol || '').toUpperCase();
  const name = (market.baseTokenName || token.name || '').toUpperCase();

  const keywordHit = MEME_KEYWORDS.some((keyword) => symbol.includes(keyword) || name.includes(keyword));
  const isShortSymbol = symbol.length <= 5;
  const isNew = calculateAgeScore(input.contractCreation || null, market.pairCreatedAt) <= 0.55;
  const lowLiquidity = normalizeNumber(market.liquidityUsd) < 250_000;
  const moderateFDV = normalizeNumber(market.fdvUsd) <= 50_000_000;

  let score = 40;

  if (keywordHit) score += 25;
  if (isShortSymbol) score += 10;
  if (isNew) score += 15;
  if (lowLiquidity) score += 5;
  if (moderateFDV) score += 5;

  const volatilityIndicators = [
    Math.abs(normalizeNumber(market.priceChange5m)),
    Math.abs(normalizeNumber(market.priceChange1h)),
    Math.abs(normalizeNumber(market.priceChange6h)),
  ];

  const highVolatility = volatilityIndicators.some((change) => change >= 50);
  if (highVolatility) score += 10;

  return clamp(score, 0, 100);
}

function determineRiskLevel(riskScore: number, scamProbability: number): RiskLevel {
  // Tier 1: Honeypot confirmado ou muito baixo score de segurança
  if (scamProbability >= 85 || riskScore <= 15) {
    return 'critical';
  }
  // Tier 2: Alto risco (suspeito)
  if (scamProbability >= 65 || riskScore <= 35) {
    return 'high';
  }
  // Tier 3: Risco moderado (token novo não verificado)
  if (scamProbability >= 45 || riskScore <= 55) {
    return 'moderate';
  }
  return 'low';
}

export function computeRiskAssessment(input: RiskComputationInput): TokenRiskAssessment {
  const liquidityScore = calculateLiquidityScore(normalizeNumber(input.market.liquidityUsd));
  const volumeScore = calculateVolumeScore(normalizeNumber(input.market.volume24hUsd));
  const holdersScore = calculateHolderScore(input.holdersCount);
  const ageScore = calculateAgeScore(input.contractCreation || null, input.market.pairCreatedAt);
  const holderConcentrationScore = calculateHolderConcentration(input.topHolders);

  const memecoinScore = deriveMemecoinScore(input);

  const honeypotPenalty = input.isHoneypot ? 0 : 1;
  // liquidityLockBonus: neutro (0.6) porque checkLiquidityLocked nunca foi implementado
  // Não punir tokens por algo que não verificamos
  const liquidityLockBonus = input.liquidityLocked ? 1 : 0.6;

  const safeScore =
    (liquidityScore * 0.22) +
    (volumeScore * 0.18) +
    (holdersScore * 0.15) +
    (ageScore * 0.12) +
    (holderConcentrationScore * 0.18) +
    (honeypotPenalty * 0.12) +
    (liquidityLockBonus * 0.03);

  const normalizedSafeScore = clamp(safeScore * 100, 0, 100);

  let scamProbability = 100 - normalizedSafeScore;

  // Penalizar honeypot confirmado fortemente
  if (input.isHoneypot) {
    scamProbability = Math.max(scamProbability, 95);
  }

  // Penalizar concentração extrema de holders (whale risk)
  if (input.topHolders && input.topHolders.length > 0) {
    const totalTop3 = input.topHolders
      .slice(0, 3)
      .reduce((acc, holder) => acc + (Number(holder.percentage) || 0), 0);
    if (totalTop3 >= 70) {
      scamProbability += 10;
    } else if (totalTop3 >= 50) {
      scamProbability += 6;
    }
  }

  scamProbability = clamp(scamProbability, 0, 100);

  const riskLevel = determineRiskLevel(normalizedSafeScore, scamProbability);

  const indicators = {
    liquidityUsd: normalizeNumber(input.market.liquidityUsd),
    volume24hUsd: normalizeNumber(input.market.volume24hUsd),
    fdvUsd: normalizeNumber(input.market.fdvUsd),
    holdersCount: input.holdersCount,
    honeypotDetected: input.isHoneypot,
    liquidityLocked: input.liquidityLocked,
    contractCreation: input.contractCreation,
    topHolders: input.topHolders,
    priceChange: {
      m5: normalizeNumber(input.market.priceChange5m),
      h1: normalizeNumber(input.market.priceChange1h),
      h6: normalizeNumber(input.market.priceChange6h),
    },
    txCount: {
      m5: input.market.txCount5m,
      h1: input.market.txCount1h,
      h6: input.market.txCount6h,
    },
    pairCreatedAt: input.market.pairCreatedAt,
  };

  return {
    contract_address: input.token.contract_address,
    chain: input.token.chain,
    memecoin_score: clamp(memecoinScore, 0, 100),
    risk_score: clamp(normalizedSafeScore, 0, 100),
    scam_probability: clamp(scamProbability, 0, 100),
    risk_level: riskLevel,
    indicators,
  };
}


