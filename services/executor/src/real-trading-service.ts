// Extensão do TradeExecutor para suportar Real Trading
import { Pool } from 'pg';
import { ExecutorFactory } from './blockchain/executor-factory';
import { WalletManager } from './blockchain/wallet-manager';
import { ethers } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';

export class RealTradingService {
    private pool: Pool;
    private walletManager: WalletManager;
    private static cachedNativePrices: Record<string, number> = {};

    constructor(pool: Pool) {
        this.pool = pool;
        this.walletManager = new WalletManager(pool);
    }

    /**
     * Busca o preço da moeda nativa da chain
     */
    private async getNativePrice(chain: string): Promise<number> {
        const symbol = this.getNativeSymbol(chain);
        const cacheKey = symbol;

        // Tentar buscar preço real via API simples (Coingecko)
        try {
            let coinId = '';
            if (symbol === 'BNB') coinId = 'binancecoin';
            if (symbol === 'SOL') coinId = 'solana';
            if (symbol === 'ETH') coinId = 'ethereum';

            if (coinId) {
                const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`);
                const data: any = await response.json();
                if (data && data[coinId] && typeof data[coinId].usd === 'number') {
                    const price = data[coinId].usd;
                    RealTradingService.cachedNativePrices[cacheKey] = price;
                    return price;
                }
            }
        } catch (e) {
            console.error(`[RealTradingService] Failed to fetch ${symbol} price:`, e);
        }

        // Fallback para cache ou env
        if (RealTradingService.cachedNativePrices[cacheKey]) {
            return RealTradingService.cachedNativePrices[cacheKey];
        }

        if (symbol === 'BNB') return Number(process.env.BNB_PRICE || 600);
        if (symbol === 'SOL') return Number(process.env.SOL_PRICE || 140);
        if (symbol === 'ETH') return Number(process.env.ETH_PRICE || 3500);

        return 1;
    }

    private getNativeSymbol(chain: string): string {
        const c = chain.toUpperCase();
        if (c === 'SOLANA' || c === 'SOL') return 'SOL';
        if (c === 'BASE' || c === 'ETH' || c === 'ETHEREUM') return 'ETH';
        return 'BNB';
    }

    private getChainIdForGoPlus(chain: string): string {
        const c = chain.toUpperCase();
        if (c === 'BSC' || c === 'BINANCE') return '56';
        if (c === 'ETHEREUM' || c === 'ETH') return '1';
        if (c === 'BASE') return '8453';
        if (c === 'SOLANA' || c === 'SOL') return 'solana';
        return '56';
    }

    /**
     * Verifica se usuário tem real trading habilitado
     */
    async isRealTradingEnabled(userId: string): Promise<boolean> {
        const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
        const userResult = await this.pool.query('SELECT email FROM users WHERE id = $1', [userId]);
        const userEmail = (userResult.rows[0]?.email || '').trim().toLowerCase();

        if (adminEmail && userEmail === adminEmail) {
            return true;
        }

        const result = await this.pool.query(
            'SELECT real_trading_enabled FROM user_profiles WHERE user_id = $1',
            [userId]
        );
        return result.rows[0]?.real_trading_enabled ?? false;
    }

    private getBalanceColumn(chain: string): string {
        const c = chain.toUpperCase();
        if (c === 'SOLANA' || c === 'SOL') return 'balance_solana';
        if (c === 'BASE') return 'balance_base';
        return 'balance_bsc';
    }

    /**
     * Executa compra REAL com isolamento de tesouraria
     */
    async executeRealBuy(
        userId: string,
        tokenAddress: string,
        tokenSymbol: string,
        amountUSD: number,
        chain: string = 'BSC'
    ): Promise<{ success: boolean; txHash?: string; error?: string }> {
        const client = await this.pool.connect();
        try {
            console.log(`[RealTrading] 🔥 Executing REAL BUY for user ${userId} on ${chain}`);
            
            await client.query('BEGIN');

            // 1. Verificar Saldo Isolado
            const balanceCol = this.getBalanceColumn(chain);
            const userRes = await client.query(
                `SELECT ${balanceCol}, email FROM users WHERE id = $1 FOR UPDATE`,
                [userId]
            );
            
            if (userRes.rows.length === 0) throw new Error('User not found');
            
            const currentBalance = Number(userRes.rows[0][balanceCol] || 0);
            const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
            const userEmail = (userRes.rows[0].email || '').trim().toLowerCase();
            const isAdmin = adminEmail && userEmail === adminEmail;

            // Admin tem saldo "infinito" se houver capital na master wallet, mas usuários normais são limitados
            if (!isAdmin && currentBalance < amountUSD) {
                throw new Error(`Insufficient ${chain} balance. Available: $${currentBalance}`);
            }

            // 2. Obter canal de execução e chave
            let privateKey: string;
            if (isAdmin) {
                let encryptedKey = '';
                const isSolana = chain.toUpperCase() === 'SOLANA' || chain.toUpperCase() === 'SOL';
                if (isSolana) {
                    encryptedKey = process.env.SOLANA_BOT_PRIVATE_KEY || '';
                    if (!encryptedKey) {
                        // Fallback emergencial: se não houver chave SOLANA exclusiva, tentar a global
                        console.warn(`[RealTrading] ⚠️ SOLANA_BOT_PRIVATE_KEY missing, using BOT_WALLET_PRIVATE_KEY fallback`);
                        encryptedKey = process.env.BOT_WALLET_PRIVATE_KEY || '';
                    }
                } else {
                    encryptedKey = process.env.BOT_WALLET_PRIVATE_KEY || '';
                }
                
                if (!encryptedKey) throw new Error(`Master wallet key not defined for ${chain}`);
                privateKey = await this.walletManager.decryptPrivateKey(encryptedKey);
            } else {
                const wallet = await this.walletManager.getWallet(userId, chain);
                if (!wallet) throw new Error(`No wallet found for user on ${chain}`);
                privateKey = await this.walletManager.decryptPrivateKey(wallet.encrypted_private_key);
            }

            // 3. Segurança & Cálculo
            const hp = await this.checkHoneypot(tokenAddress, chain);
            if (!hp.isSafe) throw new Error(`Risk: ${hp.reason}`);

            const nativePrice = await this.getNativePrice(chain);
            const amountNative = (amountUSD / nativePrice).toFixed(6);

            // 4. Deduzir saldo ANTES da execução (lock preventivo)
            if (!isAdmin) {
                await client.query(
                    `UPDATE users SET ${balanceCol} = ${balanceCol} - $1 WHERE id = $2`,
                    [amountUSD, userId]
                );
            }

            // 5. Executar Transação On-Chain
            const executor = ExecutorFactory.createExecutor(chain, this.pool);
            const result = await executor.buyToken({
                privateKey,
                tokenAddress,
                amountIn: amountNative,
                slippage: 3
            });

            if (!result.success) throw new Error(result.error || 'Transaction failed');

            // 6. Registrar Ledger com Chain específica
            await client.query(
                `INSERT INTO ledger_entries (user_id, type, amount_usd, description, chain) 
                 VALUES ($1, 'BUY', $2, $3, $4)`,
                [userId, -amountUSD, `Real Buy: ${tokenSymbol} on ${chain}`, chain.toUpperCase()]
            );

            await client.query('COMMIT');
            console.log(`[RealTrading] ✅ BUY SUCCESS! TX: ${result.txHash}`);
            return { success: true, txHash: result.txHash };

        } catch (error: any) {
            await client.query('ROLLBACK');
            console.error(`[RealTrading] ❌ Real BUY failed:`, error.message);
            return { success: false, error: error.message };
        } finally {
            client.release();
        }
    }

    /**
     * Executa venda REAL com atualização de tesouraria
     */
    async executeRealSell(
        userId: string,
        tokenAddress: string,
        tokenSymbol: string,
        amountTokens: string,
        receivedUSD: number, // Valor estimado ou real recebido
        chain: string = 'BSC'
    ): Promise<{ success: boolean; txHash?: string; error?: string }> {
        const client = await this.pool.connect();
        try {
            console.log(`[RealTrading] 🔥 Executing REAL SELL for user ${userId} on ${chain}`);
            await client.query('BEGIN');

            // 1. Obter Key
            const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
            const userRes = await client.query('SELECT email FROM users WHERE id = $1', [userId]);
            const isAdmin = adminEmail && userRes.rows[0]?.email === adminEmail;

            let privateKey: string;
            if (isAdmin) {
                let encryptedKey = (chain.toUpperCase() === 'SOLANA') ? process.env.SOLANA_BOT_PRIVATE_KEY : process.env.BOT_WALLET_PRIVATE_KEY;
                if (!encryptedKey) encryptedKey = process.env.BOT_WALLET_PRIVATE_KEY;
                privateKey = await this.walletManager.decryptPrivateKey(encryptedKey!);
            } else {
                const wallet = await this.walletManager.getWallet(userId, chain);
                privateKey = await this.walletManager.decryptPrivateKey(wallet!.encrypted_private_key);
            }

            // 2. Executar Venda
            const executor = ExecutorFactory.createExecutor(chain, this.pool);
            const result = await executor.sellToken({
                privateKey,
                tokenAddress,
                amountIn: amountTokens,
                slippage: 15
            });

            if (!result.success) throw new Error(result.error || 'Sell failed');

            // 3. Recompor Saldo (Profit/Loss)
            const balanceCol = this.getBalanceColumn(chain);
            if (!isAdmin) {
                await client.query(
                    `UPDATE users SET ${balanceCol} = ${balanceCol} + $1 WHERE id = $2`,
                    [receivedUSD, userId]
                );
            }

            // 4. Ledger entry
            await client.query(
                `INSERT INTO ledger_entries (user_id, type, amount_usd, description, chain) 
                 VALUES ($1, 'SELL', $2, $3, $4)`,
                [userId, receivedUSD, `Real Sell: ${tokenSymbol} on ${chain}`, chain.toUpperCase()]
            );

            await client.query('COMMIT');
            return { success: true, txHash: result.txHash };

        } catch (error: any) {
            await client.query('ROLLBACK');
            return { success: false, error: error.message };
        } finally {
            client.release();
        }
    }

    async getRealBalance(userId: string): Promise<number> {
        // Agora retorna a soma das 3 chains para o total, mas o executor deve usar individualmente
        const res = await this.pool.query(
            'SELECT (balance_bsc + balance_base + balance_solana) as total FROM users WHERE id = $1',
            [userId]
        );
        return Number(res.rows[0]?.total || 0);
    }

    async getAdminResidualBalance(userId: string): Promise<number | null> {
        // Redirecionar para lógica robusta multi-chain (deve simular o que o api-gateway faz)
        const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
        const userResult = await this.pool.query('SELECT email FROM users WHERE id = $1', [userId]);
        const userEmail = (userResult.rows[0]?.email || '').trim().toLowerCase();

        if (userEmail !== adminEmail) return null;

        try {
            // Soma os resíduos on-chain por chain
            const bsc = await this.getChainResidue('BSC');
            const sol = await this.getChainResidue('SOLANA');
            const base = await this.getChainResidue('BASE');
            
            console.log(`[AdminBalance] Residuals: BSC=$${bsc.toFixed(2)}, SOL=$${sol.toFixed(2)}, BASE=$${base.toFixed(2)}`);
            return bsc + sol + base;
        } catch (e) {
            console.error('[AdminBalance] Error calculating residual:', e);
            return null;
        }
    }

    private async getChainResidue(chain: string): Promise<number> {
        try {
            const price = await this.getNativePrice(chain);
            let address = '';
            
            if (chain.toUpperCase() === 'SOLANA' || chain.toUpperCase() === 'SOL') {
                // Derivar endereço da Master Key se houver
                if (process.env.SOLANA_BOT_PRIVATE_KEY) {
                    try {
                        const bs58 = require('bs58');
                        const { Keypair } = require('@solana/web3.js');
                        const secretKey = bs58.decode(process.env.SOLANA_BOT_PRIVATE_KEY);
                        const keypair = Keypair.fromSecretKey(secretKey);
                        address = keypair.publicKey.toBase58();
                    } catch { address = 'I1MUH2UARAKG41INDJMXR18GJ7J46MQJ9C'; }
                } else {
                    address = 'I1MUH2UARAKG41INDJMXR18GJ7J46MQJ9C';
                }
            } else {
                address = process.env.BOT_DEPOSIT_ADDRESS || '';
            }
            
            if (!address) return 0;

            if (chain === 'SOLANA') {
                const conn = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
                const bal = await conn.getBalance(new PublicKey(address));
                return (bal / 1e9) * price;
            } else {
                const rpc = chain === 'BASE' ? process.env.BASE_RPC_URL : process.env.BSC_RPC_URL;
                const provider = new ethers.JsonRpcProvider(rpc || 'https://bsc-dataseed1.binance.org');
                const bal = await provider.getBalance(address);
                return (Number(ethers.formatEther(bal))) * price;
            }
        } catch { return 0; }
    }

    async checkHoneypot(tokenAddress: string, chain: string): Promise<{ isSafe: boolean; reason: string }> {
        try {
            const chainId = this.getChainIdForGoPlus(chain);
            const url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${tokenAddress}`;

            const response = await fetch(url);
            const data: any = await response.json();

            if (!data.result || !data.result[tokenAddress.toLowerCase()]) {
                return { isSafe: true, reason: 'No data from security API' };
            }

            const info = data.result[tokenAddress.toLowerCase()];
            const issues = [];

            if (info.is_honeypot === '1') issues.push('HONEYPOT');
            if (info.cannot_sell_all === '1') issues.push('CANNOT_SELL');
            if (parseFloat(info.buy_tax || '0') > 50) issues.push(`HIGH_BUY_TAX(${info.buy_tax}%)`);
            if (parseFloat(info.sell_tax || '0') > 50) issues.push(`HIGH_SELL_TAX(${info.sell_tax}%)`);

            if (issues.length > 0) return { isSafe: false, reason: issues.join(', ') };
            return { isSafe: true, reason: 'Passed GoPlus checks' };
        } catch {
            return { isSafe: true, reason: 'Security check skipped (API error)' };
        }
    }
}
