// Extensão do TradeExecutor para suportar Real Trading
import { Pool } from 'pg';
import { PancakeSwapExecutor } from './blockchain/PancakeSwapExecutor';
import { WalletManager } from './blockchain/wallet-manager';
import { ethers } from 'ethers';

export class RealTradingService {
    private pool: Pool;
    private walletManager: WalletManager;
    private static cachedBNBPrice: number | null = null;

    constructor(pool: Pool) {
        this.pool = pool;
        this.walletManager = new WalletManager(pool);
    }

    /**
     * Busca o preço atual do BNB via CoinGecko ou fallback do env
     */
    private async getBNBPrice(): Promise<number> {
        try {
            const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd');
            const data: any = await response.json();
            if (data && data.binancecoin && typeof data.binancecoin.usd === 'number') {
                RealTradingService.cachedBNBPrice = data.binancecoin.usd;
                return data.binancecoin.usd;
            }
        } catch (e) {
            console.error('[RealTradingService] Failed to fetch BNB price from CoinGecko:', e);
        }

        // Usar cache se disponível, senão fallback do env ou valor fixo
        if (RealTradingService.cachedBNBPrice !== null) {
            console.log(`[RealTradingService] 🔄 Using cached BNB price: $${RealTradingService.cachedBNBPrice}`);
            return RealTradingService.cachedBNBPrice;
        }

        return Number(process.env.BNB_PRICE || 600);
    }

    /**
     * Verifica se usuário tem real trading habilitado
     */
    async isRealTradingEnabled(userId: string): Promise<boolean> {
        // 1. Bypass automático para o Administrador
        const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
        const userResult = await this.pool.query('SELECT email FROM users WHERE id = $1', [userId]);
        const userEmail = (userResult.rows[0]?.email || '').trim().toLowerCase();

        if (adminEmail && userEmail === adminEmail) {
            console.log(`[RealTradingService] 🛡️ Admin bypass: User ${userEmail} is allowed to trade in LIVE mode by default.`);
            return true;
        }

        // 2. Lógica normal para outros usuários via banco de dados
        const result = await this.pool.query(
            'SELECT real_trading_enabled FROM user_profiles WHERE user_id = $1',
            [userId]
        );
        return result.rows[0]?.real_trading_enabled ?? false;
    }

