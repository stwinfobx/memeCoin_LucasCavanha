import { ethers, Wallet, Contract } from 'ethers';
import { Pool } from 'pg';
import { TradeExecutor, BuyParams, SellParams, TradeResult } from './types';

const PANCAKESWAP_ROUTER_V2 = '0x10ED43C718714eb63d5aA57B78B54704E256024E'; // BSC Mainnet
const WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'; // Wrapped BNB

const ROUTER_ABI = [
    'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
    'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
    'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
    'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
    'function getAmountsIn(uint amountOut, address[] memory path) public view returns (uint[] memory amounts)'
];

const ERC20_ABI = [
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function allowance(address owner, address spender) external view returns (uint256)',
    'function balanceOf(address account) external view returns (uint256)',
    'function decimals() external view returns (uint8)'
];

export interface SwapResult {
    txHash: string;
    amountIn: string;
    amountOut: string;
    gasUsed: string;
    effectiveGasPrice: string;
}

export class PancakeSwapExecutor implements TradeExecutor {
    private provider: ethers.JsonRpcProvider;
    private router: Contract;
    private pool: Pool;

    constructor(rpcUrl: string, pool: Pool) {
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        this.router = new Contract(PANCAKESWAP_ROUTER_V2, ROUTER_ABI, this.provider);
        this.pool = pool;
    }

    async buyToken(params: BuyParams): Promise<TradeResult> {
        try {
            const result = await this.buyTokenWithBNB(params.privateKey, params.tokenAddress, params.amountIn, params.slippage);
            return {
                ...result,
                success: true
            };
        } catch (error: any) {
            return {
                txHash: '',
                amountIn: params.amountIn,
                amountOut: '0',
                success: false,
                error: error.message
            };
        }
    }

    async sellToken(params: SellParams): Promise<TradeResult> {
        try {
            const result = await this.sellTokenForBNB(params.privateKey, params.tokenAddress, params.amountIn, params.slippage);
            return {
                ...result,
                success: true
            };
        } catch (error: any) {
            return {
                txHash: '',
                amountIn: params.amountIn,
                amountOut: '0',
                success: false,
                error: error.message
            };
        }
    }

    async getBalance(walletAddress: string, tokenAddress?: string): Promise<string> {
        if (!tokenAddress || tokenAddress === ethers.ZeroAddress || tokenAddress === 'BNB') {
            return this.getBNBBalance(walletAddress);
        }
        return this.getTokenBalance(walletAddress, tokenAddress);
    }

