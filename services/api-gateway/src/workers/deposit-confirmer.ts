import { Pool } from 'pg';
import { JsonRpcProvider, TransactionReceipt, TransactionResponse, formatEther } from 'ethers';

export class DepositConfirmer {
    private pool: Pool;
    private bscProvider: JsonRpcProvider;
    private interval: NodeJS.Timeout | null = null;

    constructor(pool: Pool, bscRpcUrl: string) {
        this.pool = pool;
        this.bscProvider = new JsonRpcProvider(bscRpcUrl);
    }

    /**
     * Iniciar worker de confirmação
     */
    async start(intervalSeconds: number = 15) {
        console.log(`[DepositConfirmer] 🚀 Starting worker (check every ${intervalSeconds}s)`);

        // Executar imediatamente na primeira vez
        await this.checkPendingDeposits();

        // Depois executar a cada intervalo
        this.interval = setInterval(async () => {
            await this.checkPendingDeposits();
        }, intervalSeconds * 1000);
    }

    /**
     * Verificar todos os depósitos pendentes
     */
    async checkPendingDeposits() {
        try {
            // 1. Buscar depósitos pendentes (até 48h atrás)
            const result = await this.pool.query(
                `SELECT id, user_id, tx_hash, amount_crypto, token_symbol, chain, wallet_address
         FROM deposits 
         WHERE status = 'pending' 
         AND created_at > NOW() - INTERVAL '48 hours'
         ORDER BY created_at ASC`
            );

            if (result.rows.length === 0) {
                return;
            }

            console.log(`[DepositConfirmer] 🔍 Checking ${result.rows.length} pending deposit(s)...`);

            for (const deposit of result.rows) {
                await this.verifyDeposit(deposit);
            }
        } catch (error: any) {
            console.error('[DepositConfirmer] ❌ Error checking deposits:', error.message);
        }
    }

    /**
     * Verificar um depósito específico
     */
    private async verifyDeposit(deposit: any) {
        try {
            const provider = deposit.chain === 'BSC' ? this.bscProvider : this.bscProvider; // TODO: adicionar Solana

            // 2. Verificar transação on-chain
            const receipt: TransactionReceipt | null = await provider.getTransactionReceipt(deposit.tx_hash);

            if (!receipt) {
                // Transação ainda não foi minerada
                return;
            }

            // 3. Calcular confirmações
            const currentBlock = await provider.getBlockNumber();
            const confirmations = Number(BigInt(currentBlock) - BigInt(receipt.blockNumber) + BigInt(1));

            // 4. Atualizar confirmações no banco
            await this.pool.query(
                `UPDATE deposits SET confirmations = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
                [confirmations, deposit.id]
            );

            console.log(`[DepositConfirmer] 📊 Deposit ${deposit.id} | TX: ${deposit.tx_hash.substring(0, 10)}... | Confirmations: ${confirmations}/3`);

            // 5. Se >= 3 confirmações e transação bem-sucedida, confirmar depósito
            if (confirmations >= 3) {
                if (receipt.status === 1) {
                    await this.confirmDeposit(deposit, receipt);
                } else {
                    // Transação falhou on-chain
                    await this.pool.query(
                        `UPDATE deposits SET status = 'failed' WHERE id = $1`,
                        [deposit.id]
                    );
                    console.log(`[DepositConfirmer] ❌ Deposit ${deposit.id} failed on-chain (tx reverted)`);
                }
            }
        } catch (error: any) {
            console.error(`[DepositConfirmer] Error verifying deposit ${deposit.id}:`, error.message);
        }
    }

    /**
     * Confirmar depósito e creditar usuário
     */
    private async confirmDeposit(deposit: any, receipt: TransactionReceipt) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Buscar valor real da transação
            const tx: TransactionResponse | null = await this.bscProvider.getTransaction(deposit.tx_hash);

            if (!tx || !tx.value) {
                throw new Error('Transaction not found or has no value');
            }

            const amountCrypto = Number(formatEther(tx.value));

            // 2. Converter para USD (preço aproximado - TODO: usar API de preço real)
            const prices: any = {
                BNB: 600,
                SOL: 100,
                ETH: 3500,
                USDT: 1,
                USDC: 1,
            };
            const amountUSD = amountCrypto * (prices[deposit.token_symbol] || 1);

            // 3. Atualizar depósito como confirmado
            await client.query(
                `UPDATE deposits 
         SET status = 'confirmed', 
             confirmed_at = CURRENT_TIMESTAMP,
             amount_crypto = $1,
             amount_usd = $2
         WHERE id = $3`,
                [amountCrypto, amountUSD, deposit.id]
            );

            // 4. Calcular saldo atual do usuário
            const balanceResult = await client.query(
                `SELECT 
           COALESCE(SUM(CASE WHEN entry_type IN ('deposit', 'trade_profit') THEN amount_usd ELSE 0 END), 0) AS credits,
           COALESCE(SUM(CASE WHEN entry_type IN ('withdrawal', 'trade_loss', 'fee', 'gas') THEN ABS(amount_usd) ELSE 0 END), 0) AS debits
         FROM ledger_entries
         WHERE user_id = $1`,
                [deposit.user_id]
            );

            const credits = Number(balanceResult.rows[0]?.credits ?? 0);
            const debits = Number(balanceResult.rows[0]?.debits ?? 0);
            const currentBalance = credits - debits;

            // 5. Creditar no ledger
            await client.query(
                `INSERT INTO ledger_entries (user_id, entry_type, amount_usd, balance_before, balance_after, description)
         VALUES ($1, 'deposit', $2, $3, $4, $5)`,
                [
                    deposit.user_id,
                    amountUSD,
                    currentBalance,
                    currentBalance + amountUSD,
                    `Deposit confirmed: ${deposit.tx_hash.substring(0, 10)}... (${amountCrypto.toFixed(6)} ${deposit.token_symbol})`
                ]
            );

            await client.query('COMMIT');

            console.log(`[DepositConfirmer] ✅ Deposit ${deposit.id} CONFIRMED! Credited $${amountUSD.toFixed(2)} to user ${deposit.user_id}`);
            console.log(`[DepositConfirmer] 💰 New balance: $${(currentBalance + amountUSD).toFixed(2)}`);
        } catch (error: any) {
            await client.query('ROLLBACK');
            console.error(`[DepositConfirmer] ❌ Error confirming deposit ${deposit.id}:`, error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Parar worker
     */
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
            console.log('[DepositConfirmer] 🛑 Worker stopped');
        }
    }
}
