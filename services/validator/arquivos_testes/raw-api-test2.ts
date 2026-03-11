/**
 * raw-api-test2.ts — Diagnóstico v2
 *
 * Melhorias em relação ao v1:
 *  1. Solana via Helius WS na FEE ACCOUNT da Pump.fun (funciona sem bloqueio)
 *     + Enhanced API REST da Helius para parsear mints criados
 *  2. Retry automático: não exibe nem salva resultado até ter dados reais
 *     (liquidez, preço, criação). Tenta até 5 vezes com espera crescente.
 *  3. Scoring PESADO e conservador (começa em 50, vai subindo só com evidências reais)
 *     — Penaliza volume alto com liquidez baixa (sinal clássico de wash trading)
 *     — Penaliza tokens com idade > 30min (não queremos velhos)
 *     — Penaliza se não conseguimos saber a idade (dado ausente = risco)
 *     — Penaliza mintable, freezable, honeypot, taxas altas, rug score alto
 *     — Bônus apenas quando TODOS os checks positivos confirmados
 *  4. Limiar de compra: score >= 80 (antes era >= 50)
 *  5. Exibe idade do token com clareza no terminal
 *
 * Uso: npx tsx raw-api-test2.ts
 */

import { ethers } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// ============================================================
// CONFIG
// ============================================================

const RESULTS_FILE = path.join(__dirname, 'raw-api-test2.json');
const results: any[] = [];
const capturedTokens = new Set<string>();

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || 'c0e8b22b-7ba2-425a-b501-83ce58400f19';
const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const HELIUS_WS = `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const HELIUS_API = `https://api-mainnet.helius-rpc.com`;

const BSC_WS = process.env.BSC_WS_URL || 'wss://bsc.publicnode.com';
const BASE_WS = process.env.BASE_WS_URL || 'wss://alpha-convincing-hill.base-mainnet.quiknode.pro/4e2de075fd52bc19ba81fadbbb30db1083a6f28c/';

// Pump.fun fee account — recebe TODA transação de criação/swap, WS funciona sem bloqueio
const PUMP_FEE_ACCOUNT = 'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM';

// Limiares de decisão
const BUY_THRESHOLD = 80;   // nota mínima para "BOT COMPRARIA"
const MAX_TOKEN_AGE_MIN = 30;   // tokens mais velhos que isso são penalizados
const IDEAL_TOKEN_AGE_MIN = 15;   // acima disso já perde bônus de frescor

// Retry config para aguardar indexação das APIs
const RETRY_DELAYS_MS = [15_000, 30_000, 60_000, 90_000]; // Reduzido para teste BSC/Base // 30s, 1min, 1.5min, 2min

// ============================================================
// SAVE
// ============================================================

function saveResult(data: any) {
    results.push(data);
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
    console.log(`\n💾 Salvo em ${path.basename(RESULTS_FILE)} — ${data.chain} ${data.token.slice(0, 12)}...`);
}

// ============================================================
// APIS
// ============================================================

async function apiGoPlus(chain: string, chainId: string, token: string) {
    try {
        const base = 'https://api.gopluslabs.io/api/v1/token_security';
        const url = chain === 'Solana'
            ? `${base}/solana?contract_addresses=${token}`
            : `${base}/${chainId}?contract_addresses=${token}`;
        const res = await axios.get(url, { timeout: 12000 });
        return res.data?.result?.[token.toLowerCase()] || res.data?.result || {};
    } catch (e: any) { return { error: e.message }; }
}

async function apiHoneypotIs(chainId: string, token: string) {
    try {
        const res = await axios.get(
            `https://api.honeypot.is/v2/IsHoneypot?address=${token}&chainID=${chainId}`,
            { timeout: 12000 }
        );
        return res.data;
    } catch (e: any) { return { error: e.message }; }
}

async function apiRugCheck(token: string) {
    try {
        const res = await axios.get(
            `https://api.rugcheck.xyz/v1/tokens/${token}/report/summary`,
            { timeout: 12000 }
        );
        return res.data;
    } catch (e: any) { return { error: e.message }; }
}

