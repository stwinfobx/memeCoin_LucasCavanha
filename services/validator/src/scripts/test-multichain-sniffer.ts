import { ethers } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';
import * as dotenv from 'dotenv';
import path from 'path';

// Load .env from root
dotenv.config({ path: path.join(__dirname, '../../../../.env') });

const BSC_WS_URL = process.env.BSC_WS_URL;
const BASE_WS_URL = process.env.BASE_WS_URL;
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL;
const SOLANA_WS_URL = process.env.SOLANA_WS_URL;

// Factory Addresses
const PANCAKE_FACTORY_V2 = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';
const UNISWAP_V2_FACTORY_BASE = '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6'; // Uniswap V2 Base Factory
const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfX9PNnZz4n9n9fpxc6';

const PAIR_CREATED_ABI = [
    'event PairCreated(address indexed token0, address indexed token1, address pair, uint)'
];

// --- Security Check Definitions ---
interface SecurityResult {
    isSafe: boolean;
    score: number;
    reason: string;
}

async function checkSecurity(network: string, tokenAddress: string): Promise<SecurityResult> {
    try {
        console.log(`[${network}] 🔎 Analyzing security for ${tokenAddress}...`);

        let chainId = '56'; // Default BSC
        if (network === 'Base') chainId = '8453';
        if (network === 'Solana') chainId = 'solana';

        const url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${tokenAddress}`;

        const response = await fetch(url);
        const data: any = await response.json();

        if (!data.result || !data.result[tokenAddress.toLowerCase()]) {
            return { isSafe: true, score: 50, reason: '⚠️ No data from GoPlus' };
        }

        const info = data.result[tokenAddress.toLowerCase()];
        const issues = [];
        let score = 100;

        if (info.is_honeypot === '1') {
            score -= 100;
            issues.push('HONEYPOT');
        }
        if (info.cannot_sell_all === '1') {
            score -= 50;
            issues.push('CANNOT_SELL');
        }

        const buyTax = parseFloat(info.buy_tax || '0');
        const sellTax = parseFloat(info.sell_tax || '0');
        if (buyTax > 10) score -= (buyTax * 2);
        if (sellTax > 10) score -= (sellTax * 2);

        if (issues.length > 0) {
            return { isSafe: false, score: Math.max(0, score), reason: `🚨 Issues: ${issues.join(', ')} (BuyTax: ${buyTax}%, SellTax: ${sellTax}%)` };
        }

        return { isSafe: true, score: Math.max(0, score), reason: `✅ SAFE (BuyTax: ${buyTax}%, SellTax: ${sellTax}%)` };
    } catch (e: any) {
        return { isSafe: false, score: 0, reason: `Error: ${e.message}` };
    }
}

async function monitorEVM(networkName: string, wsUrl: string, factoryAddress: string) {
    if (!wsUrl) {
        console.log(`[${networkName}] ❌ WS URL not configured in .env`);
        return;
    }

    try {
        const provider = new ethers.WebSocketProvider(wsUrl);
        const factory = new ethers.Contract(factoryAddress, PAIR_CREATED_ABI, provider);

        console.log(`[${networkName}] 🟢 Monitoring Factory ${factoryAddress}...`);

        factory.on('PairCreated', async (token0, token1, pairAddress, pairIndex) => {
            console.log(`\n======================================================`);
            console.log(`[${networkName}] 🚀 NEW PAIR DETECTED!`);
            console.log(`======================================================`);
            console.log(`⏰ Time: ${new Date().toISOString()}`);
            console.log(`🔀 Token 0: ${token0}`);
            console.log(`🔀 Token 1: ${token1}`);
            console.log(`🏷️  Pair Address: ${pairAddress}`);

            // Assume Token 1 is the memecoin for logging purposes
            const security = await checkSecurity(networkName, token1);
            console.log(`🛡️  Security Analysis:`);
            console.log(`   ➔ Score: ${security.score}/100`);
            console.log(`   ➔ Status: ${security.reason}`);

            if (security.isSafe && security.score >= 90) {
                console.log(`   💰 Action: [SIMULATED BUY EXECUTED]`);
            } else {
                console.log(`   🛑 Action: [IGNORED - TOO RISKY]`);
            }
            console.log(`------------------------------------------------------\n`);
        });

        // Handle WebSocket disconnects gracefully
        if (provider.websocket && typeof (provider.websocket as any).on === 'function') {
            (provider.websocket as any).on('close', () => {
                console.log(`[${networkName}] ⚠️ WebSocket closed. Reconnecting...`);
                setTimeout(() => monitorEVM(networkName, wsUrl, factoryAddress), 5000);
            });
            (provider.websocket as any).on('error', (err: any) => {
                console.error(`[${networkName}] ❌ WebSocket Error: ${err.message}`);
                // Reconnect will trigger on close
            });
        }

    } catch (error: any) {
        console.error(`[${networkName}] ❌ Error connecting to WebSocket: ${error.message}`);
    }
}

async function monitorSolana(rpcUrl: string, wsUrl: string) {
    if (!rpcUrl || !wsUrl) {
        console.log(`[Solana] ❌ RPC or WS URL not configured in .env`);
        return;
    }

    try {
        const connection = new Connection(rpcUrl, {
            commitment: 'confirmed',
            wsEndpoint: wsUrl
        });

        const pumpFunProgramId = new PublicKey(PUMP_FUN_PROGRAM);

        console.log(`[Solana] 🟢 Monitoring Pump.fun Program ${PUMP_FUN_PROGRAM}...`);

        connection.onLogs(
            pumpFunProgramId,
            (logs) => {
                if (logs.err) return; // Skip failed transactions

                // Fast filter for "InitializeMint" or "MintTo" typical of pump.fun creations
                if (logs.logs.some(log => log.includes('Instruction: InitializeMint'))) {
                    console.log(`\n======================================================`);
                    console.log(`[Solana] 🚀 NEW PUMP.FUN TOKEN DETECTED!`);
                    console.log(`======================================================`);
                    console.log(`⏰ Time: ${new Date().toISOString()}`);
                    console.log(`📜 Signature: ${logs.signature}`);

                    // Fire async security check (not waiting in the event loop)
                    checkSecurity('Solana', logs.signature).then(security => {
                        console.log(`🛡️  Security Analysis (Solana):`);
                        console.log(`   ➔ Score: ${security.score}/100`);
                        console.log(`   ➔ Status: ${security.reason}`);

                        if (security.isSafe && security.score >= 90) {
                            console.log(`   💰 Action: [SIMULATED BUY EXECUTED]`);
                        } else {
                            console.log(`   🛑 Action: [IGNORED - TOO RISKY]`);
                        }
                        console.log(`------------------------------------------------------\n`);
                    });
                }
            },
            'confirmed'
        );

    } catch (error: any) {
        console.error(`[Solana] ❌ Error connecting to WebSocket: ${error.message}`);
    }
}

async function start() {
    console.log(`\n======================================================`);
    console.log(`🔬 STARTING MULTICHAIN SNIFFER TEST RUNNER 🔬`);
    console.log(`======================================================\n`);

    monitorEVM('BSC', BSC_WS_URL || '', PANCAKE_FACTORY_V2);
    monitorEVM('Base', BASE_WS_URL || '', UNISWAP_V2_FACTORY_BASE);
    monitorSolana(SOLANA_RPC_URL || '', SOLANA_WS_URL || '');
}

start();