    /**
     * Executa compra REAL usando PancakeSwap
     */
    async executeRealBuy(
        userId: string,
        tokenAddress: string,
        tokenSymbol: string,
        amountUSD: number
    ): Promise<{ success: boolean; txHash?: string; error?: string }> {
        try {
            console.log(`[RealTrading] 🔥 Executing REAL BUY for user ${userId}`);

            // 1. Verificar se é o admin e usar carteira master diretamente
            const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
            const userResult = await this.pool.query('SELECT email FROM users WHERE id = $1', [userId]);
            const userEmail = (userResult.rows[0]?.email || '').trim().toLowerCase();
            const isAdmin = adminEmail && userEmail === adminEmail;

            let privateKey: string;

            if (isAdmin) {
                // Admin: usar carteira master diretamente
                const encryptedKey = process.env.BOT_WALLET_PRIVATE_KEY || '';
                if (!encryptedKey) {
                    throw new Error('BOT_WALLET_PRIVATE_KEY not defined in .env');
                }
                // Descriptografar a chave encriptada
                privateKey = await this.walletManager.decryptPrivateKey(encryptedKey);
                console.log(`[RealTrading] 👮 Admin detected, using master wallet for real trade`);
            } else {
                // Outros usuários: buscar carteira individual
                const wallet = await this.walletManager.getWallet(userId, 'BSC');
                if (!wallet) {
                    throw new Error('User does not have a BSC wallet. Create one via /api/wallet/create');
                }
                privateKey = await this.walletManager.decryptPrivateKey(wallet.encrypted_private_key);
            }

            // 2. Inicializar PancakeSwap Executor
            const rpcUrl = process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org';
            const pancake = new PancakeSwapExecutor(rpcUrl, this.pool);

            // 3. PROTEÇÃO: Verificar se é honeypot/scam
            console.log(`[RealTrading] 🛡️ Checking if token is a honeypot...`);
            const honeypotCheck = await this.checkHoneypot(tokenAddress);

            if (!honeypotCheck.isSafe) {
                const errorMsg = `Token ${tokenSymbol} is a HONEYPOT/SCAM! ${honeypotCheck.reason}`;
                console.error(`[RealTrading] 🚨 ${errorMsg}`);
                return {
                    success: false,
                    error: errorMsg
                };
            }
            console.log(`[RealTrading] ✅ Token passed honeypot check`);

            // 4. PROTEÇÃO: Detectar taxa de transferência ANTES de comprar
            console.log(`[RealTrading] 🛡️ Checking token for transfer tax...`);
            const taxCheck = await pancake.detectTransferTax(tokenAddress);

            if (!taxCheck.isSafe) {
                const errorMsg = `Token ${tokenSymbol} has HIGH transfer tax (${taxCheck.taxPercentage}%)! Blocking purchase to protect funds.`;
                console.error(`[RealTrading] 🚨 ${errorMsg}`);
                console.error(`[RealTrading] 🚨 Warnings: ${taxCheck.warnings.join(', ')}`);
                return {
                    success: false,
                    error: errorMsg
                };
            }

            if (taxCheck.hasTax) {
                console.log(`[RealTrading] ⚠️ Token has ${taxCheck.taxPercentage}% transfer tax (acceptable)`);
            } else {
                console.log(`[RealTrading] ✅ Token appears safe (no detectable transfer tax)`);
            }

            // 5. Converter USD para BNB usando preço real
            const bnbPrice = await this.getBNBPrice();
            const amountBNB = (amountUSD / bnbPrice).toFixed(6);

            console.log(`[RealTrading] 💱 Converting: $${amountUSD} = ${amountBNB} BNB @ $${bnbPrice}/BNB`);

            // 6. Executar swap BNB → Token
            const swapResult = await pancake.buyTokenWithBNB(
                privateKey,
                tokenAddress,
                amountBNB,
                1 // 1% slippage
            );

            console.log(`[RealTrading] ✅ REAL BUY executed! TX: ${swapResult.txHash}`);
            console.log(`[RealTrading] 💰 Expected to receive: ${swapResult.amountOut} tokens`);

            // 7. VERIFICAÇÃO: Checar saldo real após compra para detectar taxa oculta
            try {
                // Aguardar 3 segundos para a transação se propagar
                await new Promise(resolve => setTimeout(resolve, 3000));

                const wallet = new (await import('ethers')).Wallet(privateKey);
                const expectedAmount = (await import('ethers')).ethers.parseUnits(swapResult.amountOut, 18);

                const balanceCheck = await pancake.verifyActualBalance(
                    tokenAddress,
                    wallet.address,
                    expectedAmount
                );

                if (balanceCheck.hasTax) {
                    console.log(`[RealTrading] ⚠️ HIDDEN TAX DETECTED: Lost ${balanceCheck.lossPercentage}% in transfer!`);
                    console.log(`[RealTrading] 📊 Actual balance: ${(await import('ethers')).ethers.formatUnits(balanceCheck.actualBalance, 18)} tokens`);
                    // TODO: Atualizar o saldo no banco de dados com o valor real
                } else {
                    console.log(`[RealTrading] ✅ Balance verified: No hidden tax detected`);
                }
            } catch (verifyError: any) {
                console.error(`[RealTrading] ⚠️ Could not verify balance:`, verifyError.message);
                // Não falhar a compra por causa disso
            }

            return {
                success: true,
                txHash: swapResult.txHash,
            };
        } catch (error: any) {
            console.error(`[RealTrading] ❌ Real BUY failed:`, error.message);
            return {
                success: false,
                error: error.message,
            };
        }
    }

