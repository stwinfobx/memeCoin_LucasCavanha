import { ethers } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

// Carregar variáveis de ambiente
require('dotenv').config({ path: path.join(__dirname, '.env') });

const resultsFile = path.join(__dirname, 'raw-api-results.json');
const results: any[] = [];
const capturedTokens = new Set<string>();

const SOLANA_WS = process.env.SOLANA_WS_URL || 'wss://mainnet.helius-rpc.com/?api-key=c0e8b22b-7ba2-425a-b501-83ce58400f19';
const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=c0e8b22b-7ba2-425a-b501-83ce58400f19';
const BSC_WS = process.env.BSC_WS_URL || 'wss://bsc.publicnode.com';
const BASE_WS = process.env.BASE_WS_URL || 'wss://alpha-convincing-hill.base-mainnet.quiknode.pro/4e2de075fd52bc19ba81fadbbb30db1083a6f28c/';

function saveResult(data: any) {
    results.push(data);
    fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
    console.log(`\n💾 Salvo resultado para ${data.chain} - ${data.token}`);
}

// ---------------------------------------------------------
// Chamadas Manuais às APIs (Cruas)
// ---------------------------------------------------------

async function testGoPlus(chain: string, chainId: string, token: string) {
    try {
        const url = chain === 'Solana'
            ? `https://api.gopluslabs.io/api/v1/token_security/solana?contract_addresses=${token}`
            : `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${token}`;
        const res = await axios.get(url, { timeout: 10000 });
        return res.data?.result?.[token.toLowerCase()] || res.data?.result || {};
    } catch (e: any) {
        return { error: e.message };
    }
}

async function testHoneypotIs(chainId: string, token: string) {
    try {
        const url = `https://api.honeypot.is/v2/IsHoneypot?address=${token}&chainID=${chainId}`;
        const res = await axios.get(url, { timeout: 10000 });
        return res.data;
    } catch (e: any) {
        return { error: e.message };
    }
}

async function testRugCheck(token: string) {
    try {
        const url = `https://api.rugcheck.xyz/v1/tokens/${token}/report/summary`;
        const res = await axios.get(url, { timeout: 10000 });
        return res.data;
    } catch (e: any) {
        return { error: e.message };
    }
}

async function testGeckoTerminal(network: string, token: string) {
    try {
        const url = `https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${token}`;
        const res = await axios.get(url, {
            timeout: 10000,
            headers: { 'Accept': 'application/json' }
        });
        return res.data?.data?.attributes || {};
    } catch (e: any) {
        return { error: e.message };
    }
}

