import { ethers, Wallet, Contract } from 'ethers';
import { Pool } from 'pg';
import { TradeExecutor, BuyParams, SellParams, TradeResult } from './types';

// Uniswap V3 Router (SwapRouter02)
const SWAP_ROUTER_02 = '0x2626664c2603336E57B271c5C0b26F421741e481';
const QUOTER_V2 = process.env.UNISWAP_V3_QUOTER_BASE || '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a';
const WETH = process.env.WETH_BASE || '0x4200000000000000000000000000000000000006';

const ROUTER_ABI = [
    'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
    'function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum)) external payable returns (uint256 amountOut)',
    'function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountIn)',
    'function exactOutput((bytes path, address recipient, uint256 amountOut, uint256 amountInMaximum)) external payable returns (uint256 amountIn)'
];

const ERC20_ABI = [
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function allowance(address owner, address spender) external view returns (uint256)',
    'function balanceOf(address account) external view returns (uint256)',
    'function decimals() external view returns (uint8)'
];

const QUOTER_ABI = [
    'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
];

export class UniswapV3Executor implements TradeExecutor {
    private provider: ethers.JsonRpcProvider;
    private pool: Pool;

    constructor(rpcUrl: string, pool: Pool) {
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        this.pool = pool;
    }

    async buyToken(params: BuyParams): Promise<TradeResult> {
        const { privateKey, tokenAddress, amountIn, slippage = 5 } = params;

        try {
            const wallet = new Wallet(privateKey, this.provider);
            const router = new Contract(SWAP_ROUTER_02, ROUTER_ABI, wallet);

            const amountInWei = ethers.parseEther(amountIn);

            // 0. Pre-flight balance check
            const ethBalance = await this.provider.getBalance(wallet.address);
            const gasReserve = ethers.parseEther('0.002'); // Base is cheap, but let's be safe
            if (ethBalance < (amountInWei + gasReserve)) {
                throw new Error(`Insufficient ETH balance on Base. Have: ${ethers.formatEther(ethBalance)} ETH, Need: ${ethers.formatEther(amountInWei + gasReserve)} ETH`);
            }

            const feeTier = 3000; // 0.3% - trying most common tier first (TODO: dynamic fee tier)

            // Estimate output
            const amountOutEst = await this.getQuote(WETH, tokenAddress, amountInWei, feeTier);
            const amountOutMin = amountOutEst * BigInt(100 - slippage) / 100n;

            const paramsStruct = {
                tokenIn: WETH,
                tokenOut: tokenAddress,
                fee: feeTier,
                recipient: wallet.address,
                amountIn: amountInWei,
                amountOutMinimum: amountOutMin,
                sqrtPriceLimitX96: 0
            };

            // Execute swap (ETH -> Token)
            // Note: exactInputSingle accepts ETH value if tokenIn is WETH
            const tx = await router.exactInputSingle(paramsStruct, {
                value: amountInWei, // Send ETH
                gasLimit: 500000 // Simplified gas limit
            });

            const receipt = await tx.wait();

            return {
                txHash: receipt.hash,
                amountIn,
                amountOut: ethers.formatUnits(amountOutEst, 18), // Assuming 18 decimals for simplicity (TODO: fix)
                success: true
            };

        } catch (error: any) {
            console.error('[Uniswap] Buy failed:', error);
            return {
                txHash: '',
                amountIn,
                amountOut: '0',
                success: false,
                error: error.message
            };
        }
    }