async function apiGecko(network: string, token: string) {
    try {
        const res = await axios.get(
            `https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${token}`,
            { timeout: 12000, headers: { Accept: 'application/json' } }
        );
        return res.data?.data?.attributes || {};
    } catch (e: any) { return { error: e.message }; }
}

async function apiDexScreener(token: string): Promise<any> {
    try {
        const res = await axios.get(
            `https://api.dexscreener.com/latest/dex/tokens/${token}`,
            { timeout: 12000, headers: { Accept: 'application/json' } }
        );
        if (res.data?.pairs?.length > 0) {
            return res.data.pairs.sort((a: any, b: any) =>
                (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
            )[0];
        }
        return { error: 'Not found' };
    } catch (e: any) { return { error: e.message }; }
}

// Helius Enhanced Transactions — parseia mints criados em uma tx da Pump.fun
async function heliusGetMints(signature: string): Promise<string[]> {
    try {
        const res = await axios.post(
            `${HELIUS_API}/v0/transactions/?api-key=${HELIUS_API_KEY}`,
            { transactions: [signature] },
            { timeout: 15000 }
        );
        const txs = res.data as any[];
        if (!txs || txs.length === 0) return [];

        const mints: string[] = [];
        const tx = txs[0];

        // Enhanced API retorna tokenTransfers e instructions com informações de mint
        const transfers: any[] = tx.tokenTransfers || [];
        const preBalances = new Set<string>(
            (tx.accountData || [])
                .filter((a: any) => a.tokenBalanceChanges?.length > 0)
                .flatMap((a: any) => a.tokenBalanceChanges.map((t: any) => t.mint))
        );

        for (const tf of transfers) {
            if (tf.mint && !preBalances.has(tf.mint)
                && tf.mint !== 'So11111111111111111111111111111111111111112') {
                mints.push(tf.mint);
            }
        }

        // Fallback: olha as instruções de CREATE ACCOUNT / INIT MINT
        const instructions: any[] = tx.instructions || [];
        for (const ix of instructions) {
            if (ix.accounts) {
                for (const acc of ix.accounts) {
                    if (typeof acc === 'string' && acc.endsWith('pump') && !mints.includes(acc)) {
                        mints.push(acc);
                    }
                }
            }
        }

        return [...new Set(mints)];
    } catch (e: any) {
        return [];
    }
}

// ============================================================
// COLETA COM RETRY INTELIGENTE
// ============================================================

interface MarketData {
    priceUsd: number;
    liquidityUsd: number;
    fdvUsd: number;        // market cap / FDV (Pump.fun usa bonding curve, não liq convencional)
    volumeH24: number;
    volumeH1: number;
    volumeM5: number;
    txns24hBuys: number;
    txns24hSells: number;
    pairCreatedAt: number | null; // unix ms
    dexId: string;
    source: string; // 'dexscreener' | 'gecko' | 'none'
    isPumpFun: boolean;
}

async function fetchMarketDataWithRetry(token: string, maxRetries = 4): Promise<MarketData> {
    const empty: MarketData = {
        priceUsd: 0, liquidityUsd: 0, fdvUsd: 0, volumeH24: 0, volumeH1: 0, volumeM5: 0,
        txns24hBuys: 0, txns24hSells: 0,
        pairCreatedAt: null, dexId: '', source: 'none', isPumpFun: false
    };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        // Primeira tentativa é imediata, as demais esperam
        if (attempt > 0) {
            const delay = RETRY_DELAYS_MS[attempt - 1] ?? 120_000;
            console.log(`  ⏳ Aguardando ${delay / 1000}s para indexação... (tentativa ${attempt}/${maxRetries})`);
            await new Promise(r => setTimeout(r, delay));
        }

        // Tenta DexScreener primeiro (mais rápido para memes)
        const dex = await apiDexScreener(token);
        if (!dex.error && dex.priceUsd && parseFloat(dex.priceUsd) > 0) {
            const dexId = dex.dexId || '';
            return {
                priceUsd: parseFloat(dex.priceUsd || '0'),
                liquidityUsd: parseFloat(dex.liquidity?.usd || '0'),
                fdvUsd: parseFloat(dex.fdv || dex.marketCap || '0'),
                volumeH24: parseFloat(dex.volume?.h24 || '0'),
                volumeH1: parseFloat(dex.volume?.h1 || '0'),
                volumeM5: parseFloat(dex.volume?.m5 || '0'),
                txns24hBuys: dex.txns?.h24?.buys || 0,
                txns24hSells: dex.txns?.h24?.sells || 0,
                pairCreatedAt: dex.pairCreatedAt || null,
                dexId,
                source: 'dexscreener',
                isPumpFun: dexId === 'pumpfun' || token.endsWith('pump')
            };
        }

        // Fallback: GeckoTerminal
        // Heurística de rede: endereços Solana não têm '0x' e tendem a ser mais longos (base58)
        const isSolanaToken = !token.startsWith('0x');
        const network = isSolanaToken ? 'solana' : (token.length > 42 ? 'bsc' : 'base');
        const gecko = await apiGecko(network, token);
        if (!gecko.error && gecko.base_token_price_usd && parseFloat(gecko.base_token_price_usd) > 0) {
            return {
                priceUsd: parseFloat(gecko.base_token_price_usd || '0'),
                liquidityUsd: parseFloat(gecko.reserve_in_usd || gecko.liquidity_usd || '0'),
                fdvUsd: parseFloat(gecko.fdv_usd || '0'),
                volumeH24: parseFloat(gecko.volume_usd?.h24 || '0'),
                volumeH1: parseFloat(gecko.volume_usd?.h1 || '0'),
                volumeM5: parseFloat(gecko.volume_usd?.m5 || '0'),
                txns24hBuys: 0,
                txns24hSells: 0,
                pairCreatedAt: gecko.pool_created_at ? Date.parse(gecko.pool_created_at) : null,
                dexId: 'gecko',
                source: 'gecko',
                isPumpFun: token.endsWith('pump')
            };
        }
    }

    // Esgotou retries — retorna vazio
    return empty;
}

