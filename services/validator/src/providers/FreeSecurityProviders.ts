import axios from 'axios';

export type SecurityVerdict = 'safe' | 'warning' | 'danger' | 'unknown';

export interface SecurityConsensus {
    verdict: SecurityVerdict;
    isHoneypot: boolean;
    buyTax: number;
    sellTax: number;
    riskScore: number; // 0-100, where 0=safe and 100=very dangerous
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
    };
    issues: string[];
}

/**
 * FreeSecurityProviders
 * Unified consensus engine using GoPlus, Honeypot.is and RugCheck
 * 
 * Verdict rules:
 * - 'danger':  Any single provider detects honeypot OR rug score > 700
 * - 'warning': Tax > 10% OR rug score 400-700 OR any provider is suspicious
 * - 'safe':    All providers agree token is reasonably clean
 * - 'unknown': All providers failed (no data)
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

        // --- 1. GoPlus ---
        try {
            const goplusUrl = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${tokenAddress}`;
            const goplusResp = await axios.get(goplusUrl, { timeout: 7000 });
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
                if (isMintable) issues.push('GoPlus: Mint authority active');
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
            } else {
                sources.goplus = { checked: false, flagged: false };
            }
        } catch {
            sources.goplus = { checked: false, flagged: false };
        }

        // --- 2. Honeypot.is ---
        try {
            const chainMap: Record<string, string> = { '56': '56', '8453': '8453' };
            const honeypotUrl = `https://api.honeypot.is/v2/IsHoneypot?address=${tokenAddress}&chainID=${chainMap[chainId] || '1'}`;
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

        // --- 1. GoPlus (Solana) ---
        try {
            const goplusUrl = `https://api.gopluslabs.io/api/v1/token_security/solana?contract_addresses=${mintAddress}`;
            const goplusResp = await axios.get(goplusUrl, { timeout: 7000 });
            const goplusData = goplusResp.data?.result?.[mintAddress.toLowerCase()];

            if (goplusData && Object.keys(goplusData).length > 0) {
                const hasFreeze = goplusData.freezeable === '1';
                const hasMint = goplusData.mintable === '1';
                if (hasFreeze) { issues.push('GoPlus: Freeze authority (tokens can be frozen)'); isHoneypot = true; }
                if (hasMint) issues.push('GoPlus: Mint authority active (inflation risk)');

                sources.goplus = {
                    checked: true,
                    flagged: hasFreeze || hasMint,
                    reason: [hasFreeze && 'FreezeAuth', hasMint && 'MintAuth'].filter(Boolean).join(', ') || undefined,
                };
            } else {
                sources.goplus = { checked: false, flagged: false };
            }
        } catch {
            sources.goplus = { checked: false, flagged: false };
        }

        // --- 2. RugCheck ---
        try {
            const rugUrl = `https://api.rugcheck.xyz/v1/tokens/${mintAddress}/report/summary`;
            const rugResp = await axios.get(rugUrl, { timeout: 6000 });
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

                sources.rugcheck = {
                    checked: true,
                    score: rugScore,
                    flagged: rugScore > 400,
                    reason: rugScore > 400 ? `Score ${rugScore}/1000` : undefined,
                };
            } else {
                sources.rugcheck = { checked: true, flagged: false };
            }
        } catch {
            sources.rugcheck = { checked: false, flagged: false };
        }

        return this.buildConsensus(isHoneypot, buyTax, sellTax, sources, issues);
    }

    private static buildConsensus(
        isHoneypot: boolean,
        buyTax: number,
        sellTax: number,
        sources: SecurityConsensus['sources'],
        issues: string[]
    ): SecurityConsensus {
        const checkedCount = [sources.goplus?.checked, sources.honeypotIs?.checked, sources.rugcheck?.checked]
            .filter(Boolean).length;

        let riskScore = 30; // baseline for unknown token
        let verdict: SecurityVerdict = 'unknown';

        if (checkedCount === 0) {
            return { verdict: 'unknown', isHoneypot, buyTax, sellTax, riskScore: 50, sources, issues };
        }

        if (isHoneypot) {
            riskScore = 95;
            verdict = 'danger';
        } else {
            // Tax penalty
            riskScore += Math.min(40, (buyTax + sellTax) * 1.5);
            // Flagged source penalty
            const flaggedCount = [sources.goplus?.flagged, sources.honeypotIs?.flagged, sources.rugcheck?.flagged]
                .filter(Boolean).length;
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
