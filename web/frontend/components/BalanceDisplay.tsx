'use client';

import React, { useState, useEffect } from 'react';

interface BalanceData {
    total_balance_usd: number;
    available_balance_usd: number;
    invested_in_positions_usd: number;
    credits_usd: number;
    debits_usd: number;
}

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
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
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
                <div className="h-6 bg-neutral-800 rounded w-1/3 mb-6"></div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="h-24 bg-neutral-800 rounded"></div>
                    <div className="h-24 bg-neutral-800 rounded"></div>
                    <div className="h-24 bg-neutral-800 rounded"></div>
                </div>
            </div>
        );
    }

    if (!balance) {
        return null;
    }

    return (
        <div className="surface-strong p-6">
            <h2 className="text-lg font-semibold text-neutral-100 mb-6">Saldo Real</h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Total Balance */}
                <div className="surface border-neutral-800 p-5">
                    <p className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Saldo Total</p>
                    <p className="text-3xl font-bold text-neutral-50">
                        ${balance.total_balance_usd.toFixed(2)}
                    </p>
                </div>

                {/* Available */}
                <div className="surface border-emerald-500/40 bg-emerald-500/10 p-5">
                    <p className="text-xs uppercase tracking-wide text-emerald-300 mb-2">Disponivel</p>
                    <p className="text-3xl font-bold text-neutral-50">
                        ${balance.available_balance_usd.toFixed(2)}
                    </p>
                    <p className="text-xs text-emerald-200 mt-2">Para novos trades</p>
                </div>

                {/* Invested */}
                <div className="surface border-amber-500/40 bg-amber-500/10 p-5">
                    <p className="text-xs uppercase tracking-wide text-amber-300 mb-2">Investido</p>
                    <p className="text-3xl font-bold text-neutral-50">
                        ${balance.invested_in_positions_usd.toFixed(2)}
                    </p>
                    <p className="text-xs text-amber-200 mt-2">Em posicoes abertas</p>
                </div>
            </div>

            {/* Detailed Stats */}
            <div className="mt-6 pt-4 border-t border-neutral-800 flex flex-wrap justify-between gap-4 text-sm">
                <div>
                    <span className="text-neutral-500">Creditos: </span>
                    <span className="text-emerald-400 font-mono font-semibold">
                        ${balance.credits_usd.toFixed(2)}
                    </span>
                </div>
                <div>
                    <span className="text-neutral-500">Debitos: </span>
                    <span className="text-rose-400 font-mono font-semibold">
                        ${balance.debits_usd.toFixed(2)}
                    </span>
                </div>
            </div>
        </div>
    );
}
