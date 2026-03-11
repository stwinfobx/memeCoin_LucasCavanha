/**
 * Analisador de Respostas da API GeckoTerminal
 * 
 * Lê todos os JSONs salvos em services/validator/api-debug/
 * e mostra uma tabela com cada token, sua idade, liquidez,
 * e se passaria ou não nos nossos filtros.
 * 
 * Uso: npx tsx services/validator/analyze-api-responses.ts
 */

import fs from 'fs';
import path from 'path';

// ===== Mesmos filtros do ingestion.ts =====
const MEME_KEYWORDS = ['INU', 'DOGE', 'PEPE', 'FLOKI', 'SHIB', 'ELON', 'MOON', 'BABY', 'PUMP', 'APE', 'MOG', 'WIF', 'LADY', 'BOBO', 'DEGEN'];
const STABLE_SYMBOLS = ['USDT', 'USDC', 'BUSD', 'DAI', 'EURT', 'TUSD', 'USD', 'USDD', 'USD1'];
const STABLE_QUOTES = ['BUSD', 'USDT', 'USDC', 'DAI'];

interface PoolData {
    id: string;
    attributes: {
        address?: string;
        name?: string;
        pool_created_at?: string;
        liquidity_usd?: string | number;
        fdv_usd?: string | number;
        market_cap_usd?: string | number;
        base_token_price_usd?: string | number;
        volume_usd?: {
            h24?: string | number;
            h6?: string | number;
            h1?: string | number;
        };
        price_change_percentage?: {
            h24?: string | number;
            h1?: string | number;
        };
    };
    relationships?: {
        base_token?: { data?: { id: string } };
        quote_token?: { data?: { id: string } };
    };
}

interface TokenData {
    id: string;
    attributes: {
        address?: string;
        name?: string;
        symbol?: string;
    };
}

interface SavedResponse {
    endpoint: string;
    url: string;
    status: number;
    timestamp: string;
    poolCount: number;
    raw: {
        data: PoolData[];
        included?: TokenData[];
    };
}

