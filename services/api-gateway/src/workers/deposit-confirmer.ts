import { Pool } from 'pg';
import { JsonRpcProvider, TransactionReceipt, formatEther } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';

export class DepositConfirmer {
    private pool: Pool;
    private bscProvider: JsonRpcProvider;
    private baseProvider: JsonRpcProvider;
    private solanaConnection: Connection;
    private interval: NodeJS.Timeout | null = null;

    constructor(pool: Pool, bscRpcUrl: string, baseRpcUrl: string, solanaRpcUrl: string) {
        this.pool = pool;
        this.bscProvider = new JsonRpcProvider(bscRpcUrl);
        this.baseProvider = new JsonRpcProvider(baseRpcUrl);
        this.solanaConnection = new Connection(solanaRpcUrl, 'confirmed');
    }

    async start(intervalSeconds: number = 15) {
        console.log(`[DepositConfirmer] 🚀 Multi-Chain worker started (check every ${intervalSeconds}s)`);
        await this.checkPendingDeposits();
        this.interval = setInterval(async () => {
            await this.checkPendingDeposits();
        }, intervalSeconds * 1000);
    }

    async checkPendingDeposits() {
        try {
            const result = await this.pool.query(
                `SELECT id, user_id, tx_hash, amount_crypto, token_symbol, chain, wallet_address
         FROM deposits 
         WHERE status = 'pending' 
         AND created_at > NOW() - INTERVAL '48 hours'
         ORDER BY created_at ASC`
            );

            if (result.rows.length === 0) return;

            for (const deposit of result.rows) {
                if (deposit.chain === 'SOLANA') {
                    await this.verifySolanaDeposit(deposit);
                } else {
                    await this.verifyEvmDeposit(deposit);
                }
            }
        } catch (error: any) {
            console.error('[DepositConfirmer] ❌ error:', error.message);
        }
    }

    private async verifyEvmDeposit(deposit: any) {
        try {
            const provider = deposit.chain === 'BASE' ? this.baseProvider : this.bscProvider;
            const receipt: TransactionReceipt | null = await provider.getTransactionReceipt(deposit.tx_hash);
            if (!receipt) return;

            const currentBlock = await provider.getBlockNumber();
            const confirmations = Number(BigInt(currentBlock) - BigInt(receipt.blockNumber) + BigInt(1));

            await this.pool.query(
                `UPDATE deposits SET confirmations = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
                [confirmations, deposit.id]
            );

            if (confirmations >= 3) {
                if (receipt.status === 1) {
                    const tx = await provider.getTransaction(deposit.tx_hash);
                    if (tx) {
                        await this.confirmDeposit(deposit, Number(formatEther(tx.value)));
                    }
                } else {
                    await this.pool.query(`UPDATE deposits SET status = 'failed' WHERE id = $1`, [deposit.id]);
                }
            }
        } catch (e: any) { console.error(`[DepositConfirmer/EVM] ${deposit.id} error:`, e.message); }
    }

    private async verifySolanaDeposit(deposit: any) {
        try {
            const status = await this.solanaConnection.getSignatureStatus(deposit.tx_hash);
            if (!status || !status.value) return;

            const isConfirmed = status.value.confirmationStatus === 'confirmed' || status.value.confirmationStatus === 'finalized';
            const confirmations = status.value.confirmations || (isConfirmed ? 3 : 0);

            await this.pool.query(
                `UPDATE deposits SET confirmations = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
                [confirmations, deposit.id]
            );

            if (isConfirmed && !status.value.err) {
                const tx = await this.solanaConnection.getParsedTransaction(deposit.tx_hash, { maxSupportedTransactionVersion: 0 });
                if (!tx) return;
                
                // Pegar valor depositado (simplificado: saldo pós - saldo pré do indexador 1, que costuma ser o destino)
                // TODO: No futuro validar exatamente se o destino é o MASTER WALLET
                const solAmount = (tx.meta?.postBalances[1] || 0) - (tx.meta?.preBalances[1] || 0);
                await this.confirmDeposit(deposit, solAmount / 1e9);
            } else if (status.value.err) {
                await this.pool.query(`UPDATE deposits SET status = 'failed' WHERE id = $1`, [deposit.id]);
            }
        } catch (e: any) { console.error(`[DepositConfirmer/SOL] ${deposit.id} error:`, e.message); }
    }

    private async confirmDeposit(deposit: any, actualAmountCrypto: number) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            const prices: any = await this.getPrices();
            const amountUSD = actualAmountCrypto * (prices[deposit.chain.toLowerCase()] || 1);

            // 1. Atualizar depósito
            await client.query(
                `UPDATE deposits SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP, amount_crypto = $1, amount_usd = $2 WHERE id = $3`,
                [actualAmountCrypto, amountUSD, deposit.id]
            );

            // 2. Creditar no Ledger (e carregar saldo para antes/depois)
            const chainCol = `balance_${deposit.chain.toLowerCase()}`;
            const userBal = await client.query(`SELECT ${chainCol} FROM users WHERE id = $1`, [deposit.user_id]);
            const balanceBefore = Number(userBal.rows[0]?.[chainCol] || 0);

            await client.query(
                `INSERT INTO ledger_entries (user_id, entry_type, amount_usd, balance_before, balance_after, description, chain)
                 VALUES ($1, 'deposit', $2, $3, $4, $5, $6)`,
                [deposit.user_id, amountUSD, balanceBefore, balanceBefore + amountUSD, `Deposit ${deposit.tx_hash.substring(0,8)}`, deposit.chain]
            );

            // 3. Atualizar saldo rápido na tabela users
            await client.query(
                `UPDATE users SET ${chainCol} = ${chainCol} + $1 WHERE id = $2`,
                [amountUSD, deposit.user_id]
            );

            await client.query('COMMIT');
            console.log(`[DepositConfirmer] ✅ Confirmed $${amountUSD.toFixed(2)} on ${deposit.chain} for user ${deposit.user_id}`);
        } catch (e: any) {
            await client.query('ROLLBACK');
            throw e;
        } finally { client.release(); }
    }

    private async getPrices() {
        try {
            const resp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=binancecoin,ethereum,solana&vs_currencies=usd');
            const data: any = await resp.json();
            return { 
                bsc: data.binancecoin?.usd || 600, 
                base: data.ethereum?.usd || 3500, 
                solana: data.solana?.usd || 180 
            };
        } catch { return { bsc: 600, base: 3500, solana: 180 }; }
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }
}
