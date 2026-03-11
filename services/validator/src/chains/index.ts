// Chain Providers - Export all providers and factory
export * from './types';
export * from './evm-provider';
export * from './solana-provider';

import { ChainProvider, SupportedChain } from './types';
import { createEVMProvider } from './evm-provider';
import { SolanaChainProvider } from './solana-provider';

/**
 * Factory function to create appropriate ChainProvider for a given chain
 */
export function createChainProvider(chain: SupportedChain): ChainProvider {
    switch (chain) {
        case SupportedChain.BSC:
        case SupportedChain.BASE:
        case SupportedChain.ETH: {
            const provider = createEVMProvider(chain);
            if (!provider) {
                throw new Error(`Failed to create EVM provider for ${chain}`);
            }
            return provider;
        }

        case SupportedChain.SOLANA: {
            const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
            return new SolanaChainProvider(rpcUrl);
        }

        default:
            throw new Error(`Unsupported chain: ${chain}`);
    }
}

/**
 * Get all enabled chains from environment
 */
export function getEnabledChains(): SupportedChain[] {
    const enabled = process.env.ENABLED_CHAINS || 'BSC';
    return enabled.split(',').map(c => c.trim().toUpperCase() as SupportedChain);
}

/**
 * Normalize chain name from string to SupportedChain enum
 */
export function normalizeChainName(chain?: string): SupportedChain | null {
    if (!chain) return null;

    const normalized = chain.trim().toUpperCase();

    switch (normalized) {
        case 'BSC':
        case 'BINANCE':
        case 'BNB':
            return SupportedChain.BSC;

        case 'SOLANA':
        case 'SOL':
            return SupportedChain.SOLANA;

        case 'BASE':
            return SupportedChain.BASE;

        case 'ETH':
        case 'ETHEREUM':
            return SupportedChain.ETH;

        default:
            return null;
    }
}