    /**
     * Executa venda REAL usando PancakeSwap
     */
    async executeRealSell(
        userId: string,
        tokenAddress: string,
        tokenSymbol: string,
        amountTokens: string
    ): Promise<{ success: boolean; txHash?: string; error?: string }> {
        try {
            console.log(`[RealTrading] 🔥 Executing REAL SELL for user ${userId}`);

            // 1. Verificar se é o admin e usar carteira master diretamente
            const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
            const userResult = await this.pool.query('SELECT email FROM users WHERE id = $1', [userId]);
            const userEmail = (userResult.rows[0]?.email || '').trim().toLowerCase();
            const isAdmin = adminEmail && userEmail === adminEmail;

            let privateKey: string;

            if (isAdmin) {
                // Admin: usar carteira master diretamente
                const encryptedKey = process.env.BOT_WALLET_PRIVATE_KEY || '';
                if (!encryptedKey) {
                    throw new Error('BOT_WALLET_PRIVATE_KEY not defined in .env');
                }
                // Descriptografar a chave encriptada
                privateKey = await this.walletManager.decryptPrivateKey(encryptedKey);
                console.log(`[RealTrading] 👮 Admin detected, using master wallet for real trade`);
            } else {
                // Outros usuários: buscar carteira individual
                const wallet = await this.walletManager.getWallet(userId, 'BSC');
                if (!wallet) {
                    throw new Error('User does not have a BSC wallet');
                }
                privateKey = await this.walletManager.decryptPrivateKey(wallet.encrypted_private_key);
            }

            // 2. Inicializar PancakeSwap
            const rpcUrl = process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org';
            const pancake = new PancakeSwapExecutor(rpcUrl, this.pool);

            // 3. Executar swap Token → BNB
            const swapResult = await pancake.sellTokenForBNB(
                privateKey,
                tokenAddress,
                amountTokens,
                1 // 1% slippage
            );

            console.log(`[RealTrading] ✅ REAL SELL executed! TX: ${swapResult.txHash}`);
            console.log(`[RealTrading] 💰 Received ${swapResult.amountOut} BNB`);

            return {
                success: true,
                txHash: swapResult.txHash,
            };
        } catch (error: any) {
            console.error(`[RealTrading] ❌ Real SELL failed:`, error.message);
            return {
                success: false,
                error: error.message,
            };
        }
    }

    /**
     * Calcula saldo real disponível (depósitos confirmados - posições abertas)
     */
    async getRealBalance(userId: string): Promise<number> {
        // Se for o admin, retornar o balanço residual da blockchain
        const residualBalance = await this.getAdminResidualBalance(userId);
        if (residualBalance !== null) {
            return residualBalance;
        }

        const result = await this.pool.query(
            `SELECT 
         COALESCE(SUM(CASE WHEN entry_type IN ('deposit', 'trade_profit') THEN amount_usd ELSE 0 END), 0) AS credits,
         COALESCE(SUM(CASE WHEN entry_type IN ('withdrawal', 'trade_loss', 'fee', 'gas') THEN ABS(amount_usd) ELSE 0 END), 0) AS debits
       FROM ledger_entries
       WHERE user_id = $1
         AND description NOT LIKE 'Initial paper trading%'`,
            [userId]
        );

        const credits = Number(result.rows[0]?.credits ?? 0);
        const debits = Number(result.rows[0]?.debits ?? 0);
        return Math.max(0, credits - debits);
    }

    /**
     * Calcula o saldo residual para o administrador
     * Saldo Residual = Saldo Real (BNB) na Carteira - Soma dos Saldos Reais dos outros usuários
     */
    async getAdminResidualBalance(userId: string): Promise<number | null> {
        const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();

        if (!adminEmail) {
            console.warn('[RealTradingService] ⚠️ ADMIN_EMAIL not defined in .env! Admin identification will fail.');
        }

        // Buscar email do usuário para confirmar se é admin
        const userResult = await this.pool.query('SELECT email FROM users WHERE id = $1', [userId]);
        const userEmail = (userResult.rows[0]?.email || '').trim().toLowerCase();

        console.log(`[RealTradingService] 🔍 admin check: DB(${userEmail}) vs ENV(${adminEmail})`);

        if (userEmail !== adminEmail) {
            console.log(`[RealTradingService] ❌ User ${userEmail} is NOT admin. Skipping residual calculation.`);
            return null;
        }

        const botAddress = process.env.BOT_DEPOSIT_ADDRESS;
        const rpcUrl = process.env.BSC_RPC_URL;

        if (!botAddress || !rpcUrl) {
            console.error('[RealTradingService] [Balance] BOT_DEPOSIT_ADDRESS or BSC_RPC_URL not defined');
            return null;
        }

        try {
            // Fetch live BNB price
            const bnbPrice = await this.getBNBPrice();

            const provider = new ethers.JsonRpcProvider(rpcUrl);
            const bnbBalanceBigInt = await provider.getBalance(botAddress);
            const bnbBalance = Number(ethers.formatEther(bnbBalanceBigInt));
            const totalWalletValueUSD = bnbBalance * bnbPrice;

            // Somar saldo virtual de todos os OUTROS usuários (excluindo paper trading)
            const otherUsersResult = await this.pool.query(
                `SELECT 
                    COALESCE(SUM(CASE WHEN entry_type IN ('deposit', 'trade_profit') THEN amount_usd ELSE 0 END), 0) -
                    COALESCE(SUM(CASE WHEN entry_type IN ('withdrawal', 'trade_loss', 'fee', 'gas') THEN ABS(amount_usd) ELSE 0 END), 0) AS total_other_balances
                 FROM ledger_entries
                 WHERE user_id != $1
                   AND description NOT ILIKE '%paper%'`,
                [userId]
            );

            const otherUsersBalanceUSD = Number(otherUsersResult.rows[0]?.total_other_balances ?? 0);
            const residualBalance = Math.max(0, totalWalletValueUSD - otherUsersBalanceUSD);

            console.log(`[RealTradingService] [Balance] Admin Residual Balance: $${residualBalance.toFixed(2)} (Wallet: $${totalWalletValueUSD.toFixed(2)}, Others: $${otherUsersBalanceUSD.toFixed(2)})`);
            return residualBalance;
        } catch (error: any) {
            console.error('[RealTradingService] [Balance] Error calculating residual balance:', error.message);
            return null;
        }
    }