// ============================================================
// SCORING PESADO
// ============================================================

interface ScoreResult {
    score: number;
    issues: string[];
    warnings: string[];
    buySignal: boolean;
}

// Helper simples para usar dentro do scoring (sem depender do fmtMoney do display)
function fmtMoneySimple(v: number): string {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
    return `$${v.toFixed(0)}`;
}

function computeScore(
    chain: string,
    market: MarketData,
    goplus: any,
    honeypot: any,
    rugcheck: any,
    foundAtMs: number
): ScoreResult {
    // Score começa neutro — precisa GANHAR pontos, não apenas não perder
    let score = 50;
    const issues: string[] = [];
    const warnings: string[] = [];

    // ── 1. IDADE DO TOKEN ─────────────────────────────────────────────
    const ageMs = market.pairCreatedAt ? (foundAtMs - market.pairCreatedAt) : null;
    const ageMin = ageMs !== null ? Math.round(ageMs / 60000) : null;

    if (ageMin === null) {
        issues.push('IDADE_DESCONHECIDA');
        score -= 15; // não sabemos quando nasceu = risco
    } else if (ageMin > MAX_TOKEN_AGE_MIN) {
        issues.push(`MUITO_ANTIGO:${ageMin}min`);
        score -= 20; // passou do prazo ideal
    } else if (ageMin > IDEAL_TOKEN_AGE_MIN) {
        warnings.push(`${ageMin}min de vida (acima do ideal de ${IDEAL_TOKEN_AGE_MIN}min)`);
        score -= 8;
    } else {
        score += 10; // Fresquinho ✅
    }

    // ── 2. LIQUIDEZ / FDV (Pump.fun usa bonding curve — sem liq convencional) ──────────
    if (market.isPumpFun) {
        // Para Pump.fun, usamos FDV/market cap como proxy de liquidez
        const cap = market.fdvUsd || market.liquidityUsd;
        if (cap <= 0) { issues.push('FDV_ZERO'); score -= 20; }
        else if (cap < 5_000) { issues.push(`FDV_MUITO_BAIXO:$${cap.toFixed(0)}`); score -= 10; }
        else if (cap < 20_000) { warnings.push(`FDV baixo: $${(cap / 1000).toFixed(1)}k`); score -= 3; }
        else if (cap < 690_000) { score += 8; } // bonding curve saudável
        else { warnings.push(`FDV perto do teto BondingCurve (~$69k migra pra Raydium)`); }

        // Transações: sinal de interesse real
        const totalTxns = market.txns24hBuys + market.txns24hSells;
        if (totalTxns > 100) { score += 5; }
        if (market.txns24hBuys > market.txns24hSells * 1.5) { score += 5; } // pressão compradora
    } else {
        // EVM: liquidez convencional de pool
        if (market.liquidityUsd <= 0) {
            issues.push('LIQUIDEZ_ZERO');
            score -= 25;
        } else if (market.liquidityUsd < 500) {
            warnings.push(`Liquidez muito baixa: $${market.liquidityUsd.toFixed(0)}`);
            score -= 10;
        } else if (market.liquidityUsd < 5_000) {
            warnings.push(`Liquidez baixa: $${market.liquidityUsd.toFixed(0)}`);
            score -= 5;
        } else if (market.liquidityUsd >= 5_000) {
            score += 10;
        }
    }

    // ── 3. VOLUME vs LIQUIDEZ (wash trading / golpe) ──────────────────
    // Volume muito maior que a liquidez é sinal claro de wash trading artificial
    if (market.liquidityUsd > 0 && market.volumeH24 > 0) {
        const ratio = market.volumeH24 / market.liquidityUsd;
        if (ratio > 500) {
            issues.push(`WASH_TRADING:vol/liq=${ratio.toFixed(0)}x`);
            score -= 30; // golpe clássico: volume de $10M com liq de $0.2
        } else if (ratio > 100) {
            issues.push(`VOLUME_SUSPEITO:vol/liq=${ratio.toFixed(0)}x`);
            score -= 15;
        } else if (ratio > 20) {
            warnings.push(`Volume alto vs liquidez (ratio: ${ratio.toFixed(0)}x)`);
            score -= 5;
        }
    }

    // ── 4. VOLUME ZERADO ──────────────────────────────────────────────
    if (market.volumeH24 === 0 && market.source !== 'none') {
        warnings.push('Volume 24h zerado');
        // Não penaliza pesado — pode ser token muito novo
    }

    // ── 5. GOPLUS (checagem completa EVM/Solana) ────────────────────────────
    const gp = goplus;
    const gpHasData = gp && !gp.error && Object.keys(gp).filter(k => k !== 'error').length > 2;

    if (gpHasData) {
        if (chain === 'Solana') {
            if (gp.freezeable === '1') { issues.push('FREEZABLE'); score -= 40; }
            if (gp.mintable === '1') { issues.push('MINTABLE'); score -= 20; }
            if (gp.freezeable === '0' && gp.mintable === '0') { score += 15; }
        } else {
            // CRÍTICO
            if (gp.is_honeypot === '1') { issues.push('HONEYPOT_GOPLUS'); score -= 55; }
            if (gp.cannot_sell_all === '1') { issues.push('NAO_PODE_VENDER'); score -= 50; }
            if (gp.owner_change_balance === '1') { issues.push('DONO_ALTERA_SALDO'); score -= 45; }
            if (gp.selfdestruct === '1') { issues.push('SELF_DESTRUCT'); score -= 35; }
            if (gp.hidden_owner === '1') { issues.push('OWNER_OCULTO'); score -= 30; }
            if (gp.transfer_pausable === '1') { issues.push('TRANSFER_PAUSAVEL'); score -= 25; }
            if (gp.slippage_modifiable === '1') { issues.push('SLIPPAGE_MODIFICAVEL'); score -= 20; }
            if (gp.can_take_back_ownership === '1') { issues.push('OWNER_PODE_RETOMAR'); score -= 20; }
            if (gp.is_proxy === '1') { issues.push('CONTRATO_PROXY'); score -= 18; }
            if (gp.external_call === '1') { issues.push('EXTERNAL_CALL'); score -= 15; }
            if (gp.is_mintable === '1') { issues.push('MINTABLE'); score -= 15; }
            // MÉDIO
            if (gp.trading_cooldown === '1') { warnings.push('Cooldown de trading'); score -= 10; }
            if (gp.anti_whale_modifiable === '1') { warnings.push('Anti-whale modificável'); score -= 8; }
            // TAXAS
            const buyTax = parseFloat(gp.buy_tax || '0');
            const sellTax = parseFloat(gp.sell_tax || '0');
            if (buyTax > 0.30) { issues.push(`TAXA_COMPRA_CRITICA:${(buyTax * 100).toFixed(0)}%`); score -= 30; }
            else if (buyTax > 0.10) { issues.push(`TAXA_COMPRA:${(buyTax * 100).toFixed(0)}%`); score -= 15; }
            else if (buyTax > 0.05) { warnings.push(`Taxa compra:${(buyTax * 100).toFixed(1)}%`); score -= 5; }
            if (sellTax > 0.30) { issues.push(`TAXA_VENDA_CRITICA:${(sellTax * 100).toFixed(0)}%`); score -= 30; }
            else if (sellTax > 0.10) { issues.push(`TAXA_VENDA:${(sellTax * 100).toFixed(0)}%`); score -= 15; }
            else if (sellTax > 0.05) { warnings.push(`Taxa venda:${(sellTax * 100).toFixed(1)}%`); score -= 5; }
            // HOLDERS
            const holders = parseInt(gp.holder_count || '0');
            if (holders === 0) { issues.push('ZERO_HOLDERS'); score -= 20; }
            else if (holders < 5) { issues.push(`APENAS_${holders}_HOLDERS`); score -= 15; }
            else if (holders < 20) { warnings.push(`Poucos holders: ${holders}`); score -= 5; }
            else { score += 5; }
            // CÓDIGO
            if (gp.is_open_source === '0') { warnings.push('CÓDIGO_FECHADO'); score -= 8; }
            else if (gp.is_open_source === '1') { score += 5; }
            if (gp.is_in_dex === '0') { warnings.push('FORA_DE_DEX'); score -= 5; }
            // BÔNUS: passou em todos os checks críticos
            const passedAll = gp.is_honeypot === '0'
                && gp.cannot_sell_all !== '1' && gp.hidden_owner !== '1'
                && gp.owner_change_balance !== '1' && gp.transfer_pausable !== '1'
                && gp.selfdestruct !== '1' && buyTax <= 0.05 && sellTax <= 0.05;
            if (passedAll) { score += 15; }
        }
    } else {
        // Sem dados do GoPlus = não pode atingir 80 pts (barreira de segurança)
        issues.push('SEM_DADOS_GOPLUS');
        score -= 20;
    }

    // ── 6. HONEYPOT.IS (EVM) ─────────────────────────────────────────
    if (chain !== 'Solana' && honeypot && !honeypot.error) {
        const hp = honeypot?.honeypotResult;
        if (hp?.isHoneypot === true) { issues.push('HONEYPOT_CONFIRMED'); score -= 60; }
        if (honeypot?.simulationSuccess === false) { issues.push('SIMULACAO_FALHOU'); score -= 20; }
        if (hp?.isHoneypot === false && honeypot?.simulationSuccess !== false) { score += 10; }
    }

    // ── 7. RUGCHECK (Solana) ─────────────────────────────────────────
    if (chain === 'Solana' && rugcheck && !rugcheck.error) {
        const rc = rugcheck.score ?? rugcheck.riskScore ?? 0;
        if (rc > 2000) { issues.push(`RUGCHECK_CRÍTICO:${rc}`); score -= 40; }
        else if (rc > 500) { issues.push(`RUGCHECK_ALTO:${rc}`); score -= 25; }
        else if (rc > 100) { warnings.push(`RugCheck moderado: ${rc}`); score -= 10; }
        else if (rc > 0) { score += 15; } // score baixo = bom sinal
    }

    // ── 8. SEM DADOS DE MERCADO (após todos os retries) ──────────────
    if (market.source === 'none') {
        issues.push('SEM_DADOS_MERCADO');
        score -= 20;
    }

    // Clampear entre 0-100
    score = Math.max(0, Math.min(100, score));

    return {
        score,
        issues,
        warnings,
        buySignal: score >= BUY_THRESHOLD && issues.length === 0
    };
}

