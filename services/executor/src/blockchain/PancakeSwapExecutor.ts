import { ethers, Wallet, Contract } from 'ethers';
import { Pool } from 'pg';

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

export class PancakeSwapExecutor {
    private provider: ethers.JsonRpcProvider;
    private router: Contract;
    private pool: Pool;

    constructor(rpcUrl: string, pool: Pool) {
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        this.router = new Contract(PANCAKESWAP_ROUTER_V2, ROUTER_ABI, this.provider);
        this.pool = pool;
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

            if (balance < amountIn) {
                throw new Error(`Insufficient token balance. Have: ${ethers.formatUnits(balance, decimals)}, Need: ${roundedAmount}`);
            }

            // SEMPRE aprovar antes de vender (fix para bug de allowance)
            console.log('[PancakeSwap] 🔓 Approving token spend...');
            const approveTx = await (tokenWithSigner as any).approve(PANCAKESWAP_ROUTER_V2, ethers.MaxUint256);
            const approveReceipt = await approveTx.wait();
            console.log(`[PancakeSwap] ✅ Token approved (tx: ${approveReceipt.hash})`);

            // Verificar se há liquidez suficiente
            console.log('[PancakeSwap] 🔍 Checking liquidity...');
            const amounts = await this.router.getAmountsOut(amountIn, path);
            const expectedAmountOut = amounts[1];

            if (expectedAmountOut === BigInt(0)) {
                throw new Error('No liquidity available for this token pair');
            }

            // Aplicar slippage
            const amountOutMin = (expectedAmountOut * BigInt(100 - slippagePercent)) / BigInt(100);

            console.log(`[PancakeSwap] Expected output: ${ethers.formatEther(expectedAmountOut)} BNB`);
            console.log(`[PancakeSwap] Minimum output (${slippagePercent}% slippage): ${ethers.formatEther(amountOutMin)} BNB`);

            // Deadline: 20 minutos
            const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

            console.log(`[PancakeSwap] 🚀 Executing swap...`);
            console.log(`[PancakeSwap]    - AmountIn: ${amountIn.toString()}`);
            console.log(`[PancakeSwap]    - AmountOutMin: ${amountOutMin.toString()}`);
            console.log(`[PancakeSwap]    - Path: ${path.join(' -> ')}`);
            console.log(`[PancakeSwap]    - Deadline: ${deadline}`);

            // Executar swap
            const tx = await (routerWithSigner as any).swapExactTokensForETH(
                amountIn,
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
                throw new Error(`Transaction reverted. Hash: ${receipt.hash}`);
            }

            console.log(`[PancakeSwap] ✅ Transaction confirmed! Block: ${receipt.blockNumber}`);

            return {
                txHash: receipt.hash,
                amountIn: amountToken,
                amountOut: ethers.formatEther(expectedAmountOut),
                gasUsed: receipt.gasUsed.toString(),
                effectiveGasPrice: receipt.gasPrice?.toString() || '0'
            };
        } catch (error: any) {
            console.error('[PancakeSwap] ❌ Sell failed:', error.message);

            // Retry com slippage maior se falhou
            if (slippagePercent < 20) {
                const newSlippage = slippagePercent + 5;
                console.log(`[PancakeSwap] 🔄 Retrying with ${newSlippage}% slippage...`);
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
}
