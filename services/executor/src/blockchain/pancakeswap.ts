import { ethers } from 'ethers';
import crypto from 'crypto';

// ABI simplificado do PancakeSwap Router
const ROUTER_ABI = [
    'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
    'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
    'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
];

// ABI do ERC20 para approve
const ERC20_ABI = [
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function allowance(address owner, address spender) external view returns (uint256)',
    'function balanceOf(address account) external view returns (uint256)',
];

export interface PancakeSwapConfig {
    routerAddress: string;
    wbnbAddress: string;
    rpcUrl: string;
    privateKey: string; // Encrypted
    gasLimit?: number;
    gasPriceGwei?: number;
    slippageTolerance?: number; // Percentage (default 1%)
}

export interface SwapResult {
    success: boolean;
    txHash?: string;
    amountOut?: string;
    gasUsed?: string;
    error?: string;
}

export class PancakeSwapExecutor {
    private provider: ethers.JsonRpcProvider;
    private wallet: ethers.Wallet;
    private router: ethers.Contract;
    private config: PancakeSwapConfig;

    constructor(config: PancakeSwapConfig) {
        this.config = {
            gasLimit: 300000,
            gasPriceGwei: 5,
            slippageTolerance: 1,
            ...config,
        };

        // Inicializar provider
        this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);

        // Descriptografar private key e criar wallet
        const decryptedKey = this.decryptPrivateKey(this.config.privateKey);
        this.wallet = new ethers.Wallet(decryptedKey, this.provider);