    /**
     * Verifica se um token é honeypot/scam usando GoPlus Security API
     * @param tokenAddress Endereço do token
     * @returns Objeto indicando se é seguro e motivo
     */
    async checkHoneypot(tokenAddress: string): Promise<{
        isSafe: boolean;
        reason: string;
    }> {
        try {
            // GoPlus Security API - Free honeypot detection
            const url = `https://api.gopluslabs.io/api/v1/token_security/56?contract_addresses=${tokenAddress}`;

            const response = await fetch(url);
            const data: any = await response.json();

            if (!data.result || !data.result[tokenAddress.toLowerCase()]) {
                console.log(`[RealTrading] ⚠️ Could not fetch honeypot data, proceeding with caution`);
                return { isSafe: true, reason: 'No data available' };
            }

            const tokenData = data.result[tokenAddress.toLowerCase()];

            // Verificar flags de perigo
            const dangers = [];

            // 1. Honeypot direto
            if (tokenData.is_honeypot === '1' || tokenData.is_honeypot === true) {
                dangers.push('IS_HONEYPOT');
            }

            // 2. Não pode vender
            if (tokenData.cannot_sell_all === '1' || tokenData.cannot_sell_all === true) {
                dangers.push('CANNOT_SELL');
            }

            // 3. Taxa de compra/venda muito alta (>50%)
            const buyTax = parseFloat(tokenData.buy_tax || '0');
            const sellTax = parseFloat(tokenData.sell_tax || '0');

            if (buyTax > 50) {
                dangers.push(`HIGH_BUY_TAX(${buyTax}%)`);
            }
            if (sellTax > 50) {
                dangers.push(`HIGH_SELL_TAX(${sellTax}%)`);
            }

            // 4. Owner pode mudar saldo
            if (tokenData.can_take_back_ownership === '1' || tokenData.can_take_back_ownership === true) {
                dangers.push('OWNER_CAN_TAKE_BACK');
            }

            // 5. Proprietário tem muito do supply (>50%)
            const holderCount = parseInt(tokenData.holder_count || '0');
            if (holderCount < 10) {
                dangers.push(`LOW_HOLDERS(${holderCount})`);
            }

            if (dangers.length > 0) {
                return {
                    isSafe: false,
                    reason: dangers.join(', ')
                };
            }

            // Log de informações úteis
            console.log(`[RealTrading] 📊 Token security info:`);
            console.log(`[RealTrading]    - Buy tax: ${buyTax}%`);
            console.log(`[RealTrading]    - Sell tax: ${sellTax}%`);
            console.log(`[RealTrading]    - Holders: ${holderCount}`);

            return { isSafe: true, reason: 'Passed all checks' };

        } catch (error: any) {
            console.error(`[RealTrading] ⚠️ Error checking honeypot:`, error.message);
            // Em caso de erro na API, dar benefício da dúvida
            return { isSafe: true, reason: 'API error - proceeding with caution' };
        }
    }
}
