'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../contexts/AuthContext';

const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function WithdrawPage() {
    const router = useRouter();
    const { token, isAuthenticated, isLoading } = useAuth();
    const [balance, setBalance] = useState(0);
    const [amount, setAmount] = useState('');
    const [walletAddress, setWalletAddress] = useState('');
    const [chain, setChain] = useState('BSC');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [withdrawals, setWithdrawals] = useState<any[]>([]);

    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            router.push('/auth/login');
        }
    }, [isAuthenticated, isLoading, router]);

    useEffect(() => {
        if (token) {
            fetchBalance();
            fetchWithdrawals();
        }
    }, [token]);

    const fetchBalance = async () => {
        if (!token) return;

        try {
            const response = await fetch(`${apiBase}/api/balance`, {
                headers: { Authorization: `Bearer ${token}` },
            });

            if (response.ok) {
                const data = await response.json();
                setBalance(data.data?.balance || 0);
            }
        } catch (err) {
            console.error('[Withdraw] Balance fetch error:', err);
        }
    };

    const fetchWithdrawals = async () => {
        if (!token) return;

        try {
            const response = await fetch(`${apiBase}/api/withdrawals/history`, {
                headers: { Authorization: `Bearer ${token}` },
            });

            if (response.ok) {
                const data = await response.json();
                setWithdrawals(data.data?.withdrawals || []);
            }
        } catch (err) {
            console.error('[Withdraw] History fetch error:', err);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(false);

        if (!amount || parseFloat(amount) <= 0) {
            setError('Valor invalido');
            return;
        }

        if (parseFloat(amount) > balance) {
            setError(`Saldo insuficiente. Disponivel: $${balance.toFixed(2)}`);
            return;
        }

        if (!walletAddress) {
            setError('Endereco da wallet obrigatorio');
            return;
        }

        setLoading(true);

        try {
            const response = await fetch(`${apiBase}/api/withdrawals/request`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    amount_usd: parseFloat(amount),
                    wallet_address: walletAddress,
                    chain,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error?.message || 'Erro ao solicitar saque');
            }

            setSuccess(true);
            setAmount('');
            setWalletAddress('');
            fetchBalance();
            fetchWithdrawals();
        } catch (err: any) {
            setError(err.message || 'Erro ao solicitar saque');
        } finally {
            setLoading(false);
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-neutral-950">
                <div className="mx-auto max-w-4xl px-6 py-10">
                    <div className="text-center text-neutral-500">Carregando...</div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-neutral-950">
            <div className="mx-auto max-w-4xl px-6 py-10">
                <header className="flex flex-wrap items-center justify-between gap-6 border-b border-neutral-900 pb-8">
                    <div>
                        <span className="section-title">Financeiro</span>
                        <h1 className="mt-3 text-3xl font-semibold text-neutral-50">Sacar Fundos</h1>
                        <p className="mt-2 text-sm text-neutral-500">
                            Solicite um saque dos seus fundos disponíveis
                        </p>
                    </div>
                    <Link href="/dashboard" className="btn-secondary px-4 py-2 text-sm">
                        Voltar ao Dashboard
                    </Link>
                </header>

                {/* Saldo Disponivel */}
                <div className="mt-10 surface-strong p-6">
                    <h2 className="text-lg font-semibold text-neutral-100">Saldo Disponivel</h2>
                    <div className="mt-4 text-4xl font-bold text-emerald-400">
                        ${balance.toFixed(2)} USD
                    </div>
                    <p className="mt-2 text-xs text-neutral-500">
                        Este e o valor livre para saque (nao inclui posicoes abertas)
                    </p>
                </div>

                {/* Formulario de Saque */}
                <div className="mt-6 surface-strong p-6">
                    <h2 className="text-lg font-semibold text-neutral-100 mb-6">Solicitar Saque</h2>

                    {error && (
                        <div className="mb-6 border border-rose-500/40 bg-rose-500/10 px-5 py-4 text-sm text-rose-200">
                            {error}
                        </div>
                    )}

                    {success && (
                        <div className="mb-6 border border-emerald-500/40 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-200">
                            Saque solicitado com sucesso! Aguarde aprovacao.
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Valor */}
                        <div>
                            <label className="block text-sm font-medium text-neutral-300 mb-2">
                                Valor (USD)
                            </label>
                            <input
                                type="number"
                                step="0.01"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-3 text-neutral-100 focus:outline-none focus:border-purple-500 transition-colors"
                                placeholder="100.00"
                                disabled={loading}
                            />
                            <p className="mt-2 text-xs text-neutral-500">
                                Maximo: ${balance.toFixed(2)}
                            </p>
                        </div>

                        {/* Endereco da Wallet */}
                        <div>
                            <label className="block text-sm font-medium text-neutral-300 mb-2">
                                Endereco da Wallet
                            </label>
                            <input
                                type="text"
                                value={walletAddress}
                                onChange={(e) => setWalletAddress(e.target.value)}
                                className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-3 text-neutral-100 font-mono text-sm focus:outline-none focus:border-purple-500 transition-colors"
                                placeholder="0x..."
                                disabled={loading}
                            />
                            <p className="mt-2 text-xs text-neutral-500">
                                Endereco da sua wallet para receber os fundos
                            </p>
                        </div>

                        {/* Chain */}
                        <div>
                            <label className="block text-sm font-medium text-neutral-300 mb-2">
                                Blockchain
                            </label>
                            <select
                                value={chain}
                                onChange={(e) => setChain(e.target.value)}
                                className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-3 text-neutral-100 focus:outline-none focus:border-purple-500 transition-colors"
                                disabled={loading}
                            >
                                <option value="BSC">BSC (Binance Smart Chain)</option>
                                <option value="ETH">Ethereum</option>
                                <option value="SOL">Solana</option>
                            </select>
                        </div>

                        {/* Botao */}
                        <button
                            type="submit"
                            disabled={loading || balance <= 0}
                            className="btn-primary w-full py-3 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? 'Processando...' : 'Solicitar Saque'}
                        </button>
                    </form>
                </div>

                {/* Historico */}
                {withdrawals.length > 0 && (
                    <div className="mt-6 surface-strong p-6">
                        <h2 className="text-lg font-semibold text-neutral-100 mb-6">Historico de Saques</h2>
                        <div className="space-y-3">
                            {withdrawals.map((w) => (
                                <div key={w.id} className="surface border-neutral-800 p-5">
                                    <div className="flex flex-wrap items-center justify-between gap-4">
                                        <div>
                                            <p className="text-sm font-semibold text-neutral-100">
                                                ${w.amount_usd.toFixed(2)} USD
                                            </p>
                                            <p className="text-xs text-neutral-500 font-mono mt-1">
                                                {w.wallet_address.substring(0, 20)}...
                                            </p>
                                            <p className="text-xs text-neutral-500 mt-1">
                                                {new Date(w.created_at).toLocaleString('pt-BR')}
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <span
                                                className={`inline-block text-xs px-3 py-1 rounded-full ${w.status === 'completed'
                                                        ? 'bg-emerald-500/10 border border-emerald-500/40 text-emerald-300'
                                                        : w.status === 'pending'
                                                            ? 'bg-amber-500/10 border border-amber-500/40 text-amber-300'
                                                            : w.status === 'rejected'
                                                                ? 'bg-rose-500/10 border border-rose-500/40 text-rose-300'
                                                                : 'bg-neutral-500/10 border border-neutral-500/40 text-neutral-300'
                                                    }`}
                                            >
                                                {w.status}
                                            </span>
                                            {w.tx_hash && (
                                                <a
                                                    href={`https://bscscan.com/tx/${w.tx_hash}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="block mt-2 text-xs text-purple-400 hover:text-purple-300 underline"
                                                >
                                                    Ver TX
                                                </a>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