// ============================================================
// FORMATADORES
// ============================================================

function fmtAge(ageMin: number | null): string {
    if (ageMin === null) return '⚠️  DESCONHECIDA';
    if (ageMin < 1) return '< 1 min 🟢';
    if (ageMin <= IDEAL_TOKEN_AGE_MIN) return `${ageMin}min 🟢`;
    if (ageMin <= MAX_TOKEN_AGE_MIN) return `${ageMin}min 🟡`;
    return `${ageMin}min 🔴 (VELHA)`;
}

function fmtMoney(v: number): string {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
    if (v >= 1) return `$${v.toFixed(4)}`;
    if (v >= 0.0001) return `$${v.toFixed(8)}`;
    if (v >= 0.00000001) return `$${v.toFixed(12)}`;
    if (v > 0) { const s = v.toFixed(18); return `$${s.replace(/\\.?0+$/, "")}`; }
    return '$0';
}

function fmtScore(score: number, buySignal: boolean): string {
    const bar = score >= 80 ? '🟢' : score >= 60 ? '🟡' : '🔴';
    const action = buySignal ? '✅ BOT COMPRARIA' : score >= 80 ? '⚠️ QUASE (issues)' : '❌ REJEITADO';
    return `${bar} ${score}/100 — ${action}`;
}

