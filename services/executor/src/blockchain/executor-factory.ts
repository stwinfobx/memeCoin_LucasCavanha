import { Pool } from 'pg';
import { TradeExecutor } from './types';
import { PancakeSwapExecutor } from './PancakeSwapExecutor';
import { JupiterExecutor } from './JupiterExecutor';
import { UniswapV3Executor } from './UniswapV3Executor';

export class ExecutorFactory {
    static createExecutor(chain: string, pool: Pool): TradeExecutor {
        const chainUpper = chain.toUpperCase();

        switch (chainUpper) {
            case 'BSC':
            case 'BINANCE':
                return new PancakeSwapExecutor(
                    process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org',
                    pool
                );

            case 'SOLANA':
            case 'SOL':
                return new JupiterExecutor(
                    process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
                    pool
                );

            case 'BASE':
                return new UniswapV3Executor(
                    process.env.BASE_RPC_URL || 'https://mainnet.base.org',
                    pool
                );

            default:
                throw new Error(`Unsupported chain for execution: ${chain}`);
        }
    }
}
