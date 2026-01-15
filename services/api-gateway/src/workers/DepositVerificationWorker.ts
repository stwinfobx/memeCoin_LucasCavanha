import { Pool, PoolClient } from 'pg';
import { ethers } from 'ethers';

interface Deposit {
    id: string;
    user_id: string;
    tx_hash: string;
    wallet_address: string;
    chain: string;
    token_symbol: string;
    amount_crypto: string;
    amount_usd: string;
    confirmations: number;
    status: string;
}

export class DepositVerificationWorker {
    private pool: Pool;
    private provider: ethers.JsonRpcProvider;
    private isRunning = false;
    private intervalId?: NodeJS.Timeout;

    constructor(pool: Pool, rpcUrl: string) {
        this.pool = pool;
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
    }

    /**
     * Inicia o worker de verificação
     */
    start(intervalMs = 15000) {
        console.log('[DepositWorker] 🔄 Starting deposit verification worker...');
        console.log(`[DepositWorker] Interval: ${intervalMs}ms (${intervalMs / 1000}s)`);

        // Verificar imediatamente
        this.verifyPendingDeposits();

        // Depois verificar periodicamente
        this.intervalId = setInterval(async () => {
            if (this.isRunning) {
                console.log('[DepositWorker] ⏭️ Previous check still running, skipping...');
                return;
            }

            this.isRunning = true;
            await this.verifyPendingDeposits();
            this.isRunning = false;
        }, intervalMs);
    }

    /**
     * Para o worker
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            console.log('[DepositWorker] 🛑 Stopped');
        }
    }

    /**
     * Verifica todos os depósitos pendentes
     */
    async verifyPendingDeposits() {
        try {
            const result = await this.pool.query<Deposit>(
                `SELECT * FROM deposits WHERE status = 'pending' ORDER BY created_at ASC`
            );

            if (result.rows.length === 0) {
                console.log('[DepositWorker] ✓ No pending deposits');
                return;
            }

            console.log(`[DepositWorker] 📋 Found ${result.rows.length} pending deposit(s)`);

            for (const deposit of result.rows) {
                await this.verifyDeposit(deposit);
            }
        } catch (error: any) {
            console.error('[DepositWorker] ❌ Error verifying deposits:', error.message);
        }
    }

    /**
     * Verifica um depósito específico
     */
    async verifyDeposit(deposit: Deposit) {
        try {
            console.log(`[DepositWorker] 🔍 Checking TX: ${deposit.tx_hash.substring(0, 10)}...`);

            const receipt = await this.provider.getTransactionReceipt(deposit.tx_hash);

            if (!receipt) {
                console.log(`[DepositWorker] ⏳ TX ${deposit.tx_hash.substring(0, 10)}... not mined yet`);
                return;
            }

            // Verificar se transação falhou
            if (receipt.status === 0) {
                await this.markAsFailed(deposit.id, 'Transaction failed on blockchain');
                console.log(`[DepositWorker] ❌ TX ${deposit.tx_hash.substring(0, 10)}... FAILED`);
                return;
            }

            // Buscar confirmações
            const currentBlock = await this.provider.getBlockNumber();
            const txBlock = receipt.blockNumber;
            const confirmations = currentBlock - txBlock + 1;

            console.log(`[DepositWorker] 📊 TX ${deposit.tx_hash.substring(0, 10)}... has ${confirmations} confirmations`);

            // Atualizar confirmações no banco
            await this.pool.query(
                `UPDATE deposits SET confirmations = $1 WHERE id = $2`,
                [confirmations, deposit.id]
            );

            // Se tem 3+ confirmações, confirmar depósito
            if (confirmations >= 3) {
                await this.confirmDeposit(deposit, receipt);
            }
        } catch (error: any) {
            console.error(`[DepositWorker] ❌ Error verifying ${deposit.tx_hash}:`, error.message);

            // Se erro 404 (TX não encontrada), marcar como failed após 1 hora
            if (error.message.includes('not found') || error.code === 'TRANSACTION_NOT_FOUND') {
                const createdAt = new Date(deposit.created_at);
                const hourAgo = Date.now() - 60 * 60 * 1000;

                if (createdAt.getTime() < hourAgo) {
                    await this.markAsFailed(deposit.id, 'Transaction not found after 1 hour');
                }
            }
        }
    }

