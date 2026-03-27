'use client';

import React, { useState, useEffect } from 'react';

interface ChainBalance {
    balance_usd: number;
    wallet_real_crypto?: number;
    wallet_real_usd?: number;
}

interface BalanceData {
    total_balance_usd: number;
    is_admin_residual: boolean;
    chains: {
        bsc: ChainBalance;
        base: ChainBalance;
        solana: ChainBalance;
    };
    invested_in_positions_usd?: number;
}

const chainIcons: Record<string, string> = {
    bsc: '🟡',
    base: '🔵',
    solana: '🟣'
};

const chainNames: Record<string, string> = {
    bsc: 'BNB Chain',
    base: 'Base Network',
    solana: 'Solana'
};

export default function BalanceDisplay() {
    const [balance, setBalance] = useState<BalanceData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadBalance();
        const interval = setInterval(loadBalance, 30000);
        return () => clearInterval(interval);
    }, []);

    const loadBalance = async () => {
        try {
            const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
            const token = localStorage.getItem('access_token');
            const res = await fetch(`${apiBase}/api/balance`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = await res.json();
            if (data.success) {
                setBalance(data.data);
            }
        } catch (error) {
            console.error('Error loading balance:', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="surface-strong p-6 animate-pulse">
                <div className="h-6 bg-neutral-800 rounded w-1/4 mb-6"></div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="h-32 bg-neutral-800 rounded"></div>
                    <div className="h-32 bg-neutral-800 rounded"></div>
                    <div className="h-32 bg-neutral-800 rounded"></div>
                </div>
            </div>
        );
    }

    if (!balance || !balance.chains) {
        if (!loading && !balance) return null;
        return (
            <div className="surface-strong p-6 text-center text-neutral-500 italic">
                Aguardando dados da tesouraria...
            </div>
        );
    }
    
    // Fallback safe for missing chains
    const safeChains = balance.chains || {
        bsc: { balance_usd: 0 },
        base: { balance_usd: 0 },
        solana: { balance_usd: 0 }
    };

    const chains = [
        { id: 'bsc', ...safeChains.bsc },
        { id: 'base', ...safeChains.base },
        { id: 'solana', ...safeChains.solana }
    ];

    return (
        <div className="surface-strong p-6">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h2 className="text-xl font-bold text-neutral-50">Tesouraria Multi-Chain</h2>
                    <p className="text-sm text-neutral-500 mt-1">Saldos isolados por rede operacional</p>
                </div>
                <div className="text-right">
                    <p className="text-xs uppercase tracking-widest text-neutral-500">Saldo Total Consolidado</p>
                    <p className="text-2xl font-mono font-bold text-purple-400">
                        ${balance.total_balance_usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {chains.map((chain) => (
                    <div key={chain.id} className={`surface p-6 border-l-4 ${
                        chain.id === 'bsc' ? 'border-yellow-500' : 
                        chain.id === 'base' ? 'border-blue-500' : 'border-purple-500'
                    } bg-neutral-900/40 hover:bg-neutral-900/60 transition-all group`}>
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <span className="text-lg">{chainIcons[chain.id]}</span>
                                <span className="font-semibold text-neutral-200">{chainNames[chain.id]}</span>
                            </div>
                            {balance.is_admin_residual && (
                                <span className="text-[10px] bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full border border-purple-500/30">
                                    ADMIN RESIDUAL
                                </span>
                            )}
                        </div>

                        <div className="space-y-1">
                            <p className="text-3xl font-mono font-bold text-neutral-50">
                                ${chain.balance_usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                            <p className="text-xs text-neutral-500">Saldo Disponível (Virtual)</p>
                        </div>

                        {balance.is_admin_residual && chain.wallet_real_crypto !== undefined && (
                            <div className="mt-6 pt-4 border-t border-neutral-800/60 space-y-2">
                                <div className="flex justify-between text-xs">
                                    <span className="text-neutral-500">Real na Carteira:</span>
                                    <span className="text-neutral-300 font-medium">
                                        {chain.wallet_real_crypto.toFixed(4)} {chain.id === 'solana' ? 'SOL' : chain.id === 'bsc' ? 'BNB' : 'ETH'}
                                    </span>
                                </div>
                                <div className="flex justify-between text-[10px] text-neutral-600">
                                    <span>Valor USD Real:</span>
                                    <span>${chain.wallet_real_usd?.toFixed(2)}</span>
                                </div>
                            </div>
                        )}
                        
                        {!balance.is_admin_residual && (
                            <div className="mt-6">
                                <Link 
                                    href={`/deposit?chain=${chain.id.toUpperCase()}`}
                                    className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1 group-hover:translate-x-1 transition-transform"
                                >
                                    Depositar nesta rede →
                                </Link>
                            </div>
                        )}
                    </div>
                ))}
            </div>
            
            <div className="mt-8 p-4 bg-neutral-900/20 border border-neutral-900 rounded-lg flex items-center gap-4">
                <div className="p-2 bg-amber-500/10 rounded text-amber-500">⚠️</div>
                <p className="text-xs text-neutral-500 leading-relaxed">
                    <b>Nota de Segurança:</b> Seus saldos são isolados por rede. Lucros obtidos na rede Solana serão creditados apenas no saldo Solana. 
                    Certifique-se de ter saldo na rede correspondente para que o bot possa executar ordens automaticamente.
                </p>
            </div>
        </div>
    );
}

// Helper to keep Link working
import Link from 'next/link';