async function testDexScreener(token: string) {
    try {
        const url = `https://api.dexscreener.com/latest/dex/tokens/${token}`;
        const res = await axios.get(url, {
            timeout: 10000,
            headers: { 'Accept': 'application/json' }
        });

        if (res.data?.pairs && res.data.pairs.length > 0) {
            // Ordena as pools da DexScreener por liquidez
            const pools = res.data.pairs.sort((a: any, b: any) =>
                (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
            );
            return pools[0];
        }
        return { error: 'Not found on DexScreener' };
    } catch (e: any) {
        return { error: e.message };
    }
}

// ---------------------------------------------------------
// Processamento & Classificação
// ---------------------------------------------------------

async function processToken(chain: string, token: string) {
    if (capturedTokens.has(token)) return;
    capturedTokens.add(token);

    console.log(`\n🔍 Processando nova moeda na ${chain}: ${token}`);

    const tokenData: any = {
        timestamp: new Date().toISOString(),
        chain,
        token,
        raw_apis: {},
        classification: {
            issues: [],
            score: 50, // Começamos com 50
            is_valid: false,
            warnings: []
        }
    };

    // Coleta Dados
    if (chain === 'Solana') {
        tokenData.raw_apis.goplus = await testGoPlus('Solana', 'solana', token);
        tokenData.raw_apis.rugcheck = await testRugCheck(token);
        tokenData.raw_apis.gecko = await testGeckoTerminal('solana', token);
        tokenData.raw_apis.dexscreener = await testDexScreener(token);
    } else {
        const chainId = chain === 'BSC' ? '56' : '8453';
        const geckoNet = chain === 'BSC' ? 'bsc' : 'base';

        tokenData.raw_apis.goplus = await testGoPlus(chain, chainId, token);
        tokenData.raw_apis.honeypotIs = await testHoneypotIs(chainId, token);
        tokenData.raw_apis.gecko = await testGeckoTerminal(geckoNet, token);
        tokenData.raw_apis.dexscreener = await testDexScreener(token);
    }

    // Lógica de Classificação simplificada para testar o que as APIs devolvem de fato
    let score = 50;
    const issues: string[] = [];

    // GoPlus (EVM)
    if (chain !== 'Solana' && !tokenData.raw_apis.goplus.error) {
        const gp = tokenData.raw_apis.goplus;
        if (gp?.is_honeypot === '1') { issues.push('GoPlus Honeypot'); score -= 50; }
        if (parseFloat(gp?.buy_tax || '0') > 10) { issues.push('Taxa de Compra Alta'); score -= 15; }
        if (parseFloat(gp?.sell_tax || '0') > 10) { issues.push('Taxa de Venda Alta'); score -= 15; }
        if (gp?.is_honeypot === '0' && parseFloat(gp?.buy_tax || '11') < 10) { score += 15; }
    }

    // GoPlus (Solana)
    if (chain === 'Solana' && !tokenData.raw_apis.goplus.error) {
        const gp = tokenData.raw_apis.goplus;
        if (gp?.freezeable === '1') { issues.push('Freezable'); score -= 40; }
        if (gp?.mintable === '1') { issues.push('Mintable'); score -= 20; }
    }

    // Honeypot.is (EVM)
    if (chain !== 'Solana' && !tokenData.raw_apis.honeypotIs.error) {
        const hp = tokenData.raw_apis.honeypotIs;
        if (hp?.isHoneypot === true) { issues.push('Honeypot API Honeypot'); score -= 60; }
        if (hp?.simulationSuccess === false) { issues.push('Falha na Simulação'); score -= 20; }
    }

    // RugCheck (Solana)
    if (chain === 'Solana' && !tokenData.raw_apis.rugcheck.error) {
        const rc = tokenData.raw_apis.rugcheck;
        if (rc?.score > 500) { issues.push(`RugCheck Alto Risco: ${rc.score}`); score -= 40; }
        else if (rc?.score > 0 && rc?.score <= 100) { score += 20; }
    }

    // Gecko Terminal (Aviso se volume 0 em APIs base)
    if (!tokenData.raw_apis.gecko.error) {
        const volume = parseFloat(tokenData.raw_apis.gecko.volume_usd?.h24 || '0');
        if (volume === 0 && !tokenData.raw_apis.gecko.name) {
            tokenData.classification.warnings.push('Token ainda não listado no GeckoTerminal');
        } else {
            tokenData.classification.warnings.push(`Volume 24h (Gecko): $${volume}`);
        }
    } else {
        tokenData.classification.warnings.push(`Erro GeckoTerminal (Comum em tokens recém-lançados)`);
    }

    // Dados Consolidados para o Usuário
    let priceUsd = 0;
    let liquidityUsd = 0;
    let creationTime = 'Desconhecido';

    if (tokenData.raw_apis.dexscreener && !tokenData.raw_apis.dexscreener.error) {
        priceUsd = parseFloat(tokenData.raw_apis.dexscreener.priceUsd || '0');
        liquidityUsd = parseFloat(tokenData.raw_apis.dexscreener.liquidity?.usd || tokenData.raw_apis.dexscreener.fdv || '0');

        if (tokenData.raw_apis.dexscreener.pairCreatedAt) {
            creationTime = new Date(tokenData.raw_apis.dexscreener.pairCreatedAt).toISOString();
        }
    }
    else if (!tokenData.raw_apis.gecko.error) {
        priceUsd = parseFloat(tokenData.raw_apis.gecko.base_token_price_usd || tokenData.raw_apis.gecko.price_usd || '0');
        liquidityUsd = parseFloat(tokenData.raw_apis.gecko.reserve_in_usd || tokenData.raw_apis.gecko.liquidity_usd || tokenData.raw_apis.gecko.fdv_usd || '0');
        creationTime = tokenData.raw_apis.gecko.pool_created_at || 'Desconhecido';
    }

    const isHoneypotStatus = issues.some(i => i.toLowerCase().includes('honeypot'));

    tokenData.summary = {
        time_found: new Date().toISOString(),
        time_created: creationTime,
        price_usd: priceUsd,
        liquidity_usd: liquidityUsd,
        is_honeypot: isHoneypotStatus,
        is_valid: score >= 50 && issues.length === 0,
        score: score,
        issues_found: issues
    };

    tokenData.classification.score = score;
    tokenData.classification.issues = issues;
    tokenData.classification.is_valid = tokenData.summary.is_valid;

    console.log(`\n=========================================`);
    console.log(`🤑 MOEDA ENCONTRADA: ${token} (${chain})`);
    console.log(`🕒 Encontrada em: ${tokenData.summary.time_found}`);
    console.log(`⏳ Criada em:     ${tokenData.summary.time_created}`);
    console.log(`💲 Preço:         $${priceUsd.toFixed(6)}`);
    console.log(`💧 Liquidez:      $${liquidityUsd.toFixed(2)}`);
    console.log(`🍯 Honeypot?      ${isHoneypotStatus ? '⚠️ SIM' : '✅ NÃO'}`);
    console.log(`✅ Resultado:     ${tokenData.summary.is_valid ? 'APROVADA' : 'REJEITADA (Scam)'} (Nota: ${score})`);
    if (issues.length > 0) console.log(`🚩 Alertas:       ${issues.join(', ')}`);
    console.log(`=========================================\n`);

    saveResult(tokenData);
}

// ---------------------------------------------------------
// Listeners WS
// ---------------------------------------------------------

async function startEVM(chain: string, wsUrl: string, factory: string) {
    try {
        const provider = new ethers.WebSocketProvider(wsUrl);
        const abi = ['event PairCreated(address indexed token0, address indexed token1, address pair, uint)'];
        const contract = new ethers.Contract(factory, abi, provider);

        console.log(`[${chain}] Monitorando factory...`);

        contract.on('PairCreated', async (t0, t1) => {
            const bases = [
                '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
                '0x4200000000000000000000000000000000000006'
            ];
            const token = bases.includes(t0.toLowerCase()) ? t1 : t0;
            await processToken(chain, token);
        });
    } catch (err: any) {
        console.log(`[${chain}] Erro WS: ${err.message}`);
    }
}

async function startSolana(rpc: string, ws: string) {
    console.log(`[Solana] Monitorando novos pools via GeckoTerminal...`);

    const fetchNewSolana = async () => {
        try {
            const url = `https://api.geckoterminal.com/api/v2/networks/solana/new_pools?include=base_token`;
            const res = await axios.get(url, { headers: { 'Accept': 'application/json' }, timeout: 10000 });

            const pools = res.data?.data || [];
            const includes = res.data?.included || [];

            if (pools.length > 0) {
                for (const pool of pools) {
                    const baseTokenId = pool.relationships?.base_token?.data?.id;
                    const baseTokenInfo = includes.find((i: any) => i.id === baseTokenId);
                    const tokenAddr = baseTokenInfo?.attributes?.address || pool.attributes?.address;

                    if (tokenAddr && !capturedTokens.has(tokenAddr)) {
                        await processToken('Solana', tokenAddr);
                    }
                }
            }
        } catch (err: any) {
            if (!err.response || err.response.status !== 429) {
                // silencioso para n floodar no console
            }
        }
    };

    await fetchNewSolana();
    setInterval(fetchNewSolana, 5000); // Polling a cada 5 segundos
}

console.log('='.repeat(50));
console.log('🚀 Iniciando Script Nativo de APIs (Sem classes do Validator)');
console.log('='.repeat(50));

startEVM('BSC', BSC_WS, '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73');
startEVM('Base', BASE_WS, '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6');
startSolana(SOLANA_RPC, SOLANA_WS);
