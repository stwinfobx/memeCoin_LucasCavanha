'use client';

import React, { useState, useEffect } from 'react';
import { useMetaMask } from '../../hooks/useMetaMask';
import Link from 'next/link';

const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function DepositWithdrawPage() {
    const { account, balance: bnbBalance, chainId, isConnecting, connect, switchToBSC } = useMetaMask();

    // Deposit states
    const [txHash, setTxHash] = useState('');
    const [status, setStatus] = useState<'idle' | 'sending' | 'waiting' | 'confirmed' | 'failed'>('idle');
    const [amountBNB, setAmountBNB] = useState('0.01');
    const [depositHistory, setDepositHistory] = useState<any[]>([]);

    // Withdraw states  
    const [usdBalance, setUsdBalance] = useState(0);
    const [withdrawAmount, setWithdrawAmount] = useState('');
    const [withdrawWallet, setWithdrawWallet] = useState('');
    const [withdrawChain, setWithdrawChain] = useState('BSC');
    const [withdrawLoading, setWithdrawLoading] = useState(false);
    const [withdrawError, setWithdrawError] = useState<string | null>(null);
    const [withdrawSuccess, setWithdrawSuccess] = useState(false);
    const [withdrawals, setWithdrawals] = useState<any[]>([]);
    const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit');

    const botAddress = process.env.NEXT_PUBLIC_BOT_DEPOSIT_ADDRESS || '0x0000000000000000000000000000000000000000';

    useEffect(() => {
        if (account) {
            loadDepositHistory();
            loadWithdrawHistory();
            loadBalance();
        }
    }, [account]);

    const loadBalance = async () => {
        try {
            const token = localStorage.getItem('access_token');
            const res = await fetch(`${apiBase}/api/balance`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = await res.json();
            if (data.success) {
                setUsdBalance(data.data?.balance || 0);
            }
        } catch (error) {
            console.error('Error loading balance:', error);
        }
    };

    const loadDepositHistory = async () => {
        try {
            const token = localStorage.getItem('access_token');
            const res = await fetch(`${apiBase}/api/deposits/history`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = await res.json();
            if (data.success) {
                setDepositHistory(data.data.deposits || []);
            }
        } catch (error) {
            console.error('Error loading deposit history:', error);
        }
    };

    const loadWithdrawHistory = async () => {
        try {
            const token = localStorage.getItem('access_token');
            const res = await fetch(`${apiBase}/api/withdrawals/history`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = await res.json();
            if (data.success) {
                setWithdrawals(data.data?.withdrawals || []);
            }
        } catch (error) {
            console.error('Error loading withdraw history:', error);
        }
    };

    const handleDeposit = async () => {
        if (!account) {
            alert('Conecte sua wallet primeiro!');
            return;
        }

        if (chainId !== 56) {
            const shouldSwitch = confirm('Você precisa estar na rede BSC. Deseja trocar?');
            if (shouldSwitch) {
                await switchToBSC();
            }
            return;
        }

        const amount = parseFloat(amountBNB);
        if (isNaN(amount) || amount <= 0) {
            alert('Valor inválido!');
            return;
        }

        setStatus('sending');

        try {
            const { ethers } = await import('ethers');
            const provider = new ethers.BrowserProvider((window as any).ethereum);
            const signer = await provider.getSigner();

            const tx = await signer.sendTransaction({
                to: botAddress,
                value: ethers.parseEther(amountBNB),
            });

            setTxHash(tx.hash);
            setStatus('waiting');

            const token = localStorage.getItem('access_token');
            const res = await fetch(`${apiBase}/api/deposits/create`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    tx_hash: tx.hash,
                    chain: 'BSC',
                    token_symbol: 'BNB',
                }),
            });

            if (!res.ok) {
                throw new Error('Erro ao registrar depósito');
            }

            await tx.wait(3);
            setStatus('confirmed');

            alert(`Depósito confirmado! ${amountBNB} BNB depositados.`);
            loadDepositHistory();
            loadBalance();
        } catch (error: any) {
            setStatus('failed');
            alert('Erro: ' + error.message);
        }
    };

    const handleWithdraw = async (e: React.FormEvent) => {
        e.preventDefault();
        setWithdrawError(null);
        setWithdrawSuccess(false);

        const amount = parseFloat(withdrawAmount);
        if (!amount || amount <= 0) {
            setWithdrawError('Valor inválido');
            return;
        }

        if (amount > usdBalance) {
            setWithdrawError(`Saldo insuficiente. Disponível: $${usdBalance.toFixed(2)}`);
            return;
        }

        if (!withdrawWallet) {
            setWithdrawError('Endereço da wallet obrigatório');
            return;
        }

        setWithdrawLoading(true);

        try {
            const token = localStorage.getItem('access_token');
            const res = await fetch(`${apiBase}/api/withdrawals/request`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    amount_usd: amount,
                    wallet_address: withdrawWallet,
                    chain: withdrawChain,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error?.message || 'Erro ao solicitar saque');
            }

            setWithdrawSuccess(true);
            setWithdrawAmount('');
            setWithdrawWallet('');
            loadBalance();
            loadWithdrawHistory();
        } catch (err: any) {
            setWithdrawError(err.message || 'Erro ao solicitar saque');
        } finally {
            setWithdrawLoading(false);
        }
    };

    const withdrawAll = () => {
        setWithdrawAmount(usdBalance.toString());
    };

    return (
        <div className="min-h-screen bg-neutral-950">
            <div className="mx-auto max-w-5xl px-6 py-10">
                {/* Header */}
                <header className="flex flex-wrap items-center justify-between gap-6 border-b border-neutral-900 pb-8">
                    <div>
                        <span className="section-title">Financeiro</span>
                        <h1 className="mt-3 text-3xl font-semibold text-neutral-50">Depósitos & Saques</h1>
                        <p className="mt-2 text-sm text-neutral-500">
                            Gerencie seus fundos com segurança
                        </p>
                    </div>
                    <Link href="/dashboard" className="btn-secondary px-4 py-2 text-sm">
                        Voltar ao Dashboard
                    </Link>
                </header>

                {/* Tabs */}
                <div className="mt-10 flex gap-4 border-b border-neutral-900">
                    <button
                        onClick={() => setActiveTab('deposit')}
                        className={`pb-3 px-4 text-sm font-semibold transition-colors ${activeTab === 'deposit'
                                ? 'border-b-2 border-purple-500 text-purple-400'
                                : 'text-neutral-500 hover:text-neutral-300'
                            }`}
                    >
                        Depositar
                    </button>
                    <button
                        onClick={() => setActiveTab('withdraw')}
                        className={`pb-3 px-4 text-sm font-semibold transition-colors ${activeTab === 'withdraw'
                                ? 'border-b-2 border-purple-500 text-purple-400'
                                : 'text-neutral-500 hover:text-neutral-300'
                            }`}
                    >
                        Sacar
                    </button>
                </div>

                {/* Deposit Tab */}
                {activeTab === 'deposit' && (
                    <div className="mt-8 space-y-6">
                        {!account ? (
                            <div className="surface-strong  p-8 text-center">
                                <p className="text-neutral-400 mb-6">Conecte sua wallet MetaMask para depositar</p>
                                <button
                                    onClick={connect}
                                    disabled={isConnecting}
                                    className="btn-primary px-6 py-3"
                                >
                                    {isConnecting ? 'Conectando...' : 'Conectar MetaMask'}
                                </button>
                            </div>
                        ) : (
                            <>
                                <div className="surface-strong p-6">
                                    <h2 className="text-lg font-semibold text-neutral-100 mb-4">Fazer Depósito</h2>
                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-sm font-medium text-neutral-300 mb-2">
                                                Valor (BNB)
                                            </label>
                                            <input
                                                type="number"
                                                step="0.001"
                                                value={amountBNB}
                                                onChange={(e) => setAmountBNB(e.target.value)}
                                                className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-3 text-neutral-100"
                                            />
                                            <p className="mt-2 text-xs text-neutral-500">
                                                Saldo: {parseFloat(bnbBalance).toFixed(4)} BNB
                                            </p>
                                        </div>
                                        <button
                                            onClick={handleDeposit}
                                            disabled={status !== 'idle'}
                                            className="btn-primary w-full py-3 disabled:opacity-50"
                                        >
                                            {status === 'sending' && 'Enviando...'}
                                            {status === 'waiting' && 'Aguardando confirmação...'}
                                            {status === 'confirmed' && 'Confirmado!'}
                                            {status === 'failed' && 'Falhou - Tentar novamente'}
                                            {status === 'idle' && 'Depositar'}
                                        </button>
                                    </div>
                                </div>

                                {depositHistory.length > 0 && (
                                    <div className="surface-strong p-6">
                                        <h3 className="text-lg font-semibold text-neutral-100 mb-4">Histórico de Depósitos</h3>
                                        <div className="space-y-3">
                                            {depositHistory.slice(0, 5).map((dep) => (
                                                <div key={dep.id} className="surface p-4 flex justify-between">
                                                    <div>
                                                        <p className="text-sm font-semibold text-neutral-100">
                                                            {dep.amount_token} {dep.token_symbol}
                                                        </p>
                                                        <p className="text-xs text-neutral-500 mt-1">
                                                            {new Date(dep.created_at).toLocaleString('pt-BR')}
                                                        </p>
                                                    </div>
                                                    <span className="text-xs bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 px-3 py-1 rounded-full">
                                                        {dep.status}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}

                {/* Withdraw Tab */}
                {activeTab === 'withdraw' && (
                    <div className="mt-8 space-y-6">
                        <div className="surface-strong p-6">
                            <h2 className="text-lg font-semibold text-neutral-100">Saldo Disponível</h2>
                            <div className="mt-4 text-4xl font-bold text-emerald-400">
                                ${usdBalance.toFixed(2)} USD
                            </div>
                            <p className="mt-2 text-xs text-neutral-500">
                                Valor livre para saque (não inclui posições abertas)
                            </p>
                        </div>

                        <div className="surface-strong p-6">
                            <h2 className="text-lg font-semibold text-neutral-100 mb-6">Solicitar Saque</h2>

                            {withdrawError && (
                                <div className="mb-6 border border-rose-500/40 bg-rose-500/10 px-5 py-4 text-sm text-rose-200">
                                    {withdrawError}
                                </div>
                            )}

                            {withdrawSuccess && (
                                <div className="mb-6 border border-emerald-500/40 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-200">
                                    Saque solicitado com sucesso! Aguarde aprovação.
                                </div>
                            )}

                            <form onSubmit={handleWithdraw} className="space-y-6">
                                <div>
                                    <label className="block text-sm font-medium text-neutral-300 mb-2">
                                        Valor (USD)
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={withdrawAmount}
                                            onChange={(e) => setWithdrawAmount(e.target.value)}
                                            className="flex-1 bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-3 text-neutral-100"
                                            placeholder="100.00"
                                            disabled={withdrawLoading}
                                        />
                                        <button
                                            type="button"
                                            onClick={withdrawAll}
                                            className="btn-secondary px-4 text-sm"
                                            disabled={withdrawLoading}
                                        >
                                            Sacar Tudo
                                        </button>
                                    </div>
                                    <p className="mt-2 text-xs text-neutral-500">
                                        Disponível: ${usdBalance.toFixed(2)}
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-neutral-300 mb-2">
                                        Endereço da Wallet
                                    </label>
                                    <input
                                        type="text"
                                        value={withdrawWallet}
                                        onChange={(e) => setWithdrawWallet(e.target.value)}
                                        className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-3 text-neutral-100 font-mono text-sm"
                                        placeholder="0x..."
                                        disabled={withdrawLoading}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-neutral-300 mb-2">
                                        Blockchain
                                    </label>
                                    <select
                                        value={withdrawChain}
                                        onChange={(e) => setWithdrawChain(e.target.value)}
                                        className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-3 text-neutral-100"
                                        disabled={withdrawLoading}
                                    >
                                        <option value="BSC">BSC (Binance Smart Chain)</option>
                                        <option value="ETH">Ethereum</option>
                                        <option value="SOL">Solana</option>
                                    </select>
                                </div>

                                <button
                                    type="submit"
                                    disabled={withdrawLoading || usdBalance <= 0}
                                    className="btn-primary w-full py-3 text-sm font-semibold disabled:opacity-50"
                                >
                                    {withdrawLoading ? 'Processando...' : 'Solicitar Saque'}
                                </button>
                            </form>
                        </div>

                        {/* Historico de Saques */}
                        {withdrawals.length > 0 && (
                            <div className="surface-strong p-6">
                                <h3 className="text-lg font-semibold text-neutral-100 mb-4">Histórico de Saques</h3>
                                <div className="space-y-3">
                                    {withdrawals.map((w) => (
                                        <div key={w.id} className="surface p-4">
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
                )}
            </div>
        </div>
    );
}
