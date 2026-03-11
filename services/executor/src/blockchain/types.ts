export interface BuyParams {
    privateKey: string;
    tokenAddress: string;
    amountIn: string; // Amount of native token (SOL, BNB, ETH)
    slippage?: number; // percent
}

export interface SellParams {
    privateKey: string;
    tokenAddress: string;
    amountIn: string; // Amount of token to sell
    slippage?: number; // percent
}

export interface TradeResult {
    txHash: string;
    amountIn: string;
    amountOut: string;
    success: boolean;
    error?: string;
    fee?: string;
}

export interface TradeExecutor {
    buyToken(params: BuyParams): Promise<TradeResult>;
    sellToken(params: SellParams): Promise<TradeResult>;
    estimateBuyOutput(tokenAddress: string, amountIn: string): Promise<string>;
    getBalance(walletAddress: string, tokenAddress?: string): Promise<string>;
}
