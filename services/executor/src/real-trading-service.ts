// Extensão do TradeExecutor para suportar Real Trading
import { Pool } from 'pg';
import { ExecutorFactory } from './blockchain/executor-factory';
import { WalletManager } from './blockchain/wallet-manager';
import { ethers } from 'ethers';

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

    /**
     * Executa compra REAL
     */
    async executeRealBuy(
        userId: string,
        tokenAddress: string,
        tokenSymbol: string,
        amountUSD: number,
        chain: string = 'BSC'
    ): Promise<{ success: boolean; txHash?: string; error?: string }> {
        try {
            console.log(`[RealTrading] 🔥 Executing REAL BUY for user ${userId} on ${chain}`);

            // 1. Obter private key
            const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
            const userResult = await this.pool.query('SELECT email FROM users WHERE id = $1', [userId]);
            const userEmail = (userResult.rows[0]?.email || '').trim().toLowerCase();
            const isAdmin = adminEmail && userEmail === adminEmail;

            let privateKey: string;
            if (isAdmin) {
                let encryptedKey = '';
                if (chain.toUpperCase() === 'SOLANA' || chain.toUpperCase() === 'SOL') {
                    encryptedKey = process.env.SOLANA_BOT_PRIVATE_KEY || '';
                }

                // Se não houver chave específica de Solana ou for outra chain, usar o BOT_WALLET_PRIVATE_KEY padrão
                if (!encryptedKey) {
                    encryptedKey = process.env.BOT_WALLET_PRIVATE_KEY || '';
                }

                if (!encryptedKey) throw new Error(`Master wallet private key not defined for ${chain}`);
                privateKey = await this.walletManager.decryptPrivateKey(encryptedKey);
                console.log(`[RealTrading] 👮 Admin using master wallet`);
            } else {
                const wallet = await this.walletManager.getWallet(userId, chain);
                if (!wallet) throw new Error(`User does not have a ${chain} wallet`);
                privateKey = await this.walletManager.decryptPrivateKey(wallet.encrypted_private_key);
            }

            // 2. Inicializar Executor
            const executor = ExecutorFactory.createExecutor(chain, this.pool);

            // 3. Segurança: Honeypot check (GoPlus)
            console.log(`[RealTrading] 🛡️ Honeypot check for ${tokenSymbol}...`);
            const hp = await this.checkHoneypot(tokenAddress, chain);
            if (!hp.isSafe) throw new Error(`Risk detected: ${hp.reason}`);

            // 4. Calcular quantidade nativa
            const nativePrice = await this.getNativePrice(chain);
            const amountNative = (amountUSD / nativePrice).toFixed(6);
            console.log(`[RealTrading] 💱 Trade size: ${amountNative} ${this.getNativeSymbol(chain)} ($${amountUSD})`);

            // 5. Executar Buy
            const result = await executor.buyToken({
                privateKey,
                tokenAddress,
                amountIn: amountNative,
                slippage: 2
            });

            if (!result.success) throw new Error(result.error || 'Buy transaction failed');

            console.log(`[RealTrading] ✅ SUCCESS! TX: ${result.txHash}`);
            return { success: true, txHash: result.txHash };

        } catch (error: any) {
            console.error(`[RealTrading] ❌ Real BUY failed:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Executa venda REAL
     */
    async executeRealSell(
        userId: string,
        tokenAddress: string,
        tokenSymbol: string,
        amountTokens: string,
        chain: string = 'BSC'
    ): Promise<{ success: boolean; txHash?: string; error?: string }> {
        try {
            console.log(`[RealTrading] 🔥 Executing REAL SELL for user ${userId} on ${chain}`);

            // 1. Obter private key
            const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
            const userResult = await this.pool.query('SELECT email FROM users WHERE id = $1', [userId]);
            const userEmail = (userResult.rows[0]?.email || '').trim().toLowerCase();
            const isAdmin = adminEmail && userEmail === adminEmail;

            let privateKey: string;
            if (isAdmin) {
                let encryptedKey = '';
                if (chain.toUpperCase() === 'SOLANA' || chain.toUpperCase() === 'SOL') {
                    encryptedKey = process.env.SOLANA_BOT_PRIVATE_KEY || '';
                }

                if (!encryptedKey) {
                    encryptedKey = process.env.BOT_WALLET_PRIVATE_KEY || '';
                }

                if (!encryptedKey) throw new Error(`Master wallet private key not defined for ${chain}`);
                privateKey = await this.walletManager.decryptPrivateKey(encryptedKey);
            } else {
                const wallet = await this.walletManager.getWallet(userId, chain);
                if (!wallet) throw new Error(`No wallet for ${chain}`);
                privateKey = await this.walletManager.decryptPrivateKey(wallet.encrypted_private_key);
            }

            // 2. Inicializar Executor
            const executor = ExecutorFactory.createExecutor(chain, this.pool);

            // 3. Executar Sell (Slippage alto para proteção em flash dumps)
            const result = await executor.sellToken({
                privateKey,
                tokenAddress,
                amountIn: amountTokens,
                slippage: 15
            });

            if (!result.success) throw new Error(result.error || 'Sell transaction failed');

            console.log(`[RealTrading] ✅ SUCCESS! TX: ${result.txHash}`);
            return { success: true, txHash: result.txHash };

        } catch (error: any) {
            console.error(`[RealTrading] ❌ Real SELL failed:`, error.message);
            return { success: false, error: error.message };
        }
    }

    async getRealBalance(userId: string): Promise<number> {
        // Se for admin, retornar balanço da carteira master (simplificado para BSC por enquanto)
        const residual = await this.getAdminResidualBalance(userId);
        if (residual !== null) return residual;

        const result = await this.pool.query(
            `SELECT COALESCE(SUM(amount_usd), 0) as balance FROM ledger_entries WHERE user_id = $1`,
            [userId]
        );
        return Number(result.rows[0]?.balance ?? 0);
    }

    async getAdminResidualBalance(userId: string): Promise<number | null> {
        const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
        const userResult = await this.pool.query('SELECT email FROM users WHERE id = $1', [userId]);
        const userEmail = (userResult.rows[0]?.email || '').trim().toLowerCase();

        if (userEmail !== adminEmail) return null;

        try {
            const masterAddress = process.env.BOT_DEPOSIT_ADDRESS;
            const bnbPrice = await this.getNativePrice('BSC');
            const provider = new ethers.JsonRpcProvider(process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org');

            if (masterAddress) {
                const balanceBNB = await provider.getBalance(masterAddress);
                return Number(ethers.formatEther(balanceBNB)) * bnbPrice;
            }
            return 0;
        } catch {
            return null;
        }
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