        // Inicializar contrato do router
        this.router = new ethers.Contract(
            this.config.routerAddress,
            ROUTER_ABI,
            this.wallet
        );
    }

    /**
     * Descriptografa a chave privada usando AES-256-GCM
     */
    private decryptPrivateKey(encryptedKey: string): string {
        const encryptionKey = process.env.ENCRYPTION_KEY;
        if (!encryptionKey) {
            throw new Error('ENCRYPTION_KEY not found in environment');
        }

        try {
            // Formato esperado: iv:encrypted
            const [ivHex, encryptedHex] = encryptedKey.split(':');
            const iv = Buffer.from(ivHex, 'hex');
            const encrypted = Buffer.from(encryptedHex, 'hex');

            const decipher = crypto.createDecipheriv(
                'aes-256-gcm',
                Buffer.from(encryptionKey, 'hex'),
                iv
            );

            let decrypted = decipher.update(encrypted);
            decrypted = Buffer.concat([decrypted, decipher.final()]);

            return decrypted.toString('utf8');
        } catch (error: any) {
            throw new Error('Failed to decrypt private key: ' + error.message);
        }
    }

    /**
     * Calcula o amountOutMin com base no slippage tolerance
     */
    private calculateMinAmountOut(expectedAmount: string, slippageTolerance: number): string {
        const slippageMultiplier = (100 - slippageTolerance) / 100;
        const expected = BigInt(expectedAmount);
        const minAmount = (expected * BigInt(Math.floor(slippageMultiplier * 1000))) / BigInt(1000);
        return minAmount.toString();
    }

    /**
     * Compra tokens com BNB
     */
    async executeBuy(
        tokenAddress: string,
        amountBNB: string, // Em BNB (ex: "0.01")
        slippageTolerance?: number
    ): Promise<SwapResult> {
        try {
            console.log(`[PancakeSwap] Executing BUY: ${amountBNB} BNB for token ${tokenAddress}`);

            const slippage = slippageTolerance ?? this.config.slippageTolerance ?? 1;

            // Path: WBNB -> Token
            const path = [this.config.wbnbAddress, tokenAddress];

            // Converter BNB para Wei
            const amountInWei = ethers.parseEther(amountBNB);

            // Obter quantidade esperada de tokens
            const amounts = await (this.router as any).getAmountsOut(amountInWei, path);
            const expectedTokenAmount = amounts[1];

            // Calcular amountOutMin com slippage
            const amountOutMin = this.calculateMinAmountOut(expectedTokenAmount.toString(), slippage);

            // Deadline: 20 minutos a partir de agora
            const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

            // Gas price
            const gasPrice = ethers.parseUnits(
                this.config.gasPriceGwei!.toString(),
                'gwei'
            );

            console.log(`[PancakeSwap] Expected tokens: ${ethers.formatUnits(expectedTokenAmount, 18)}`);
            console.log(`[PancakeSwap] Min tokens (${slippage}% slippage): ${ethers.formatUnits(amountOutMin, 18)}`);

            // Executar swap
            const tx = await (this.router as any).swapExactETHForTokens(
                amountOutMin,
                path,
                this.wallet.address,
                deadline,
                {
                    value: amountInWei,
                    gasLimit: this.config.gasLimit,
                    gasPrice,
                }
            );

            console.log(`[PancakeSwap] Transaction sent: ${tx.hash}`);
            console.log(`[PancakeSwap] Waiting for confirmation...`);

            // Aguardar confirmação (3 blocos)
            const receipt = await tx.wait(3);

            console.log(`[PancakeSwap] ✅ Transaction confirmed in block ${receipt.blockNumber}`);
            console.log(`[PancakeSwap] Gas used: ${receipt.gasUsed.toString()}`);

            return {
                success: true,
                txHash: receipt.hash,
                amountOut: expectedTokenAmount.toString(),
                gasUsed: receipt.gasUsed.toString(),
            };
        } catch (error: any) {
            console.error('[PancakeSwap] ❌ BUY failed:', error.message);
            return {
                success: false,
                error: error.message || 'Unknown error during buy',
            };
        }
    }

    /**
     * Vende tokens por BNB
     */
    async executeSell(
        tokenAddress: string,
        amountTokens: string, // Em unidades do token
        slippageTolerance?: number
    ): Promise<SwapResult> {
        try {
            console.log(`[PancakeSwap] Executing SELL: ${amountTokens} tokens for BNB`);

            const slippage = slippageTolerance ?? this.config.slippageTolerance ?? 1;

            // Path: Token -> WBNB
            const path = [tokenAddress, this.config.wbnbAddress];

            // Converter amount para Wei (assumindo 18 decimals)
            const amountInWei = ethers.parseUnits(amountTokens, 18);

            // Verificar e aprovar tokens se necessário
            await this.approveTokenIfNeeded(tokenAddress, amountInWei.toString());

            // Obter quantidade esperada de BNB
            const amounts = await (this.router as any).getAmountsOut(amountInWei, path);
            const expectedBNBAmount = amounts[1];

            // Calcular amountOutMin com slippage
            const amountOutMin = this.calculateMinAmountOut(expectedBNBAmount.toString(), slippage);

            // Deadline: 20 minutos
            const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

            // Gas price
            const gasPrice = ethers.parseUnits(
                this.config.gasPriceGwei!.toString(),
                'gwei'
            );

            console.log(`[PancakeSwap] Expected BNB: ${ethers.formatEther(expectedBNBAmount)}`);
            console.log(`[PancakeSwap] Min BNB (${slippage}% slippage): ${ethers.formatEther(amountOutMin)}`);

            // Executar swap
            const tx = await (this.router as any).swapExactTokensForETH(
                amountInWei,
                amountOutMin,
                path,
                this.wallet.address,
                deadline,
                {
                    gasLimit: this.config.gasLimit,
                    gasPrice,
                }
            );

            console.log(`[PancakeSwap] Transaction sent: ${tx.hash}`);
            console.log(`[PancakeSwap] Waiting for confirmation...`);

            // Aguardar confirmação
            const receipt = await tx.wait(3);

            console.log(`[PancakeSwap] ✅ Transaction confirmed in block ${receipt.blockNumber}`);
            console.log(`[PancakeSwap] Gas used: ${receipt.gasUsed.toString()}`);

            return {
                success: true,
                txHash: receipt.hash,
                amountOut: expectedBNBAmount.toString(),
                gasUsed: receipt.gasUsed.toString(),
            };
        } catch (error: any) {
            console.error('[PancakeSwap] ❌ SELL failed:', error.message);
            return {
                success: false,
                error: error.message || 'Unknown error during sell',
            };
        }
    }

    /**
     * Verifica allowance e aprova tokens se necessário
     */
    private async approveTokenIfNeeded(tokenAddress: string, amount: string): Promise<void> {
        const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);

        // Verificar allowance atual
        const currentAllowance = await tokenContract.allowance(
            this.wallet.address,
            this.config.routerAddress
        );

        const amountBN = BigInt(amount);

        if (currentAllowance < amountBN) {
            console.log(`[PancakeSwap] Approving tokens...`);

            // Aprovar máximo para evitar múltiplas aprovações
            const maxUint256 = ethers.MaxUint256;

            const approveTx = await (tokenContract as any).approve(this.config.routerAddress, maxUint256, {
                gasLimit: 100000,
                gasPrice: ethers.parseUnits(this.config.gasPriceGwei!.toString(), 'gwei'),
            });

            await approveTx.wait(1);
            console.log(`[PancakeSwap] ✅ Tokens approved`);
        }
    }

    /**
     * Estima gas para uma transação de buy
     */
    async estimateGasBuy(tokenAddress: string, amountBNB: string): Promise<string> {
        try {
            const path = [this.config.wbnbAddress, tokenAddress];
            const amountInWei = ethers.parseEther(amountBNB);
            const amounts = await (this.router as any).getAmountsOut(amountInWei, path);
            const amountOutMin = this.calculateMinAmountOut(amounts[1].toString(), 1);
            const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

            const gasEstimate = await (this.router as any).estimateGas.swapExactETHForTokens(
                amountOutMin,
                path,
                this.wallet.address,
                deadline,
                { value: amountInWei }
            );

            return gasEstimate.toString();
        } catch (error: any) {
            console.error('[PancakeSwap] Gas estimation failed:', error.message);
            return this.config.gasLimit!.toString();
        }
    }

    /**
     * Retorna o endereço da wallet
     */
    getWalletAddress(): string {
        return this.wallet.address;
    }

    /**
     * Retorna o saldo de BNB da wallet
     */
    async getBalance(): Promise<string> {
        const balance = await this.provider.getBalance(this.wallet.address);
        return ethers.formatEther(balance);
    }
}