// ============================================================
// PROCESSAMENTO PRINCIPAL
// ============================================================

async function processToken(chain: string, token: string) {
    if (capturedTokens.has(token)) return;
    capturedTokens.add(token);

    const foundAt = Date.now();
    console.log(`\n🔍 [${chain}] Novo token detectado: ${token}`);
    console.log(`   🕒 Detectado em: ${new Date(foundAt).toISOString()}`);
    console.log(`   ⏳ Aguardando dados de mercado...`);

    // ── Coleta dados de mercado com retry ──
    // Não exibimos nada até ter dados (ou esgotar retries)
    const market = await fetchMarketDataWithRetry(token, 4);

    const ageMs = market.pairCreatedAt ? (Date.now() - market.pairCreatedAt) : null;
    const ageMin = ageMs !== null ? Math.round(ageMs / 60000) : null;

    if (ageMin !== null && ageMin > MAX_TOKEN_AGE_MIN) {
        console.log(`   ⏭️  [${chain}] Token ${token.slice(0, 12)}... muito antigo (${ageMin}min > ${MAX_TOKEN_AGE_MIN}min). Ignorando validação.`);
        return;
    }

    console.log(`   🛡️ Analisando segurança do token ${token.slice(0, 8)}...`);

    // ── Coleta dados de segurança (imediato, não muda com o tempo) ──
    const chainId = chain === 'BSC' ? '56' : chain === 'Base' ? '8453' : 'solana';
    const geckoNet = chain === 'BSC' ? 'bsc' : chain === 'Base' ? 'base' : 'solana';

    const [goplus, honeypot, rugcheck] = await Promise.all([
        apiGoPlus(chain, chainId, token),
        chain !== 'Solana' ? apiHoneypotIs(chainId, token) : Promise.resolve(null),
        chain === 'Solana' ? apiRugCheck(token) : Promise.resolve(null),
    ]);

    // ── Score ──
    const { score, issues, warnings, buySignal } = computeScore(
        chain, market, goplus, honeypot, rugcheck, foundAt
    );

    // ── Monta resumo ──
    const summary = {
        time_detected: new Date(foundAt).toISOString(),
        time_created: market.pairCreatedAt ? new Date(market.pairCreatedAt).toISOString() : 'Desconhecido',
        age_minutes: ageMin,
        price_usd: market.priceUsd,
        liquidity_usd: market.liquidityUsd,
        volume_h24: market.volumeH24,
        volume_h1: market.volumeH1,
        volume_m5: market.volumeM5,
        vol_liq_ratio: market.liquidityUsd > 0 ? +(market.volumeH24 / market.liquidityUsd).toFixed(2) : null,
        source: market.source,
        dex: market.dexId,
        score,
        buy_signal: buySignal,
        issues,
        warnings,
    };

    // ── Exibe resultado no terminal ──
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🪙  ${token}`);
    console.log(`    Chain:      ${chain}`);
    console.log(`    Criado em:  ${summary.time_created}`);
    console.log(`    Idade:      ${fmtAge(ageMin)}`);
    console.log(`    Preço:      ${market.priceUsd > 0 ? fmtMoney(market.priceUsd) : '— (não indexado)'}`);
    if (market.isPumpFun) {
        const cap = market.fdvUsd || market.liquidityUsd;
        console.log(`    FDV/Cap:    ${cap > 0 ? fmtMoney(cap) : '—'} 🎢 Pump.fun BondingCurve`);
        console.log(`    Txns 24h:   🟢 ${market.txns24hBuys} compras | 🔴 ${market.txns24hSells} vendas`);
    } else {
        console.log(`    Liquidez:   ${market.liquidityUsd > 0 ? fmtMoney(market.liquidityUsd) : '— (não indexado)'}`);
        if (summary.vol_liq_ratio !== null) {
            const rf = summary.vol_liq_ratio > 500 ? '🚨 WASH TRADING' : summary.vol_liq_ratio > 100 ? '⚠️ SUSPEITO' : '';
            console.log(`    Vol/Liq:    ${summary.vol_liq_ratio}x ${rf}`);
        }
    }
    console.log(`    Volume 24h: ${market.volumeH24 > 0 ? fmtMoney(market.volumeH24) : '—'}`);
    console.log(`    Volume 1h:  ${market.volumeH1 > 0 ? fmtMoney(market.volumeH1) : '—'}`);
    console.log(`    Volume 5m:  ${market.volumeM5 > 0 ? fmtMoney(market.volumeM5) : '—'}`);
    console.log(`    Fonte:      ${market.source}  DEX: ${market.dexId || '—'}`);
    console.log(`    Nota:       ${fmtScore(score, buySignal)}`);
    if (issues.length > 0) console.log(`    🚩 Issues:  ${issues.join(' | ')}`);
    if (warnings.length > 0) console.log(`    ⚠️  Avisos: ${warnings.join(' | ')}`);
    console.log(`${'═'.repeat(60)}\n`);

    // ── Salva JSON ──
    const record = {
        chain,
        token,
        summary,
        raw_apis: {
            goplus,
            honeypot: honeypot ?? undefined,
            rugcheck: rugcheck ?? undefined,
            market_source: market.source,
        }
    };
    saveResult(record);
}

// ============================================================
// LISTENERS
// ============================================================

// EVM: escuta PairCreated na Uniswap/PancakeSwap factory
async function startEVM(chain: string, wsUrl: string, factory: string) {
    console.log(`[${chain}] 🔄 Conectando WebSocket...`);

    let connected = false;
    const connectTimeout = setTimeout(() => {
        if (!connected) {
            console.log(`[${chain}] ⚠️ Timeout ao conectar. Reconectando em 10s...`);
            setTimeout(() => startEVM(chain, wsUrl, factory), 10_000);
        }
    }, 15_000);

    try {
        const provider = new ethers.WebSocketProvider(wsUrl);
        const abi = ['event PairCreated(address indexed token0, address indexed token1, address pair, uint)'];
        const contract = new ethers.Contract(factory, abi, provider);

        // Verifica se o provedor respondeu
        await provider.getBlockNumber();
        connected = true;
        clearTimeout(connectTimeout);

        console.log(`[${chain}] 🟢 Conectado! Monitorando factory ${factory.slice(0, 12)}...`);

        contract.on('PairCreated', async (t0: string, t1: string) => {
            const bases = [
                '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', // WBNB
                '0xe9e7cea3dedca5984780bafc599bd69add087d56', // BUSD
                '0x55d398326f99059ff775485246999027b3197955', // USDT BSC
                '0x4200000000000000000000000000000000000006', // WETH Base
                '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC Base
            ];
            const token = bases.includes(t0.toLowerCase()) ? t1 : t0;
            console.log(`[${chain}] 📡 Par detectado! Token: ${token.slice(0, 12)}...`);
            // PARALELO: fire-and-forget — não bloqueia o listener para o próximo token
            processToken(chain, token).catch(e =>
                console.error(`[${chain}] Erro processando ${token.slice(0, 12)}: ${e.message}`)
            );
        });

        const ws = (provider as any).websocket;
        if (ws?.on) {
            ws.on('close', () => {
                console.log(`[${chain}] ❌ WS desconectado. Reconectando em 5s...`);
                setTimeout(() => startEVM(chain, wsUrl, factory), 5_000);
            });
            ws.on('error', (err: any) => {
                console.log(`[${chain}] ❌ Erro WS: ${err.message}`);
            });
        }

        // Heartbeat a cada 30s para detectar conexão morta
        setInterval(async () => {
            try {
                await provider.getBlockNumber();
            } catch {
                console.log(`[${chain}] 💔 Heartbeat falhou. Reconectando...`);
                setTimeout(() => startEVM(chain, wsUrl, factory), 2_000);
            }
        }, 30_000);

    } catch (e: any) {
        clearTimeout(connectTimeout);
        console.log(`[${chain}] ❌ Falha ao conectar: ${e.message}. Tentando em 10s...`);
        setTimeout(() => startEVM(chain, wsUrl, factory), 10_000);
    }
}

// Solana: WS na Helius Fee Account da Pump.fun + Enhanced API para pegar mints
async function startSolana() {
    console.log(`[Solana] 🟢 Conectando Helius WS na Fee Account da Pump.fun...`);

    try {
        const conn = new Connection(HELIUS_RPC, { wsEndpoint: HELIUS_WS, commitment: 'confirmed' });
        const feeAccount = new PublicKey(PUMP_FEE_ACCOUNT);

        conn.onLogs(feeAccount, async (logInfo) => {
            if (logInfo.err) return;

            // Aguarda 2s para garantir que a transação foi finalizada
            await new Promise(r => setTimeout(r, 2000));

            // Usa a Enhanced API da Helius para extrair os mints criados
            const mints = await heliusGetMints(logInfo.signature);

            for (const mint of mints) {
                if (!capturedTokens.has(mint)) {
                    console.log(`[Solana] 🚀 Novo mint via Pump.fun: ${mint}`);
                    await processToken('Solana', mint);
                }
            }
        }, 'confirmed');

        console.log(`[Solana] 🟢 Escutando transações em ${PUMP_FEE_ACCOUNT.slice(0, 10)}...`);

    } catch (e: any) {
        console.log(`[Solana] ❌ Erro Helius WS: ${e.message}. Tentando fallback via GeckoTerminal...`);

        // Fallback: polling GeckoTerminal se Helius falhar
        const poll = async () => {
            try {
                const res = await axios.get(
                    'https://api.geckoterminal.com/api/v2/networks/solana/new_pools?include=base_token',
                    { headers: { Accept: 'application/json' }, timeout: 10000 }
                );
                for (const pool of (res.data?.data || [])) {
                    const id = pool.relationships?.base_token?.data?.id;
                    const info = (res.data?.included || []).find((i: any) => i.id === id);
                    const addr = info?.attributes?.address || pool.attributes?.address;
                    if (addr && !capturedTokens.has(addr)) await processToken('Solana', addr);
                }
            } catch { /* silencioso */ }
        };
        await poll();
        setInterval(poll, 10_000);
    }
}

// ============================================================
// INÍCIO
// ============================================================

console.log('═'.repeat(60));
console.log('🚀 raw-api-test2.ts — Diagnóstico v2');
console.log(`   Limiar de compra:  >= ${BUY_THRESHOLD} pontos`);
console.log(`   Idade máx. ideal:  ${IDEAL_TOKEN_AGE_MIN} min`);
console.log(`   Idade máx. aceita: ${MAX_TOKEN_AGE_MIN} min`);
console.log(`   Resultados em:     ${path.basename(RESULTS_FILE)}`);
console.log('═'.repeat(60));

startEVM('BSC', BSC_WS, '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73');
startEVM('Base', BASE_WS, '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6');
startSolana();
