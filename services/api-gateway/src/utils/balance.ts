import { Pool } from 'pg';
import { ethers } from 'ethers';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const getAdminEmail = () => {
    const email = process.env.ADMIN_EMAIL;
    if (!email) {
        console.warn('[BalanceUtil] ⚠️ ADMIN_EMAIL not defined in .env! Admin identification will fail.');
    }
    return email || '';
};

// Cache para preços para evitar rate limit
let cachedPrices: Record<string, number> = {};
let lastPriceFetch = 0;

// Cache para saldo Admin (evitar spam de RPC)
let cachedAdminBalance: AdminBalanceData | null = null;
let lastAdminBalanceFetch = 0;
const ADMIN_BALANCE_CACHE_TTL = 15000; // REDUZIDO: 15 segundos para resposta rápida a depósitos

export interface ChainBalance {
    balance_usd: number;
    wallet_real_crypto: number;
    wallet_real_usd: number;
}

export interface AdminBalanceData {
    total_balance_usd: number;
    chains: {
        bsc: ChainBalance;
        base: ChainBalance;
        solana: ChainBalance;
    }
}

async function getLivePrices(): Promise<Record<string, number>> {
    const now = Date.now();
    if (now - lastPriceFetch < 60000 && Object.keys(cachedPrices).length > 0) {
        return cachedPrices;
    }

    try {
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=binancecoin,ethereum,solana&vs_currencies=usd');
        const data: any = await response.json();
        
        cachedPrices = {
            bsc: data.binancecoin?.usd || Number(process.env.BNB_PRICE || 600),
            base: data.ethereum?.usd || 3500,
            solana: data.solana?.usd || 180
        };
        lastPriceFetch = now;
        return cachedPrices;
    } catch (e) {
        console.error('[BalanceUtil] Failed to fetch prices:', e);
        return {
            bsc: Number(process.env.BNB_PRICE || 600),
            base: 3500,
            solana: 180
        };
    }
}

export async function getAdminBalance(pool: Pool, userId: string, userEmail: string): Promise<AdminBalanceData | null> {
    const adminEmail = getAdminEmail().trim().toLowerCase();
    const currentEmail = userEmail.trim().toLowerCase();

    if (currentEmail !== adminEmail) return null;

    const now = Date.now();
    if (cachedAdminBalance && (now - lastAdminBalanceFetch < ADMIN_BALANCE_CACHE_TTL)) {
        return cachedAdminBalance;
    }

    const prices = await getLivePrices();
    
    // EVM Addresses (BSC/Base)
    const evmAddress = process.env.BOT_DEPOSIT_ADDRESS;
    let solAddress = process.env.SOLANA_DEPOSIT_ADDRESS || process.env.NEXT_PUBLIC_SOLANA_DEPOSIT_ADDRESS || '';
    if (!solAddress) {
        try {
            if (process.env.SOLANA_BOT_PRIVATE_KEY) {
                const secretKey = bs58.decode(process.env.SOLANA_BOT_PRIVATE_KEY);
                const keypair = Keypair.fromSecretKey(secretKey);
                solAddress = keypair.publicKey.toBase58();
            }
        } catch (e) {}
    }

    const results: any = { bsc: {}, base: {}, solana: {} };

    // --- 1. BSC Residue ---
    try {
        const bscProvider = new ethers.JsonRpcProvider(process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org');
        const bscBal = Number(ethers.formatEther(await bscProvider.getBalance(evmAddress!)));
        const bscTotalUSD = bscBal * prices.bsc;
        
        const bscOther = await pool.query(
            "SELECT COALESCE(SUM(amount_usd), 0) as total FROM ledger_entries WHERE user_id != $1 AND chain = 'BSC' AND description NOT ILIKE '%paper%'",
            [userId]
        );
        const bscOtherTotal = Number(bscOther.rows[0].total);
        const bscResidue = Math.max(0, bscTotalUSD - bscOtherTotal);
        
        console.log(`[BalanceUtil] 🏦 BSC Residue breakdown:`, {
            wallet_real_bnb: bscBal,
            wallet_real_usd: bscTotalUSD,
            total_other_users_usd: bscOtherTotal,
            residue_usd: bscResidue
        });

        results.bsc = { balance_usd: bscResidue, wallet_real_crypto: bscBal, wallet_real_usd: bscTotalUSD };
    } catch (e) { results.bsc = { balance_usd: 0, wallet_real_crypto: 0, wallet_real_usd: 0 }; }

    // --- 2. BASE Residue ---
    try {
        const baseProvider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL || 'https://mainnet.base.org');
        const baseBal = Number(ethers.formatEther(await baseProvider.getBalance(evmAddress!)));
        const baseTotalUSD = baseBal * prices.base;
        
        const baseOther = await pool.query(
            "SELECT COALESCE(SUM(amount_usd), 0) as total FROM ledger_entries WHERE user_id != $1 AND chain = 'BASE' AND description NOT ILIKE '%paper%'",
            [userId]
        );
        const baseOtherTotal = Number(baseOther.rows[0].total);
        const baseResidue = Math.max(0, baseTotalUSD - baseOtherTotal);

        console.log(`[BalanceUtil] 🏦 BASE Residue breakdown:`, {
            wallet_real_eth: baseBal,
            wallet_real_usd: baseTotalUSD,
            total_other_users_usd: baseOtherTotal,
            residue_usd: baseResidue
        });

        results.base = { balance_usd: baseResidue, wallet_real_crypto: baseBal, wallet_real_usd: baseTotalUSD };
    } catch (e) { results.base = { balance_usd: 0, wallet_real_crypto: 0, wallet_real_usd: 0 }; }

    // --- 3. SOLANA Residue ---
    if (solAddress) {
        try {
            const solConn = new Connection(process.env.SOLANA_RPC_URL || 'https://solana-rpc.publicnode.com');
            const solBal = (await solConn.getBalance(new PublicKey(solAddress))) / 1e9;
            const solTotalUSD = solBal * prices.solana;
            
            const solOther = await pool.query(
                "SELECT COALESCE(SUM(amount_usd), 0) as total FROM ledger_entries WHERE user_id != $1 AND chain = 'SOLANA' AND description NOT ILIKE '%paper%'",
                [userId]
            );
            const solResidue = Math.max(0, solTotalUSD - Number(solOther.rows[0].total));
            results.solana = { balance_usd: solResidue, wallet_real_crypto: solBal, wallet_real_usd: solTotalUSD };
        } catch (e) { results.solana = { balance_usd: 0, wallet_real_crypto: 0, wallet_real_usd: 0 }; }
    } else {
        results.solana = { balance_usd: 0, wallet_real_crypto: 0, wallet_real_usd: 0 };
    }

    const finalResult = {
        total_balance_usd: results.bsc.balance_usd + results.base.balance_usd + results.solana.balance_usd,
        chains: results,
        debug_info: {
            bsc_raw: results.bsc.wallet_real_usd,
            bsc_residue: results.bsc.balance_usd,
            last_fetch: new Date(now).toLocaleString()
        }
    };

    console.log(`[BalanceUtil] 🏦 RESIDUE CALCULATION:`, {
        BSC_WALLET_USD: results.bsc.wallet_real_usd.toFixed(2),
        BSC_RESIDUE_USD: results.bsc.balance_usd.toFixed(2),
        SOL_WALLET_USD: results.solana.wallet_real_usd.toFixed(2),
        SOL_RESIDUE_USD: results.solana.balance_usd.toFixed(2),
    });

    cachedAdminBalance = finalResult;
    lastAdminBalanceFetch = now;

    return finalResult;
}
