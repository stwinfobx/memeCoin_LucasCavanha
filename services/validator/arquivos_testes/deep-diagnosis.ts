/**
 * DIAGNÓSTICO PROFUNDO — BscScan + GoPlus + GeckoTerminal
 * 
 * Para cada token recém-criado:
 *   1. Puxa dados do GeckoTerminal /new_pools
 *   2. Consulta GoPlus Security API (honeypot, taxas, holders)
 *   3. Consulta BscScan para data real de criação do contrato
 *   4. Salva JSONs brutos E mostra resultado no terminal
 * 
 * Uso: npx tsx deep-diagnosis.ts
 * 
 * NÃO precisa de API key para GoPlus.
 * PRECISA de BSCSCAN_API_KEY no .env para dados de criação (opcional).
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const GECKO_BASE = 'https://api.geckoterminal.com/api/v2';
const GOPLUS_BASE = 'https://api.gopluslabs.io/api/v1';
const BSCSCAN_KEY = process.env.BSCSCAN_API_KEY || '';
const NETWORK = 'bsc';

const GECKO_HEADERS = {
    'User-Agent': 'TradingBotDiag/1.0',
    Accept: 'application/json',
};

interface PoolInfo {
    symbol: string;
    name: string;
    address: string;
    poolAddress: string;
    quoteSymbol: string;
    priceUsd: number;
    liquidityUsd: number;
    volume24h: number;
    poolCreatedAt: string | null;
    ageMinutes: number;
}

interface GoPlusResult {
    is_honeypot: string;
    cannot_sell_all: string;
    buy_tax: string;
    sell_tax: string;
    holder_count: string;
    can_take_back_ownership: string;
    is_open_source: string;
    is_proxy: string;
    is_mintable: string;
    owner_address: string;
    creator_address: string;
    total_supply: string;
    lp_holder_count: string;
    lp_total_supply: string;
    is_in_dex: string;
    [key: string]: any;
}

interface DiagnosisResult {
    pool: PoolInfo;
    goplus: GoPlusResult | null;
    goplusError: string | null;
    bscscanContractAge: number | null; // minutes since creation
    bscscanCreator: string | null;
    verdict: string;
    dangers: string[];
    warnings: string[];
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchNewPools(): Promise<PoolInfo[]> {
    console.log('🌐 Buscando novos pools do GeckoTerminal (/new_pools)...');

    // Buscar múltiplas páginas para ter mais dados
    const pools: PoolInfo[] = [];
    const now = Date.now();

    for (let page = 1; page <= 3; page++) {
        try {
            const url = `${GECKO_BASE}/networks/${NETWORK}/new_pools?page=${page}&include=base_token,quote_token`;
            const resp = await axios.get(url, { timeout: 15000, headers: GECKO_HEADERS });

            const poolsData = resp.data?.data ?? [];
            const included = resp.data?.included ?? [];

            const tokenMap = new Map<string, any>();
            for (const t of included) {
                tokenMap.set(t.id, t);
            }

            for (const pool of poolsData) {
                const baseTokenId = pool.relationships?.base_token?.data?.id;
                const quoteTokenId = pool.relationships?.quote_token?.data?.id;
                const baseToken = baseTokenId ? tokenMap.get(baseTokenId) : null;
                const quoteToken = quoteTokenId ? tokenMap.get(quoteTokenId) : null;

                const baseAddr = baseToken?.attributes?.address || pool.attributes?.address;
                if (!baseAddr) continue;

                let ageMinutes = -1;
                if (pool.attributes?.pool_created_at) {
                    const created = Date.parse(pool.attributes.pool_created_at);
                    if (Number.isFinite(created)) {
                        ageMinutes = Math.round((now - created) / 60000);
                    }
                }

                const liq = parseFloat(pool.attributes?.reserve_in_usd || pool.attributes?.liquidity_usd || '0') || 0;
                const vol = parseFloat(pool.attributes?.volume_usd?.h24 || '0') || 0;
                const price = parseFloat(pool.attributes?.base_token_price_usd || '0') || 0;

                pools.push({
                    symbol: (baseToken?.attributes?.symbol || '???').toUpperCase(),
                    name: baseToken?.attributes?.name || pool.attributes?.name || '???',
                    address: baseAddr.toLowerCase(),
                    poolAddress: (pool.attributes?.address || '').toLowerCase(),
                    quoteSymbol: (quoteToken?.attributes?.symbol || '???').toUpperCase(),
                    priceUsd: price,
                    liquidityUsd: liq,
                    volume24h: vol,
                    poolCreatedAt: pool.attributes?.pool_created_at || null,
                    ageMinutes,
                });
            }

            console.log(`   Página ${page}: ${poolsData.length} pools encontrados`);
            await sleep(1500); // Rate limiting
        } catch (err: any) {
            console.warn(`   Página ${page} falhou: ${err.message}`);
        }
    }

    // Remove duplicates by address
    const unique = new Map<string, PoolInfo>();
    for (const p of pools) {
        if (!unique.has(p.address)) {
            unique.set(p.address, p);
        }
    }

    const result = Array.from(unique.values());
    console.log(`   Total de tokens únicos: ${result.length}\n`);
    return result;
}

async function checkGoPlus(tokenAddress: string): Promise<{ data: GoPlusResult | null; error: string | null }> {
    try {
        const url = `${GOPLUS_BASE}/token_security/56?contract_addresses=${tokenAddress}`;
        const resp = await axios.get(url, { timeout: 10000 });
        const result = resp.data?.result?.[tokenAddress.toLowerCase()];
        if (!result) {
            return { data: null, error: 'No data from GoPlus' };
        }
        return { data: result, error: null };
    } catch (err: any) {
        return { data: null, error: err.message };
    }
}

async function checkBscScanAge(tokenAddress: string): Promise<{ ageMinutes: number | null; creator: string | null }> {
    if (!BSCSCAN_KEY) {
        return { ageMinutes: null, creator: null };
    }

    try {
        const url = `https://api.bscscan.com/api?module=contract&action=getcontractcreation&contractaddresses=${tokenAddress}&apikey=${BSCSCAN_KEY}`;
        const resp = await axios.get(url, { timeout: 10000 });
        const result = resp.data?.result;
        if (!result || !Array.isArray(result) || result.length === 0) {
            return { ageMinutes: null, creator: null };
        }

        const txHash = result[0].txHash;
        const creator = result[0].contractCreator;

        // Get the tx timestamp from BscScan
        const txUrl = `https://api.bscscan.com/api?module=proxy&action=eth_getTransactionByHash&txhash=${txHash}&apikey=${BSCSCAN_KEY}`;
        const txResp = await axios.get(txUrl, { timeout: 10000 });
        const blockNumHex = txResp.data?.result?.blockNumber;

        if (blockNumHex) {
            const blockUrl = `https://api.bscscan.com/api?module=block&action=getblockreward&blockno=${parseInt(blockNumHex, 16)}&apikey=${BSCSCAN_KEY}`;
            const blockResp = await axios.get(blockUrl, { timeout: 10000 });
            const timestamp = parseInt(blockResp.data?.result?.timeStamp || '0');
            if (timestamp > 0) {
                const ageMs = Date.now() - timestamp * 1000;
                return { ageMinutes: Math.round(ageMs / 60000), creator };
            }
        }

        return { ageMinutes: null, creator };
    } catch (err: any) {
        return { ageMinutes: null, creator: null };
    }
}

function analyzeToken(pool: PoolInfo, goplus: GoPlusResult | null): { verdict: string; dangers: string[]; warnings: string[] } {
    const dangers: string[] = [];
    const warnings: string[] = [];

    if (!goplus) {
        warnings.push('SEM_DADOS_GOPLUS');
        return { verdict: '⚠️  SEM_DADOS', dangers, warnings };
    }

    // CRITICAL: Honeypot
    if (goplus.is_honeypot === '1') {
        dangers.push('🍯 HONEYPOT');
    }

    // CRITICAL: Cannot sell
    if (goplus.cannot_sell_all === '1') {
        dangers.push('🔒 NÃO_PODE_VENDER');
    }

    // CRITICAL: Taxes
    const buyTax = parseFloat(goplus.buy_tax || '0') * 100;
    const sellTax = parseFloat(goplus.sell_tax || '0') * 100;
    if (buyTax > 10) dangers.push(`💸 TAXA_COMPRA:${buyTax.toFixed(0)}%`);
    else if (buyTax > 5) warnings.push(`Taxa compra:${buyTax.toFixed(1)}%`);
    if (sellTax > 10) dangers.push(`💸 TAXA_VENDA:${sellTax.toFixed(0)}%`);
    else if (sellTax > 5) warnings.push(`Taxa venda:${sellTax.toFixed(1)}%`);

    // HIGH: Owner can take back
    if (goplus.can_take_back_ownership === '1') {
        dangers.push('👑 OWNER_PODE_RETOMAR');
    }

    // HIGH: Mintable (infinite supply)
    if (goplus.is_mintable === '1') {
        warnings.push('♾️ MINTABLE');
    }

    // HIGH: Not open source
    if (goplus.is_open_source === '0') {
        warnings.push('🔐 CÓDIGO_FECHADO');
    }

    // MEDIUM: Low holders
    const holders = parseInt(goplus.holder_count || '0');
    if (holders < 5) dangers.push(`👥 SÓ_${holders}_HOLDERS`);
    else if (holders < 20) warnings.push(`${holders} holders`);

    // MEDIUM: Not on DEX
    if (goplus.is_in_dex === '0') {
        warnings.push('Fora de DEX');
    }

    // MEDIUM: Zero liquidity
    if (pool.liquidityUsd <= 0) {
        warnings.push('LIQUIDEZ_ZERO');
    }

    // Verdict
    if (dangers.length >= 2) {
        return { verdict: '🚨 SCAM', dangers, warnings };
    } else if (dangers.length === 1) {
        return { verdict: '❌ PERIGOSO', dangers, warnings };
    } else if (warnings.length >= 3) {
        return { verdict: '⚠️  SUSPEITO', dangers, warnings };
    } else if (warnings.length >= 1) {
        return { verdict: '🟡 CUIDADO', dangers, warnings };
    } else {
        return { verdict: '✅ OK', dangers, warnings };
    }
}

function formatAge(minutes: number): string {
    if (minutes < 0) return '???';
    if (minutes < 60) return `${minutes}min`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
}

function formatUsd(v: number): string {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
    if (v > 0) return `$${v.toFixed(2)}`;
    return '$0';
}

// ===== MAIN =====
async function main() {
    console.log('═'.repeat(90));
    console.log('  🔬 DIAGNÓSTICO PROFUNDO — GeckoTerminal + GoPlus + BscScan');
    console.log('═'.repeat(90));
    console.log(`  Data: ${new Date().toISOString()}`);
    console.log(`  BscScan API Key: ${BSCSCAN_KEY ? '✅ Configurada' : '❌ NÃO CONFIGURADA'}`);
    console.log(`  GoPlus API: ✅ Gratuita (sem chave)`);
    console.log('═'.repeat(90));
    console.log('');

    const pools = await fetchNewPools();
    if (pools.length === 0) {
        console.error('❌ Nenhum pool encontrado. Verifique sua conexão.');
        return;
    }

    const results: DiagnosisResult[] = [];
    const debugDir = path.resolve(__dirname, 'api-debug', 'deep-diagnosis');
    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

    console.log(`🔍 Analisando ${pools.length} tokens com GoPlus Security API...\n`);

    for (let i = 0; i < pools.length; i++) {
        const pool = pools[i];
        process.stdout.write(`  [${i + 1}/${pools.length}] ${pool.symbol.padEnd(12)} `);

        // GoPlus check
        const gp = await checkGoPlus(pool.address);

        // BscScan age check
        let bscAge: { ageMinutes: number | null; creator: string | null } = { ageMinutes: null, creator: null };
        if (BSCSCAN_KEY) {
            bscAge = await checkBscScanAge(pool.address);
            await sleep(250); // BscScan rate limit
        }

        const { verdict, dangers, warnings } = analyzeToken(pool, gp.data);

        const result: DiagnosisResult = {
            pool,
            goplus: gp.data,
            goplusError: gp.error,
            bscscanContractAge: bscAge.ageMinutes,
            bscscanCreator: bscAge.creator,
            verdict,
            dangers,
            warnings,
        };

        results.push(result);
        console.log(verdict);

        await sleep(600); // GoPlus rate limit
    }

    // Save all raw data
    const now = new Date();
    const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
    const rawFile = path.join(debugDir, `diagnosis_${ts}.json`);
    fs.writeFileSync(rawFile, JSON.stringify(results, null, 2));
    console.log(`\n📁 Dados brutos salvos em: ${rawFile}\n`);

    // ===== Display Results Table =====
    console.log('═'.repeat(130));
    console.log('  RESULTADO DA ANÁLISE PROFUNDA');
    console.log('═'.repeat(130));

    const header = [
        '#'.padEnd(4),
        'Símbolo'.padEnd(12),
        'Idade Pool'.padEnd(11),
        'Idade BSC'.padEnd(11),
        'Liquidez'.padEnd(10),
        'Holders'.padEnd(8),
        'Buy Tax'.padEnd(8),
        'Sell Tax'.padEnd(9),
        'Honeypot'.padEnd(9),
        'Veredicto'.padEnd(14),
        'Perigos',
    ].join('| ');
    console.log(header);
    console.log('─'.repeat(130));

    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const gp = r.goplus;

        const buyTax = gp ? (parseFloat(gp.buy_tax || '0') * 100).toFixed(0) + '%' : '???';
        const sellTax = gp ? (parseFloat(gp.sell_tax || '0') * 100).toFixed(0) + '%' : '???';
        const honeypot = gp ? (gp.is_honeypot === '1' ? '🍯 SIM' : '✅ NÃO') : '???';
        const holders = gp ? gp.holder_count || '0' : '???';
        const poolAge = r.pool.ageMinutes >= 0 ? formatAge(r.pool.ageMinutes) : '???';
        const bscAge = r.bscscanContractAge !== null ? formatAge(r.bscscanContractAge) : 'N/A';

        const row = [
            String(i + 1).padEnd(4),
            r.pool.symbol.substring(0, 11).padEnd(12),
            poolAge.padEnd(11),
            bscAge.padEnd(11),
            formatUsd(r.pool.liquidityUsd).padEnd(10),
            String(holders).padEnd(8),
            buyTax.padEnd(8),
            sellTax.padEnd(9),
            honeypot.padEnd(9),
            r.verdict.padEnd(14),
            r.dangers.join(', ') || (r.warnings.length > 0 ? r.warnings.join(', ') : '-'),
        ].join('| ');

        console.log(row);
    }

    // ===== Summary =====
    const scams = results.filter(r => r.verdict.includes('SCAM'));
    const dangerous = results.filter(r => r.verdict.includes('PERIGOSO'));
    const suspect = results.filter(r => r.verdict.includes('SUSPEITO'));
    const caution = results.filter(r => r.verdict.includes('CUIDADO'));
    const ok = results.filter(r => r.verdict.includes('OK'));
    const noData = results.filter(r => r.verdict.includes('SEM_DADOS'));

    const under10min = results.filter(r => r.pool.ageMinutes >= 0 && r.pool.ageMinutes <= 10);
    const under30min = results.filter(r => r.pool.ageMinutes >= 0 && r.pool.ageMinutes <= 30);
    const under1h = results.filter(r => r.pool.ageMinutes >= 0 && r.pool.ageMinutes <= 60);
    const zeroLiq = results.filter(r => r.pool.liquidityUsd <= 0);

    console.log('');
    console.log('═'.repeat(90));
    console.log('  📊 RESUMO');
    console.log('═'.repeat(90));
    console.log(`  Total analisados:       ${results.length}`);
    console.log(`  🚨 SCAM (2+ dangers):   ${scams.length}`);
    console.log(`  ❌ PERIGOSO (1 danger):  ${dangerous.length}`);
    console.log(`  ⚠️  SUSPEITO (3+ warn):  ${suspect.length}`);
    console.log(`  🟡 CUIDADO (1-2 warn):  ${caution.length}`);
    console.log(`  ✅ OK (limpo):          ${ok.length}`);
    console.log(`  ➖ Sem dados GoPlus:    ${noData.length}`);
    console.log('');
    console.log(`  🕐 Tokens ≤ 10 min:    ${under10min.length}`);
    console.log(`  🕐 Tokens ≤ 30 min:    ${under30min.length}`);
    console.log(`  🕐 Tokens ≤ 1 hora:    ${under1h.length}`);
    console.log(`  💧 Liquidez = $0:       ${zeroLiq.length}`);
    console.log('');

    // Scam percentage
    const scamPercent = ((scams.length + dangerous.length) / results.length * 100).toFixed(1);
    const safePercent = (ok.length / results.length * 100).toFixed(1);

    console.log(`  📈 Taxa de golpe/perigo: ${scamPercent}% dos tokens`);
    console.log(`  📈 Taxa de "limpos":     ${safePercent}% dos tokens`);
    console.log('');

    if (parseFloat(scamPercent) > 50) {
        console.log('  🚨 CONCLUSÃO: A MAIORIA dos tokens novos são GOLPE.');
        console.log('     Isso confirma que precisamos de filtros mais agressivos.');
    } else if (parseFloat(scamPercent) > 20) {
        console.log('  ⚠️  CONCLUSÃO: Uma parcela significativa é golpe.');
        console.log('     Os filtros GoPlus são essenciais ANTES da compra.');
    } else {
        console.log('  ✅ CONCLUSÃO: A maioria parece legítima.');
        console.log('     Mas mantenha as verificações GoPlus ativas.');
    }

    console.log('');
    console.log('═'.repeat(90));
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