    async sellToken(params: SellParams): Promise<TradeResult> {
        const { privateKey, tokenAddress, amountIn, slippage = 5 } = params;

        try {
            const wallet = new Wallet(privateKey, this.provider);
            const tokenContract = new Contract(tokenAddress, ERC20_ABI, wallet);
            const router = new Contract(SWAP_ROUTER_02, ROUTER_ABI, wallet);

            // 0. Pre-flight ETH check for gas
            const ethBalance = await this.provider.getBalance(wallet.address);
            const gasReserve = ethers.parseEther('0.002');
            if (ethBalance < gasReserve) {
                throw new Error(`Insufficient ETH for gas on Base. Need at least 0.002 ETH`);
            }

            const decimals = await tokenContract.decimals();
            const amountInWei = ethers.parseUnits(amountIn, decimals);

            // Token balance check
            const tokenBalance = await tokenContract.balanceOf(wallet.address);
            if (tokenBalance < amountInWei) {
                throw new Error(`Insufficient token balance to sell. Have: ${ethers.formatUnits(tokenBalance, decimals)}, Need: ${amountIn}`);
            }

            // Approve
            const allowance = await tokenContract.allowance(wallet.address, SWAP_ROUTER_02);
            if (allowance < amountInWei) {
                const approveTx = await tokenContract.approve(SWAP_ROUTER_02, ethers.MaxUint256);
                await approveTx.wait();
            }

            const feeTier = 3000; // 0.3%

            // Estimate output
            const amountOutEst = await this.getQuote(tokenAddress, WETH, amountInWei, feeTier);
            const amountOutMin = amountOutEst * BigInt(100 - slippage) / 100n;

            const paramsStruct = {
                tokenIn: tokenAddress,
                tokenOut: WETH,
                fee: feeTier,
                recipient: wallet.address,
                amountIn: amountInWei,
                amountOutMinimum: amountOutMin,
                sqrtPriceLimitX96: 0
            };

            const tx = await router.exactInputSingle(paramsStruct, {
                gasLimit: 500000
            });

            const receipt = await tx.wait();

            return {
                txHash: receipt.hash,
                amountIn,
                amountOut: ethers.formatEther(amountOutEst),
                success: true
            };

        } catch (error: any) {
            console.error('[Uniswap] Sell failed:', error);
            return {
                txHash: '',
                amountIn,
                amountOut: '0',
                success: false,
                error: error.message
            };
        }
    }

    async estimateBuyOutput(tokenAddress: string, amountIn: string): Promise<string> {
        try {
            const amountInWei = ethers.parseEther(amountIn);
            const feeTier = 3000; // TODO: check multiple tiers
            const quote = await this.getQuote(WETH, tokenAddress, amountInWei, feeTier);

            // Need decimals to format correctly, returning raw string for now or assuming 18
            // Ideally should fetch decimals
            return quote.toString();
        } catch {
            return '0';
        }
    }

    async getBalance(walletAddress: string, tokenAddress?: string): Promise<string> {
        try {
            if (!tokenAddress || tokenAddress === ethers.ZeroAddress || tokenAddress === 'ETH') {
                const balance = await this.provider.getBalance(walletAddress);
                return ethers.formatEther(balance);
            } else {
                const contract = new Contract(tokenAddress, ERC20_ABI, this.provider);
                const balance = await contract.balanceOf(walletAddress);
                const decimals = await contract.decimals();
                return ethers.formatUnits(balance, decimals);
            }
        } catch {
            return '0';
        }
    }

    private async getQuote(tokenIn: string, tokenOut: string, amountIn: bigint, fee: number): Promise<bigint> {
        try {
            // Note: Using QuoterV2 static call
            // This is complex to implement robustly without proper Quoter ABI and handling reverts
            // For MVP, simplified estimation or just relying on slippage protection might be enough
            // Ideally: use Quoter contract staticCall
            const quoter = new Contract(QUOTER_V2, QUOTER_ABI, this.provider);
            const params = {
                tokenIn,
                tokenOut,
                amountIn,
                fee,
                sqrtPriceLimitX96: 0
            };

            // This is a view function in QuoterV2, but often needs callStatic
            const [amountOut] = await quoter.quoteExactInputSingle.staticCall(params);
            return amountOut;
        } catch (e) {
            console.warn('Quote failed, returning 0', e);
            return 0n;
        }
    }
}