function toNum(v: string | number | undefined | null): number {
    if (v === undefined || v === null) return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function formatAge(ms: number): string {
    if (ms < 0) return 'futuro?';
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
}

function formatUsd(v: number): string {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
    return `$${v.toFixed(2)}`;
}

type FilterResult = {
    status: '✅ PASSARIA' | '⏭️  SKIP:VELHO' | '⏭️  SKIP:ESTÁVEL' | '⏭️  SKIP:PAR_ESTÁVEL' | '⏭️  SKIP:FILTRO';
    reason: string;
};

function analyzeToken(
    symbol: string,
    name: string,
    quoteSymbol: string,
    ageMs: number,
    liquidity: number,
    fdv: number,
    volume24h: number,
    priceChange24h: number,
): FilterResult {
    // 1. É stablecoin?
    if (STABLE_SYMBOLS.includes(symbol.toUpperCase())) {
        return { status: '⏭️  SKIP:ESTÁVEL', reason: `${symbol} é stablecoin` };
    }

    // 2. Keyword hit?
    const keywordHit = MEME_KEYWORDS.some(kw =>
        symbol.toUpperCase().includes(kw) || name.toUpperCase().includes(kw)
    );
    if (keywordHit) {
        return { status: '✅ PASSARIA', reason: `Keyword match` };
    }

    // 3. Par estável?
    if (STABLE_QUOTES.includes(quoteSymbol.toUpperCase())) {
        return { status: '⏭️  SKIP:PAR_ESTÁVEL', reason: `Quote é ${quoteSymbol}` };
    }

    // 4. Token muito novo? (< 24h)
    const isVeryNew = ageMs < 1000 * 60 * 60 * 24;
    if (isVeryNew && liquidity <= 500_000 && fdv <= 50_000_000) {
        return { status: '✅ PASSARIA', reason: `Novo (<24h), liq ok, fdv ok` };
    }

    // 5. Símbolo curto com baixa liquidez?
    if (symbol.length <= 5 && liquidity < 250_000) {
        return { status: '✅ PASSARIA', reason: `Símbolo curto + baixa liq` };
    }

    // 6. Alta variação de preço?
    if (priceChange24h > 100 && volume24h > 100_000) {
        return { status: '✅ PASSARIA', reason: `Alta variação +${priceChange24h.toFixed(0)}%` };
    }

    // 7. Catch-all (linha 415 do ingestion.ts retorna true)
    return { status: '✅ PASSARIA', reason: `Catch-all (sem filtro específico)` };
}

// ===== Main =====
const debugDir = path.resolve(__dirname, '../api-debug');

if (!fs.existsSync(debugDir)) {
    console.error(`❌ Pasta não encontrada: ${debugDir}`);
    console.error(`   Rode o Validator primeiro para gerar os JSONs.`);
    process.exit(1);
}

const files = fs.readdirSync(debugDir).filter(f => f.endsWith('.json')).sort();

if (files.length === 0) {
    console.error(`❌ Nenhum arquivo JSON encontrado em ${debugDir}`);
    console.error(`   Rode o Validator primeiro para gerar os JSONs.`);
    process.exit(1);
}

console.log(`\n📁 Analisando ${files.length} arquivo(s) de resposta da API...\n`);

// Contadores globais
let totalPools = 0;
let totalPassaria = 0;
let totalSkipVelho = 0;
let totalSkipEstavel = 0;
let totalSkipParEstavel = 0;
let totalSkipFiltro = 0;
let totalNovo24h = 0;
let totalNovo1h = 0;

for (const file of files) {
    const filePath = path.join(debugDir, file);
    let data: SavedResponse;

    try {
        data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (err) {
        console.warn(`⚠️  Erro ao ler ${file}: ${err}`);
        continue;
    }

    const pools = data.raw?.data ?? [];
    const included = data.raw?.included ?? [];
    const tokenMap = new Map<string, TokenData>();
    for (const t of included) {
        tokenMap.set(t.id, t);
    }

    console.log(`${'='.repeat(80)}`);
    console.log(`📄 ${file}`);
    console.log(`   Endpoint: ${data.endpoint} | Data: ${data.timestamp} | Status: ${data.status} | Pools: ${data.poolCount}`);
    console.log(`${'='.repeat(80)}`);
    console.log('');

    // Table header
    const header = [
        ' # '.padEnd(4),
        'Símbolo'.padEnd(12),
        'Idade'.padEnd(12),
        'Liquidez'.padEnd(12),
        'Vol 24h'.padEnd(12),
        'Quote'.padEnd(8),
        'Preço USD'.padEnd(14),
        'Status'.padEnd(22),
        'Motivo',
    ].join('│ ');
    console.log(header);
    console.log('─'.repeat(130));

    const now = Date.now();

    for (let i = 0; i < pools.length; i++) {
        const pool = pools[i];
        totalPools++;

        // Resolve token info from included
        const baseTokenId = pool.relationships?.base_token?.data?.id;
        const quoteTokenId = pool.relationships?.quote_token?.data?.id;
        const baseToken = baseTokenId ? tokenMap.get(baseTokenId) : undefined;
        const quoteToken = quoteTokenId ? tokenMap.get(quoteTokenId) : undefined;

        const symbol = (baseToken?.attributes?.symbol || pool.attributes.name?.split('/')[0] || '???').toUpperCase();
        const name = baseToken?.attributes?.name || pool.attributes.name || '???';
        const quoteSymbol = (quoteToken?.attributes?.symbol || pool.attributes.name?.split('/')[1] || '???').toUpperCase();

        const liquidity = toNum(pool.attributes.liquidity_usd);
        const fdv = toNum(pool.attributes.fdv_usd) || toNum(pool.attributes.market_cap_usd);
        const volume24h = toNum(pool.attributes.volume_usd?.h24);
        const priceUsd = toNum(pool.attributes.base_token_price_usd);
        const priceChange24h = toNum(pool.attributes.price_change_percentage?.h24);

        let ageMs = Number.POSITIVE_INFINITY;
        let ageStr = 'desconhecida';
        if (pool.attributes.pool_created_at) {
            const created = Date.parse(pool.attributes.pool_created_at);
            if (Number.isFinite(created)) {
                ageMs = now - created;
                ageStr = formatAge(ageMs);
            }
        }

        // Track age stats
        if (ageMs < 1000 * 60 * 60 * 24) totalNovo24h++;
        if (ageMs < 1000 * 60 * 60) totalNovo1h++;

        const result = analyzeToken(symbol, name, quoteSymbol, ageMs, liquidity, fdv, volume24h, priceChange24h);

        // Track status stats
        if (result.status.includes('PASSARIA')) totalPassaria++;
        else if (result.status.includes('VELHO')) totalSkipVelho++;
        else if (result.status.includes('ESTÁVEL') && !result.status.includes('PAR')) totalSkipEstavel++;
        else if (result.status.includes('PAR_ESTÁVEL')) totalSkipParEstavel++;
        else totalSkipFiltro++;

        const row = [
            String(i + 1).padEnd(4),
            symbol.substring(0, 11).padEnd(12),
            ageStr.padEnd(12),
            formatUsd(liquidity).padEnd(12),
            formatUsd(volume24h).padEnd(12),
            quoteSymbol.substring(0, 7).padEnd(8),
            (priceUsd > 0 ? `$${priceUsd.toPrecision(4)}` : 'N/A').padEnd(14),
            result.status.padEnd(22),
            result.reason,
        ].join('│ ');

        console.log(row);
    }

    console.log('');
}

// ===== Resumo Global =====
console.log(`${'='.repeat(80)}`);
console.log(`📊 RESUMO GLOBAL (${files.length} arquivo(s), ${totalPools} pools analisados)`);
console.log(`${'='.repeat(80)}`);
console.log(`   ✅ Passariam nos filtros:     ${totalPassaria}`);
console.log(`   ⏭️  Skip por stablecoin:       ${totalSkipEstavel}`);
console.log(`   ⏭️  Skip por par estável:      ${totalSkipParEstavel}`);
console.log(`   ⏭️  Skip por filtro genérico:  ${totalSkipFiltro}`);
console.log('');
console.log(`   🕐 Tokens com < 1 hora de vida:  ${totalNovo1h}`);
console.log(`   🕐 Tokens com < 24 horas de vida: ${totalNovo24h}`);
console.log(`   🕐 Tokens com > 24 horas de vida: ${totalPools - totalNovo24h}`);
console.log('');

if (totalNovo24h === 0) {
    console.log(`   🚨 CONCLUSÃO: A API NÃO está retornando tokens novos (<24h).`);
    console.log(`      O problema é da fonte de dados (GeckoTerminal), não dos nossos filtros.`);
    console.log(`      Considere usar outra API: DexScreener, BscScan, ou Moralis.`);
} else if (totalPassaria === 0) {
    console.log(`   ⚠️  CONCLUSÃO: Existem tokens novos, mas TODOS são filtrados.`);
    console.log(`      Nossos filtros (isMemecoinCandidate) estão muito restritivos.`);
} else {
    console.log(`   ✅ CONCLUSÃO: A API retorna tokens novos e eles passam nos filtros.`);
    console.log(`      Se mesmo assim nada é processado, o problema está no shouldSkipToken (freshness).`);
}

console.log('');