    /**
     * Compra token usando BNB
     * @param privateKey Chave privada da wallet
     * @param tokenAddress Endereço do token a comprar
     * @param amountBNB Quantidade de BNB a gastar
     * @param slippagePercent Slippage tolerância (padrão 1%)
     */
    async buyTokenWithBNB(
        privateKey: string,
        tokenAddress: string,
        amountBNB: string,
        slippagePercent: number = 1
    ): Promise<SwapResult> {
        const wallet = new Wallet(privateKey, this.provider);
        const routerWithSigner = this.router.connect(wallet);

        console.log(`[PancakeSwap] 🛒 Buying token ${tokenAddress} with ${amountBNB} BNB...`);

        const path = [WBNB_ADDRESS, tokenAddress];
        const amountIn = ethers.parseEther(amountBNB);

        try {
            // Estimar quantidade de tokens que receberá
            const amounts = await this.router.getAmountsOut(amountIn, path);
            const expectedAmountOut = amounts[1];

            // Aplicar slippage
            const amountOutMin = (expectedAmountOut * BigInt(100 - slippagePercent)) / BigInt(100);

            console.log(`[PancakeSwap] Expected output: ${ethers.formatUnits(expectedAmountOut, 18)} tokens`);
            console.log(`[PancakeSwap] Minimum output (${slippagePercent}% slippage): ${ethers.formatUnits(amountOutMin, 18)} tokens`);

            // --- Pre-flight Balance & Gas Check ---
            const balance = await this.provider.getBalance(wallet.address);
            const feeData = await this.provider.getFeeData();
            const gasPrice = feeData.gasPrice || BigInt(3000000000); // 3 gwei fallback
            const estimatedGasCost = gasPrice * BigInt(300000);
            const totalRequired = amountIn + estimatedGasCost;

            if (balance < totalRequired) {
                console.error(`[PancakeSwap] ❌ Insufficient balance for BUY. Have: ${ethers.formatEther(balance)} BNB, Need: ${ethers.formatEther(totalRequired)} BNB`);
                throw new Error(`Insufficient BNB balance for trade and gas`);
            }
            // --- End Pre-flight Check ---

            // Deadline: 20 minutos a partir de agora
            const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

            // Executar swap
            const tx = await (routerWithSigner as any).swapExactETHForTokens(
                amountOutMin,
                path,
                wallet.address,
                deadline,
                {
                    value: amountIn,
                    gasLimit: 300000 // Gas limit para evitar out of gas
                }
            );

            console.log(`[PancakeSwap] 📤 Transaction sent: ${tx.hash}`);
            console.log(`[PancakeSwap] ⏳ Waiting for confirmation...`);

            const receipt = await tx.wait();

            if (receipt.status === 0) {
                throw new Error('Transaction reverted by EVM');
            }

            console.log(`[PancakeSwap] ✅ Transaction confirmed! Block: ${receipt.blockNumber}`);

            return {
                txHash: receipt.hash,
                amountIn: amountBNB,
                amountOut: ethers.formatUnits(expectedAmountOut, 18),
                gasUsed: receipt.gasUsed.toString(),
                effectiveGasPrice: receipt.gasPrice?.toString() || '0'
            };
        } catch (error: any) {
            console.error('[PancakeSwap] ❌ Buy failed:', error.message);
            if (error.code === 'CALL_EXCEPTION' || error.message.includes('revert')) {
                throw new Error(`EVM Revert during buy: ${error.reason || error.message}`);
            } else if (error.code === 'INSUFFICIENT_FUNDS' || error.message.includes('insufficient funds')) {
                throw new Error('Insufficient BNB balance for trade and gas');
            }
            throw new Error(`PancakeSwap buy failed: ${error.message}`);
        }
    }

