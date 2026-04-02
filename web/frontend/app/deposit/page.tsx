'use client';

import React, { useState, useEffect } from 'react';
import { useMetaMask } from '../../hooks/useMetaMask';
import { usePhantom } from '../../hooks/usePhantom';
import Link from 'next/link';
import { ethers } from 'ethers';
import { Connection, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import WalletManagerModal from '../../components/WalletManagerModal';

const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const chainIcons: Record<string, string> = {
    BSC: '🟡',
    BASE: '🔵',
    SOLANA: '🟣'
};

const chainNativeTokens: Record<string, string> = {
    BSC: 'BNB',
    BASE: 'ETH',
    SOLANA: 'SOL'
};

const MASTER_ADDRESSES: Record<string, string> = {
    BSC: process.env.NEXT_PUBLIC_BOT_DEPOSIT_ADDRESS || '0x3c9c21ac9dcffe929f19d552ea5cc80192a73c0b',
    BASE: process.env.NEXT_PUBLIC_BOT_DEPOSIT_ADDRESS || '0x3c9c21ac9dcffe929f19d552ea5cc80192a73c0b',
    SOLANA: process.env.NEXT_PUBLIC_SOLANA_DEPOSIT_ADDRESS || 'Endereço Solana Não Configurado'
};

export default function DepositWithdrawPage() {
    const { account: mmAccount, balance: mmBalance, chainId, connect: connectMM, switchToBSC } = useMetaMask();
    const { publicKey: phAccount, balance: phBalance, connect: connectPH } = usePhantom();

    const [selectedChain, setSelectedChain] = useState<'BSC' | 'BASE' | 'SOLANA'>('BSC');
    const [status, setStatus] = useState<'idle' | 'sending' | 'waiting' | 'confirmed' | 'failed'>('idle');
    const [amount, setAmount] = useState('0.1');
    const [usdBalance, setUsdBalance] = useState(0);
    const [depositHistory, setDepositHistory] = useState<any[]>([]);
    const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit');
    const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);

    // Withdraw states
    const [withdrawAmount, setWithdrawAmount] = useState('');
    const [withdrawWallet, setWithdrawWallet] = useState('');
    const [withdrawChain, setWithdrawChain] = useState('BSC');
    const [withdrawLoading, setWithdrawLoading] = useState(false);
    const [withdrawSuccess, setWithdrawSuccess] = useState(false);
    const [withdrawError, setWithdrawError] = useState<string | null>(null);

    useEffect(() => {
        loadBalance();
        loadDepositHistory();
    }, [mmAccount, phAccount]);

    const loadBalance = async () => {
        try {
            const token = localStorage.getItem('access_token');
            const res = await fetch(`${apiBase}/api/balance`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = await res.json();
            if (data.success) {
                setUsdBalance(data.data?.total_balance_usd || 0);
            }
        } catch (e) { console.error(e); }
    };

    const loadDepositHistory = async () => {
        try {
            const token = localStorage.getItem('access_token');
            const res = await fetch(`${apiBase}/api/deposits/history`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = await res.json();
            if (data.success) setDepositHistory(data.data.deposits || []);
        } catch (e) { console.error(e); }
    };

    const currentAccount = selectedChain === 'SOLANA' ? phAccount : mmAccount;
    const currentNativeBalance = selectedChain === 'SOLANA' ? phBalance : Number(mmBalance);

    const handleDeposit = async () => {
        if (!currentAccount) {
            selectedChain === 'SOLANA' ? connectPH() : connectMM();
            return;
        }

        setStatus('sending');
        try {
            let hash = '';
            const master = MASTER_ADDRESSES[selectedChain];

            if (selectedChain === 'SOLANA') {
                const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
                const fromPubkey = new PublicKey(phAccount!);
                const toPubkey = new PublicKey(master);
                
                const transaction = new Transaction().add(
                    SystemProgram.transfer({
                        fromPubkey,
                        toPubkey,
                        lamports: Math.floor(Number(amount) * 1e9),
                    })
                );
                
                const { blockhash } = await connection.getLatestBlockhash();
                transaction.recentBlockhash = blockhash;
                transaction.feePayer = fromPubkey;
                
                const signed = await (window as any).solana.signAndSendTransaction(transaction);
                hash = signed.signature;
            } else {
                const provider = new ethers.BrowserProvider((window as any).ethereum);
                const signer = await provider.getSigner();
                const tx = await signer.sendTransaction({
                    to: master,
                    value: ethers.parseEther(amount),
                });
                hash = tx.hash;
            }

            setStatus('waiting');

            const token = localStorage.getItem('access_token');
            await fetch(`${apiBase}/api/deposits/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    tx_hash: hash,
                    chain: selectedChain,
                    token_symbol: chainNativeTokens[selectedChain],
                }),
            });

            setStatus('confirmed');
            loadBalance();
            loadDepositHistory();
            setTimeout(() => setStatus('idle'), 3000);
        } catch (err: any) {
            console.error(err);
            setStatus('failed');
            alert('Erro: ' + err.message);
        }
    };

    const handleWithdraw = async (e: React.FormEvent) => {
        e.preventDefault();
        setWithdrawLoading(true);
        setWithdrawError(null);
        try {
            const token = localStorage.getItem('access_token');
            const res = await fetch(`${apiBase}/api/withdrawals/request`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    amount_usd: Number(withdrawAmount),
                    wallet_address: withdrawWallet,
                    chain: withdrawChain
                }),
            });
            if (res.ok) {
                setWithdrawSuccess(true);
                setWithdrawAmount('');
                loadBalance();
            } else {
                const data = await res.json();
                setWithdrawError(data.error?.message || 'Erro ao solicitar saque');
            }
        } catch (err: any) {
            setWithdrawError(err.message);
        } finally { setWithdrawLoading(false); }
    };

    return (
        <div className="min-h-screen bg-neutral-950 text-neutral-200">
            <div className="mx-auto max-w-5xl px-6 py-12">
                <header className="flex items-center justify-between border-b border-neutral-900 pb-10">
                    <div>
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-purple-500 bg-purple-500/10 px-3 py-1 rounded-full border border-purple-500/20">Financeiro</span>
                        <h1 className="mt-4 text-4xl font-bold text-neutral-50 tracking-tight">TESOURARIA</h1>
                        <p className="text-sm text-neutral-500 mt-2">Circulação de capital otimizada para Arbitragem e Sniping</p>
                    </div>
                    <Link href="/dashboard" className="group flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-neutral-400 hover:text-neutral-100 transition-colors">
                        <span className="w-8 h-8 rounded-full border border-neutral-800 flex items-center justify-center group-hover:border-neutral-600">←</span>
                        Painel de Controle
                    </Link>
                </header>

                <nav className="mt-12 flex gap-8">
                    <button onClick={() => setActiveTab('deposit')} className={`relative pb-4 text-xs font-bold uppercase tracking-[0.15em] transition-all ${activeTab === 'deposit' ? 'text-purple-400' : 'text-neutral-600 hover:text-neutral-400'}`}>
                        Depósitos Ativos
                        {activeTab === 'deposit' && <span className="absolute bottom-0 left-0 w-full h-0.5 bg-purple-500"></span>}
                    </button>
                    <button onClick={() => setActiveTab('withdraw')} className={`relative pb-4 text-xs font-bold uppercase tracking-[0.15em] transition-all ${activeTab === 'withdraw' ? 'text-purple-400' : 'text-neutral-600 hover:text-neutral-400'}`}>
                        Solicitar Saque
                        {activeTab === 'withdraw' && <span className="absolute bottom-0 left-0 w-full h-0.5 bg-purple-500"></span>}
                    </button>
                </nav>

                {activeTab === 'deposit' && (
                    <div className="mt-12 grid grid-cols-1 lg:grid-cols-3 gap-10">
                        <div className="lg:col-span-2 space-y-8">
                            <section className="bg-neutral-900/30 border border-neutral-900 rounded-3xl p-10 backdrop-blur-sm">
                                <h2 className="text-xl font-bold text-neutral-50 mb-8 flex items-center gap-3">
                                    <span className="w-10 h-10 bg-purple-600/20 rounded-xl flex items-center justify-center text-purple-400">⚡</span>
                                    Alocação de Capital
                                </h2>

                                <div className="grid grid-cols-3 gap-5 mb-10">
                                    {(['BSC', 'BASE', 'SOLANA'] as const).map(chain => (
                                        <button 
                                            key={chain}
                                            onClick={() => setSelectedChain(chain)}
                                            className={`group relative p-6 border transition-all rounded-2xl flex flex-col items-center gap-3 ${selectedChain === chain ? 'border-purple-500 bg-purple-500/5 shadow-[0_0_20px_rgba(168,85,247,0.1)]' : 'border-neutral-800 bg-neutral-900/50 hover:border-neutral-700'}`}
                                        >
                                            <span className="text-3xl group-hover:scale-110 transition-transform">{chainIcons[chain]}</span>
                                            <span className="text-[10px] font-black tracking-widest uppercase opacity-60">{chain}</span>
                                        </button>
                                    ))}
                                </div>

                                {/* Master Address Box */}
                                <div className="mb-10 bg-neutral-950/50 border border-neutral-800 p-6 rounded-2xl">
                                    <div className="flex justify-between items-center mb-4">
                                        <span className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">Endereço de Depósito Master ({selectedChain})</span>
                                        <button 
                                            onClick={() => {
                                                navigator.clipboard.writeText(MASTER_ADDRESSES[selectedChain]);
                                                alert('Endereço copiado!');
                                            }}
                                            className="text-[9px] bg-purple-600 px-3 py-1 rounded-lg text-white font-bold hover:bg-purple-500 transition-colors"
                                        >
                                            COPIAR
                                        </button>
                                    </div>
                                    <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-900 overflow-hidden">
                                        <code className="text-[11px] text-purple-400 font-mono break-all">{MASTER_ADDRESSES[selectedChain]}</code>
                                    </div>
                                    <p className="text-[10px] text-neutral-600 mt-4 flex items-center gap-2">
                                        <span className="w-1 h-1 bg-purple-500 rounded-full"></span>
                                        Envie apenas {chainNativeTokens[selectedChain]} para este endereço. O sistema detectará o depósito em até 2 minutos.
                                    </p>
                                </div>

                                <div className="space-y-8">
                                    <div className="relative">
                                        <div className="flex justify-between items-end mb-3">
                                            <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">Montante ({chainNativeTokens[selectedChain]})</label>
                                            <span className="text-[10px] font-mono text-neutral-400 bg-neutral-800/50 px-2 py-1 rounded">Disponível: {Number(currentNativeBalance).toFixed(4)}</span>
                                        </div>
                                        <input 
                                            type="number" 
                                            value={amount} 
                                            onChange={e => setAmount(e.target.value)}
                                            className="w-full bg-neutral-950 border border-neutral-800 rounded-2xl px-6 py-5 text-2xl font-mono text-neutral-50 focus:outline-none focus:ring-1 focus:ring-purple-500/50 transition-all shadow-inner"
                                        />
                                    </div>

                                    {!currentAccount ? (
                                        <button 
                                            onClick={() => setIsWalletModalOpen(true)}
                                            className="w-full py-5 bg-neutral-50 text-neutral-950 text-xs font-black uppercase tracking-[0.2em] rounded-2xl hover:bg-white transition-all shadow-[0_10px_30px_rgba(255,255,255,0.1)] active:scale-[0.98]"
                                        >
                                            Conectar Carteira ({selectedChain === 'SOLANA' ? 'Phantom' : 'MetaMask'})
                                        </button>
                                    ) : (
                                        <button 
                                            onClick={handleDeposit}
                                            disabled={status !== 'idle'}
                                            className="w-full py-5 bg-purple-600 text-white text-xs font-black uppercase tracking-[0.2em] rounded-2xl hover:bg-purple-500 transition-all shadow-lg active:scale-[0.98] disabled:opacity-50 disabled:grayscale"
                                        >
                                            {status === 'idle' ? `Confirmar Transferência ${selectedChain}` : status === 'sending' ? 'Processando...' : status === 'waiting' ? 'Validando Chain...' : '✅ Sucesso'}
                                        </button>
                                    )}
                                </div>
                            </section>

                            <section className="bg-neutral-900/20 border border-neutral-900 rounded-3xl p-10">
                                <h3 className="text-xs font-black text-neutral-500 uppercase tracking-widest mb-8 flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-pulse"></span>
                                    Log de Atividade
                                </h3>
                                <div className="space-y-4">
                                    {depositHistory.slice(0, 5).map(dep => (
                                        <div key={dep.id} className="p-5 border border-neutral-800 rounded-2xl flex items-center justify-between hover:bg-neutral-800/30 transition-all">
                                            <div className="flex items-center gap-5">
                                                <div className="w-12 h-12 rounded-xl bg-neutral-900 flex items-center justify-center text-xl shadow-inner">{chainIcons[dep.chain] || '❓'}</div>
                                                <div>
                                                    <p className="text-sm font-bold text-neutral-100">{dep.amount_token} {dep.token_symbol}</p>
                                                    <p className="text-[10px] text-neutral-500 font-mono mt-1 opacity-60">{dep.chain} • {new Date(dep.created_at).toLocaleDateString()}</p>
                                                </div>
                                            </div>
                                            <div className="px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border border-neutral-700 bg-neutral-900/50">
                                                {dep.status}
                                            </div>
                                        </div>
                                    ))}
                                    {depositHistory.length === 0 && <div className="text-center py-10 opacity-30 text-xs italic">Sem registros recentes</div>}
                                </div>
                            </section>
                        </div>

                        <aside className="space-y-8">
                            <div className="bg-gradient-to-br from-neutral-900/50 to-neutral-950 border border-neutral-800 rounded-3xl p-8 space-y-8">
                                <div>
                                    <h4 className="text-[10px] font-black text-purple-500 uppercase tracking-widest mb-4">Protocolo de Segurança</h4>
                                    <p className="text-xs text-neutral-500 leading-relaxed italic">
                                        "A segregação de ativos por blockchain mitiga riscos sistêmicos e garante liquidez persistente para execução de arbitragem."
                                    </p>
                                </div>
                                
                                <div className="pt-8 border-t border-neutral-800 space-y-5">
                                    <div className="flex justify-between items-center text-[10px]">
                                        <span className="font-bold text-neutral-600 uppercase tracking-tighter">Gateway Conectado</span>
                                        <span className="font-mono text-neutral-400">{currentAccount ? `${currentAccount.slice(0, 6)}...${currentAccount.slice(-4)}` : 'Nenhum'}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-[10px]">
                                        <span className="font-bold text-neutral-600 uppercase tracking-tighter">Confirmações Target</span>
                                        <span className="font-bold text-purple-400">3 BLOCOS</span>
                                    </div>
                                </div>
                            </div>
                        </aside>
                    </div>
                )}

                {activeTab === 'withdraw' && (
                    <div className="mt-12 max-w-2xl mx-auto space-y-12">
                        <section className="bg-neutral-900/30 border border-neutral-900 rounded-3xl p-12 text-center backdrop-blur-md relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent"></div>
                            <p className="text-[10px] font-black text-neutral-500 uppercase tracking-[0.25em] mb-4">Saldo Liquidável Consolidado</p>
                            <h2 className="text-6xl font-black text-white tracking-tighter">${usdBalance.toFixed(2)}</h2>
                            <p className="text-[10px] text-neutral-600 mt-6 tracking-wide">Os valores em staking ou posições abertas não são exibidos aqui.</p>
                        </section>

                        <section className="bg-neutral-900/50 border border-neutral-800 rounded-3xl p-10">
                            <h3 className="text-sm font-bold text-neutral-100 mb-8">Informar Destino</h3>
                            <form onSubmit={handleWithdraw} className="space-y-8">
                                <div className="grid grid-cols-2 gap-6">
                                    <div className="col-span-1">
                                        <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest mb-3 block">Montante (USD)</label>
                                        <input type="number" step="0.01" value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-5 py-4 text-white font-mono" placeholder="0.00" />
                                    </div>
                                    <div className="col-span-1">
                                        <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest mb-3 block">Blockchain de Saída</label>
                                        <select value={withdrawChain} onChange={e => setWithdrawChain(e.target.value)} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-5 py-4 text-white uppercase text-xs font-bold">
                                            <option value="BSC">BSC (BEP20)</option>
                                            <option value="BASE">Base (L2)</option>
                                            <option value="SOL">Solana</option>
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest mb-3 block">Endereço Público de Destino</label>
                                    <input type="text" value={withdrawWallet} onChange={e => setWithdrawWallet(e.target.value)} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-5 py-4 text-white font-mono text-xs" placeholder="Cole seu endereço de recebimento..." />
                                </div>

                                <button type="submit" disabled={withdrawLoading || usdBalance <= 0} className="w-full py-5 bg-emerald-600 text-white text-xs font-black uppercase tracking-widest rounded-2xl hover:bg-emerald-500 transition-all shadow-lg active:scale-0.98 disabled:opacity-50">
                                    {withdrawLoading ? 'Confirmando Protocolo...' : 'Extrair Capital'}
                                </button>
                                
                                {withdrawSuccess && <p className="text-xs text-emerald-400 text-center font-bold">Solicitação registrada no ledger. Aguarde processamento.</p>}
                                {withdrawError && <p className="text-xs text-rose-400 text-center font-bold">{withdrawError}</p>}
                            </form>
                        </section>
                    </div>
                )}
            </div>
            
            <WalletManagerModal 
                isOpen={isWalletModalOpen} 
                onClose={() => setIsWalletModalOpen(false)} 
            />
        </div>
    );
}