    /**
     * Confirma um depósito e credita saldo
     */
    async confirmDeposit(deposit: Deposit, receipt: ethers.TransactionReceipt) {
        const client = await this.pool.connect();

        try {
            await client.query('BEGIN');

            // Buscar preço do BNB (você pode integrar com oracle depois)
            const bnbPriceUSD = 600; // TODO: Integrar com Chainlink ou CoinGecko

            // Calcular valores
            const amountBNB = parseFloat(ethers.formatEther(receipt.value || '0'));
            const amountUSD = amountBNB * bnbPriceUSD;

            // Atualizar deposit
            await client.query(
                `UPDATE deposits 
                 SET status = 'confirmed', 
                     amount_crypto = $1, 
                     amount_usd = $2,
                     confirmed_at = CURRENT_TIMESTAMP
                 WHERE id = $3`,
                [amountBNB, amountUSD, deposit.id]
            );

            // Buscar saldo atual do usuário
            const balance = await this.getUserBalance(client, deposit.user_id);

            // Creditar saldo via ledger
            await client.query(
                `INSERT INTO ledger_entries (
                    user_id, 
                    entry_type, 
                    amount_usd, 
                    balance_before, 
                    balance_after, 
                    description
                )
                VALUES ($1, 'deposit', $2, $3, $4, $5)`,
                [
                    deposit.user_id,
                    amountUSD,
                    balance,
                    balance + amountUSD,
                    `Deposit confirmed: ${amountBNB.toFixed(6)} BNB (TX: ${deposit.tx_hash.substring(0, 10)}...)`
                ]
            );

            await client.query('COMMIT');

            console.log(`[DepositWorker] ✅ CONFIRMED: ${amountBNB.toFixed(6)} BNB ($${amountUSD.toFixed(2)}) for user ${deposit.user_id.substring(0, 8)}...`);
            console.log(`[DepositWorker] 💰 New balance: $${(balance + amountUSD).toFixed(2)}`);

            // TODO: Enviar e-mail de confirmação
            // await emailService.sendDepositConfirmedEmail(deposit.user_id, amountBNB, amountUSD);

        } catch (error: any) {
            await client.query('ROLLBACK');
            console.error('[DepositWorker] ❌ Error confirming deposit:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Marca depósito como falho
     */
    async markAsFailed(depositId: string, reason: string) {
        await this.pool.query(
            `UPDATE deposits SET status = 'failed', description = $1 WHERE id = $2`,
            [reason, depositId]
        );
        console.log(`[DepositWorker] ❌ Deposit ${depositId.substring(0, 8)}... marked as FAILED: ${reason}`);
    }

    /**
     * Busca saldo atual do usuário
     */
    async getUserBalance(client: PoolClient, userId: string): Promise<number> {
        const result = await client.query(
            `SELECT balance_after 
             FROM ledger_entries 
             WHERE user_id = $1 
             ORDER BY created_at DESC 
             LIMIT 1`,
            [userId]
        );

        return result.rows[0]?.balance_after || 0;
    }

    /**
     * Retorna estatísticas do worker
     */
    async getStats(): Promise<{
        pending: number;
        confirmed: number;
        failed: number;
        total_confirmed_usd: number;
    }> {
        const result = await this.pool.query(`
            SELECT 
                COUNT(*) FILTER (WHERE status = 'pending') as pending,
                COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed,
                COUNT(*) FILTER (WHERE status = 'failed') as failed,
                COALESCE(SUM(amount_usd) FILTER (WHERE status = 'confirmed'), 0) as total_confirmed_usd
            FROM deposits
        `);

        return {
            pending: Number(result.rows[0].pending),
            confirmed: Number(result.rows[0].confirmed),
            failed: Number(result.rows[0].failed),
            total_confirmed_usd: Number(result.rows[0].total_confirmed_usd)
        };
    }
}