    /**
     * Vende token por BNB
     * @param privateKey Chave privada da wallet
     * @param tokenAddress Endereço do token a vender
     * @param amountToken Quantidade de tokens a vender
     * @param slippagePercent Slippage tolerância (padrão 1%)
     */
    async sellTokenForBNB(
        privateKey: string,
        tokenAddress: string,
        amountToken: string,
        slippagePercent: number = 10
    ): Promise<SwapResult> {
        const wallet = new Wallet(privateKey, this.provider);
        const routerWithSigner = this.router.connect(wallet);

        console.log(`[PancakeSwap] 💰 Selling ${amountToken} of token ${tokenAddress} for BNB...`);

        const path = [tokenAddress, WBNB_ADDRESS];

        try {
            // Buscar decimals do token
            const tokenContract = new Contract(tokenAddress, ERC20_ABI, this.provider);
            const tokenWithSigner = tokenContract.connect(wallet);
            const decimals = await tokenContract.decimals();

            console.log(`[PancakeSwap] 🔍 Token decimals: ${decimals}`);

            // FIX: Arredondar para evitar "too many decimals"
            const roundedAmount = parseFloat(amountToken).toFixed(Number(decimals));
            const amountIn = ethers.parseUnits(roundedAmount, decimals);

            console.log(`[PancakeSwap] 📊 Amount to sell: ${roundedAmount} tokens (${amountIn.toString()} wei)`);

            // Verificar saldo do token
            const balance = await tokenContract.balanceOf(wallet.address);
            console.log(`[PancakeSwap] 💰 Wallet balance: ${ethers.formatUnits(balance, decimals)} tokens`);

            // FIX: Se o saldo real for menor que o solicitado, vender o que está disponível
            // Isso acontece com tokens que têm taxa de transferência ou são deflacionários
            let actualAmountIn = amountIn;
            if (balance < amountIn) {
                console.log(`[PancakeSwap] ⚠️ Balance mismatch detected!`);
                console.log(`[PancakeSwap]    - Requested: ${roundedAmount} tokens`);
                console.log(`[PancakeSwap]    - Available: ${ethers.formatUnits(balance, decimals)} tokens`);
                console.log(`[PancakeSwap]    - Difference: ${ethers.formatUnits(amountIn - balance, decimals)} tokens (${(((amountIn - balance) * BigInt(100)) / amountIn).toString()}%)`);

                if (balance === BigInt(0)) {
                    throw new Error(`No tokens available in wallet. This position may have been already sold or the token has a 100% transfer tax.`);
                }

                console.log(`[PancakeSwap] 🔄 Adjusting sell amount to available balance: ${ethers.formatUnits(balance, decimals)} tokens`);
                actualAmountIn = balance;
            }

            // SEMPRE aprovar antes de vender (fix para bug de allowance)
            console.log('[PancakeSwap] 🔓 Approving token spend...');
            // Limit approval if necessary...
            const allowance = await tokenContract.allowance(wallet.address, PANCAKESWAP_ROUTER_V2);
            if (allowance < actualAmountIn) {
                console.log(`[PancakeSwap] 🔓 Approving token...`);

                // Pre-flight approval gas check
                const bnbBalance = await this.provider.getBalance(wallet.address);
                const feeData = await this.provider.getFeeData();
                const gasPrice = feeData.gasPrice || BigInt(3000000000);
                const approvalGasCost = gasPrice * BigInt(100000);

                if (bnbBalance < approvalGasCost) {
                    throw new Error(`Insufficient BNB balance for token approval gas`);
                }

                const txApprove = await (tokenWithSigner as any).approve(PANCAKESWAP_ROUTER_V2, ethers.MaxUint256, {
                    gasLimit: 100000
                });
                await txApprove.wait();
                console.log(`[PancakeSwap] ✅ Token approved`);
            }

            // Verificar se há liquidez suficiente
            console.log('[PancakeSwap] 🔍 Checking liquidity...');
            const amounts = await this.router.getAmountsOut(actualAmountIn, path);
            const expectedAmountOut = amounts[1];

            if (expectedAmountOut === BigInt(0)) {
                throw new Error('No liquidity available for this token pair');
            }

            // Aplicar slippage
            const amountOutMin = (expectedAmountOut * BigInt(100 - slippagePercent)) / BigInt(100);

            console.log(`[PancakeSwap] Expected output: ${ethers.formatEther(expectedAmountOut)} BNB`);
            console.log(`[PancakeSwap] Minimum output (${slippagePercent}% slippage): ${ethers.formatEther(amountOutMin)} BNB`);

            // --- Pre-flight gas check for sell ---
            const bnbBalance = await this.provider.getBalance(wallet.address);
            const feeData = await this.provider.getFeeData();
            const gasPrice = feeData.gasPrice || BigInt(3000000000);
            const swapGasCost = gasPrice * BigInt(300000);

            if (bnbBalance < swapGasCost) {
                throw new Error(`Insufficient BNB balance for sell gas. Need at least ${ethers.formatEther(swapGasCost)} BNB`);
            }
            // --- End Check ---

            // Deadline: 20 minutos
            const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

            console.log(`[PancakeSwap] 🚀 Executing swap...`);
            console.log(`[PancakeSwap]    - AmountIn: ${actualAmountIn.toString()}`);
            console.log(`[PancakeSwap]    - AmountOutMin: ${amountOutMin.toString()}`);
            console.log(`[PancakeSwap]    - Path: ${path.join(' -> ')}`);
            console.log(`[PancakeSwap]    - Deadline: ${deadline}`);

            // Executar swap
            const tx = await (routerWithSigner as any).swapExactTokensForETH(
                actualAmountIn,
                amountOutMin,
                path,
                wallet.address,
                deadline,
                { gasLimit: 500000 } // Aumentado de 300k para 500k
            );

            console.log(`[PancakeSwap] 📤 Transaction sent: ${tx.hash}`);
            console.log(`[PancakeSwap] ⏳ Waiting for confirmation...`);

            const receipt = await tx.wait();

            if (receipt.status === 0) {
                throw new Error('Transaction reverted by EVM');
            }

            console.log(`[PancakeSwap] ✅ Sell transaction confirmed! Block: ${receipt.blockNumber}`);

            return {
                txHash: receipt.hash,
                amountIn: amountToken,
                amountOut: ethers.formatEther(expectedAmountOut),
                gasUsed: receipt.gasUsed.toString(),
                effectiveGasPrice: receipt.gasPrice?.toString() || '0'
            };
        } catch (error: any) {
            console.error('[PancakeSwap] ❌ Sell failed:', error.message);
            if (error.code === 'CALL_EXCEPTION' || error.message.includes('revert')) {
                throw new Error(`EVM Revert during sell: ${error.reason || error.message}`);
            } else if (error.code === 'INSUFFICIENT_FUNDS' || error.message.includes('insufficient funds')) {
                throw new Error('Insufficient BNB balance for sell gas');
            }

            // Detectar erro de replacement underpriced (transação pendente)
            const isReplacementError = error.code === 'REPLACEMENT_UNDERPRICED' ||
                error.message?.includes('replacement transaction underpriced');

            if (isReplacementError) {
                console.log(`[PancakeSwap] ⏸️ Transaction pending, waiting 10 seconds before retry...`);
                await new Promise(resolve => setTimeout(resolve, 10000)); // Aguardar 10s
            }

            // Retry com slippage maior se falhou
            if (slippagePercent < 20) {
                const newSlippage = slippagePercent + 5;
                console.log(`[PancakeSwap] 🔄 Retrying with ${newSlippage}% slippage...`);

                // Aguardar 5 segundos antes de retry para evitar conflitos de nonce
                if (!isReplacementError) {
                    console.log(`[PancakeSwap] ⏸️ Waiting 5 seconds before retry...`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }

                return this.sellTokenForBNB(privateKey, tokenAddress, amountToken, newSlippage);
            }

            throw new Error(`PancakeSwap sell failed: ${error.message}`);
        }
    }

    /**
     * Estima quantidade de tokens que receberá ao comprar com BNB
     */
    async estimateBuyOutput(tokenAddress: string, amountBNB: string): Promise<string> {
        const path = [WBNB_ADDRESS, tokenAddress];
        const amountIn = ethers.parseEther(amountBNB);

        const amounts = await this.router.getAmountsOut(amountIn, path);
        return ethers.formatUnits(amounts[1], 18);
    }

    /**
     * Estima quantidade de BNB que receberá ao vender tokens
     */
    async estimateSellOutput(tokenAddress: string, amountToken: string): Promise<string> {
        const tokenContract = new Contract(tokenAddress, ERC20_ABI, this.provider);
        const decimals = await tokenContract.decimals();

        const path = [tokenAddress, WBNB_ADDRESS];
        const amountIn = ethers.parseUnits(amountToken, decimals);

        const amounts = await this.router.getAmountsOut(amountIn, path);
        return ethers.formatEther(amounts[1]);
    }

    /**
     * Verifica se wallet tem allowance suficiente para o token
     */
    async checkAllowance(walletAddress: string, tokenAddress: string): Promise<boolean> {
        const tokenContract = new Contract(tokenAddress, ERC20_ABI, this.provider);
        const allowance = await tokenContract.allowance(walletAddress, PANCAKESWAP_ROUTER_V2);
        return allowance > 0;
    }

    /**
     * Busca saldo de token de uma wallet
     */
    async getTokenBalance(walletAddress: string, tokenAddress: string): Promise<string> {
        const tokenContract = new Contract(tokenAddress, ERC20_ABI, this.provider);
        const balance = await tokenContract.balanceOf(walletAddress);
        const decimals = await tokenContract.decimals();
        return ethers.formatUnits(balance, decimals);
    }

    /**
     * Busca saldo de BNB de uma wallet
     */
    async getBNBBalance(walletAddress: string): Promise<string> {
        const balance = await this.provider.getBalance(walletAddress);
        return ethers.formatEther(balance);
    }

    /**
     * Estima gas para uma transação de compra
     */
    async estimateBuyGas(
        privateKey: string,
        tokenAddress: string,
        amountBNB: string
    ): Promise<{ gasLimit: bigint; gasPrice: bigint; totalCost: string }> {
        const wallet = new Wallet(privateKey, this.provider);
        const routerWithSigner = this.router.connect(wallet);

        const path = [WBNB_ADDRESS, tokenAddress];
        const amountIn = ethers.parseEther(amountBNB);
        const amounts = await this.router.getAmountsOut(amountIn, path);
        const amountOutMin = (amounts[1] * BigInt(99)) / BigInt(100); // 1% slippage
        const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

        const gasLimit = await (routerWithSigner as any).swapExactETHForTokens.estimateGas(
            amountOutMin,
            path,
            wallet.address,
            deadline,
            { value: amountIn }
        );

        const feeData = await this.provider.getFeeData();
        const gasPrice = feeData.gasPrice || BigInt(5000000000); // 5 Gwei padrão

        const totalCost = ethers.formatEther(gasLimit * gasPrice);

        return {
            gasLimit,
            gasPrice,
            totalCost
        };
    }

    /**
     * Detecta a taxa de transferência de um token
     * Verifica funções comuns de taxa no contrato
     * @param tokenAddress Endereço do token a verificar
     * @returns Objeto com informações sobre a taxa
     */
    async detectTransferTax(
        tokenAddress: string
    ): Promise<{
        hasTax: boolean;
        taxPercentage: number;
        isSafe: boolean;
        warnings: string[];
    }> {
        try {
            console.log(`[PancakeSwap] 🔍 Detecting transfer tax for token ${tokenAddress}...`);

            const extendedABI = [
                ...ERC20_ABI,
                'function _taxFee() external view returns (uint256)',
                'function _liquidityFee() external view returns (uint256)',
                'function buyTax() external view returns (uint256)',
                'function sellTax() external view returns (uint256)',
                'function totalFees() external view returns (uint256)',
                'function transferTax() external view returns (uint256)',
                'function _buyTax() external view returns (uint256)',
                'function _sellTax() external view returns (uint256)'
            ];

            const tokenContract = new Contract(tokenAddress, extendedABI, this.provider);
            let maxTax = 0;
            const warnings: string[] = [];

            // Tentar ler taxas comuns
            const taxFunctions = [
                { name: '_taxFee', type: 'general' },
                { name: '_liquidityFee', type: 'liquidity' },
                { name: 'buyTax', type: 'buy' },
                { name: 'sellTax', type: 'sell' },
                { name: 'totalFees', type: 'total' },
                { name: 'transferTax', type: 'transfer' },
                { name: '_buyTax', type: 'buy' },
                { name: '_sellTax', type: 'sell' }
            ];

            for (const { name, type } of taxFunctions) {
                try {
                    const taxValue = await (tokenContract as any)[name]();
                    // Taxas geralmente são em base 100 ou 10000
                    let taxNum = Number(taxValue);

                    // Se o valor for muito alto, provavelmente está em base 10000
                    if (taxNum > 100) {
                        taxNum = taxNum / 100; // Converter de base 10000 para porcentagem
                    }

                    if (taxNum > 0) {
                        console.log(`[PancakeSwap] 📌 Found ${name} (${type}): ${taxNum}%`);
                        warnings.push(`${type} tax: ${taxNum}%`);
                        maxTax = Math.max(maxTax, taxNum);
                    }
                } catch {
                    // Função não existe, continuar
                }
            }

            const hasTax = maxTax > 0;
            const isSafe = maxTax <= 10; // Máximo 10% de taxa

            if (!isSafe) {
                warnings.push(`⚠️ HIGH TAX DETECTED: ${maxTax}% - This token may be a scam!`);
            }

            console.log(`[PancakeSwap] ${isSafe ? '✅' : '🚨'} Transfer tax detection result:`);
            console.log(`[PancakeSwap]    - Has tax: ${hasTax}`);
            console.log(`[PancakeSwap]    - Max tax: ${maxTax}%`);
            console.log(`[PancakeSwap]    - Is safe: ${isSafe}`);
            if (warnings.length > 0) {
                console.log(`[PancakeSwap]    - Warnings: ${warnings.join(', ')}`);
            }

            return {
                hasTax,
                taxPercentage: maxTax,
                isSafe,
                warnings
            };

        } catch (error: any) {
            console.error('[PancakeSwap] ⚠️ Could not detect transfer tax:', error.message);
            // Em caso de erro, assumir seguro (dar benefício da dúvida)
            return {
                hasTax: false,
                taxPercentage: 0,
                isSafe: true,
                warnings: ['Could not detect tax - proceeding with caution']
            };
        }
    }

    /**
     * Verifica o saldo real após uma compra e retorna a diferença
     * @param tokenAddress Endereço do token
     * @param walletAddress Endereço da carteira
     * @param expectedAmount Quantidade esperada
     * @returns Saldo real e porcentagem de perda
     */
    async verifyActualBalance(
        tokenAddress: string,
        walletAddress: string,
        expectedAmount: bigint
    ): Promise<{
        actualBalance: bigint;
        lossPercentage: number;
        hasTax: boolean;
    }> {
        try {
            const tokenContract = new Contract(tokenAddress, ERC20_ABI, this.provider);
            const decimals = await tokenContract.decimals();
            const actualBalance = await tokenContract.balanceOf(walletAddress);

            const loss = expectedAmount - actualBalance;
            const lossPercentage = Number((loss * BigInt(100)) / expectedAmount);

            console.log(`[PancakeSwap] 📊 Balance verification:`);
            console.log(`[PancakeSwap]    - Expected: ${ethers.formatUnits(expectedAmount, decimals)}`);
            console.log(`[PancakeSwap]    - Actual: ${ethers.formatUnits(actualBalance, decimals)}`);
            console.log(`[PancakeSwap]    - Loss: ${lossPercentage}%`);

            return {
                actualBalance,
                lossPercentage,
                hasTax: lossPercentage > 1 // Mais de 1% de perda indica taxa
            };
        } catch (error: any) {
            console.error('[PancakeSwap] ❌ Could not verify balance:', error.message);
            throw error;
        }
    }

    /**
     * Verifica a idade do token (quando foi criado)
     * @param tokenAddress Endereço do token
     * @param maxAgeDays Idade máxima permitida em dias (padrão: 1)
     * @returns Objeto indicando se é novo o suficiente
     */
    async checkTokenAge(
        tokenAddress: string,
        maxAgeDays: number = 1
    ): Promise<{
        isNew: boolean;
        ageInDays: number;
        createdAt: Date | null;
        reason: string;
    }> {
        try {
            console.log(`[PancakeSwap] 🕐 Checking token age...`);

            // Buscar o bloco de criação do contrato
            // Fazemos isso buscando o primeiro evento Transfer do contrato
            const tokenContract = new Contract(tokenAddress, [
                'event Transfer(address indexed from, address indexed to, uint256 value)'
            ], this.provider);

            // Buscar o primeiro Transfer (mint) - from address(0)
            const filter = tokenContract.filters.Transfer(ethers.ZeroAddress, null);

            // Buscar eventos dos últimos 1000 blocos (aproximadamente 1 mês na BSC)
            const currentBlock = await this.provider.getBlockNumber();
            const fromBlock = Math.max(0, currentBlock - 1000000); // ~1 mês atrás

            const events = await tokenContract.queryFilter(filter, fromBlock, currentBlock);

            if (events.length === 0) {
                console.log(`[PancakeSwap] ⚠️ Could not find token creation event in scan range`);
                // Se não achou evento de criação recente (último mês), assume que é VELHO
                // Para sniping, queremos certeza que é novo (< 24h)
                return {
                    isNew: false,
                    ageInDays: 999, // Valor alto para indicar antiguidade
                    createdAt: null,
                    reason: 'Token creation not found in recent history (likely > 30 days old)'
                };
            }

            // Pegar o primeiro evento (criação do token)
            const firstEvent = events[0];
            const block = await this.provider.getBlock(firstEvent.blockNumber);

            if (!block) {
                return {
                    isNew: true,
                    ageInDays: 0,
                    createdAt: null,
                    reason: 'Block not found'
                };
            }

            const createdAt = new Date(block.timestamp * 1000);
            const now = new Date();
            const ageInMs = now.getTime() - createdAt.getTime();
            const ageInDays = ageInMs / (1000 * 60 * 60 * 24);

            const isNew = ageInDays <= maxAgeDays;

            console.log(`[PancakeSwap] 📅 Token age: ${ageInDays.toFixed(1)} days (created: ${createdAt.toISOString()})`);
            console.log(`[PancakeSwap] ${isNew ? '✅' : '🚨'} Token is ${isNew ? 'NEW' : 'TOO OLD'} (max: ${maxAgeDays} days)`);

            return {
                isNew,
                ageInDays,
                createdAt,
                reason: isNew ? 'Token is new enough' : `Token is ${ageInDays.toFixed(1)} days old (max: ${maxAgeDays})`
            };

        } catch (error: any) {
            console.error(`[PancakeSwap] ⚠️ Error checking token age:`, error.message);
            // Em caso de erro, NÃO COMPRE (sniping seguro)
            return {
                isNew: false,
                ageInDays: 999,
                createdAt: null,
                reason: 'Error checking age - failing safe (blocked)'
            };
        }
    }
}
