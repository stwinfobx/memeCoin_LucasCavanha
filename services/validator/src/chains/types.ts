// Multi-Chain Type Definitions
// Common interfaces for all blockchain providers

export enum SupportedChain {
    BSC = 'BSC',
    SOLANA = 'SOLANA',
    BASE = 'BASE',
    ETH = 'ETH'
}

export interface TokenInfo {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    totalSupply?: string;
}

export interface MarketData {
    liquidity: number;
    volume24h: number;
    price: number;
    holdersCount: number;
    pairAddress?: string;
    dexId?: string;
}

export interface ValidationResult {
    isValid: boolean;
    safetyScore: number;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    warnings: string[];
    checks: {
        honeypot: boolean;
        liquidityLocked: boolean;
        hasTransferTax: boolean;
        isRenounced?: boolean;
    };
}

/**
 * Abstract interface for blockchain providers
 * Each chain (BSC, Solana, Base) implements this interface
 */
export interface ChainProvider {
    readonly chainId: SupportedChain;
    readonly nativeToken: string;

    /**
     * Validate if an address is correctly formatted for this chain
     */
    isValidAddress(address: string): boolean;

    /**
     * Normalize address to standard format
     * EVM: lowercase hex
     * Solana: base58 (case-sensitive)
     */
    normalizeAddress(address: string): string;

    /**
     * Get token basic information (symbol, name, decimals, supply)
     */
    getTokenInfo(address: string): Promise<TokenInfo>;

    /**
     * Check if token is a honeypot (cannot be sold)
     */
    checkHoneypot(address: string): Promise<boolean>;

    /**
     * Check if liquidity is locked
     */
    checkLiquidityLocked(address: string): Promise<boolean>;

    /**
     * Get market data from DEX aggregators (GeckoTerminal, etc)
     */
    getMarketData(address: string, context?: any): Promise<MarketData>;

    /**
     * Get native balance of an address (BNB, SOL, ETH)
     */
    getNativeBalance(address: string): Promise<string>;

    /**
     * Get token balance of an address
     */
    getTokenBalance(walletAddress: string, tokenAddress: string): Promise<string>;
}

/**
 * Chain configuration from database
 */
export interface ChainConfig {
    chain: SupportedChain;
    enabled: boolean;
    rpcUrl: string;
    fallbackRpcUrl?: string;
    explorerUrl?: string;
    explorerApiKey?: string;
    nativeToken: string;
    nativeTokenDecimals: number;
    config: Record<string, any>;
    lastBlockScanned?: number;
    lastScanAt?: Date;
}

/**
 * Validation context for additional metadata
 */
export interface ValidationContext {
    pairAddress?: string;
    source?: string;
    rawListing?: any;
    forceFresh?: boolean;
}
