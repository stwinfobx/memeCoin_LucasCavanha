'use client';

import React from 'react';
import { useMetaMask } from '../hooks/useMetaMask';
import { usePhantom } from '../hooks/usePhantom';

interface WalletManagerModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function WalletManagerModal({ isOpen, onClose }: WalletManagerModalProps) {
    const {
        account: mmAccount,
        balance: mmBalance,
        isConnecting: mmConnecting,
        isMetaMaskInstalled,
        connect: connectMM,
        disconnect: disconnectMM,
        error: mmError
    } = useMetaMask();

    const {
        publicKey: phAccount,
        balance: phBalance,
        isConnecting: phConnecting,
        isPhantomInstalled,
        connect: connectPH,
        disconnect: disconnectPH,
    } = usePhantom();

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-neutral-900 border border-neutral-800 rounded-3xl w-full max-w-md shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 to-indigo-500"></div>
                
                <div className="p-6">
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <h2 className="text-xl font-bold text-neutral-50">Gerenciar Carteiras</h2>
                            <p className="text-xs text-neutral-400 mt-1">Conecte ou desconecte suas carteiras web3.</p>
                        </div>
                        <button 
                            onClick={onClose}
                            className="w-8 h-8 rounded-full bg-neutral-800 hover:bg-neutral-700 flex items-center justify-center text-neutral-400 transition-colors"
                        >
                            ✕
                        </button>
                    </div>

                    <div className="space-y-4">
                        {/* MetaMask Box */}
                        <div className={`p-5 rounded-2xl border transition-all ${mmAccount ? 'bg-purple-900/10 border-purple-500/30' : 'bg-neutral-950 border-neutral-800'}`}>
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <span className="text-2xl">🦊</span>
                                    <div>
                                        <h3 className="text-sm font-bold text-neutral-100">MetaMask (EVM)</h3>
                                        <p className="text-[10px] text-neutral-500">BSC, Base, Ethereum</p>
                                    </div>
                                </div>
                                {mmAccount ? (
                                    <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest bg-emerald-500/20 text-emerald-400 rounded-md">Conectado</span>
                                ) : (
                                    <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest bg-neutral-800 text-neutral-500 rounded-md">Desconectado</span>
                                )}
                            </div>

                            {mmAccount ? (
                                <div className="space-y-4">
                                    <div className="bg-neutral-900/50 rounded-lg p-3">
                                        <p className="text-[10px] text-neutral-500 uppercase tracking-widest mb-1">Endereço</p>
                                        <p className="text-xs font-mono text-purple-300 break-all">{mmAccount}</p>
                                        <div className="flex justify-between mt-2 pt-2 border-t border-neutral-800">
                                            <span className="text-[10px] text-neutral-500 uppercase tracking-widest">Saldo BNB (UI)</span>
                                            <span className="text-xs font-bold text-neutral-300">{Number(mmBalance).toFixed(4)}</span>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={disconnectMM}
                                        className="w-full py-2.5 rounded-xl border border-red-500/30 text-red-400 text-xs font-bold uppercase tracking-widest hover:bg-red-500/10 transition-colors"
                                    >
                                        Desconectar MetaMask
                                    </button>
                                </div>
                            ) : (
                                <div>
                                    {!isMetaMaskInstalled ? (
                                        <div className="text-xs text-amber-500 mb-3 bg-amber-500/10 p-2 rounded-lg">
                                            Extensão não detectada ou sobrecarregada pela Phantom.
                                        </div>
                                    ) : mmError ? (
                                        <div className="text-xs text-red-400 mb-3 bg-red-500/10 p-2 rounded-lg break-all">
                                            {mmError}
                                        </div>
                                    ) : null}
                                    
                                    <button 
                                        onClick={connectMM}
                                        disabled={mmConnecting || !isMetaMaskInstalled}
                                        className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold uppercase tracking-widest transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {mmConnecting ? (
                                            <>
                                                <span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin"></span>
                                                Conectando...
                                            </>
                                        ) : 'Conectar MetaMask'}
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Phantom Box */}
                        <div className={`p-5 rounded-2xl border transition-all ${phAccount ? 'bg-indigo-900/10 border-indigo-500/30' : 'bg-neutral-950 border-neutral-800'}`}>
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <span className="text-2xl">👻</span>
                                    <div>
                                        <h3 className="text-sm font-bold text-neutral-100">Phantom</h3>
                                        <p className="text-[10px] text-neutral-500">Solana Network</p>
                                    </div>
                                </div>
                                {phAccount ? (
                                    <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest bg-emerald-500/20 text-emerald-400 rounded-md">Conectado</span>
                                ) : (
                                    <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest bg-neutral-800 text-neutral-500 rounded-md">Desconectado</span>
                                )}
                            </div>

                            {phAccount ? (
                                <div className="space-y-4">
                                    <div className="bg-neutral-900/50 rounded-lg p-3">
                                        <p className="text-[10px] text-neutral-500 uppercase tracking-widest mb-1">Endereço</p>
                                        <p className="text-xs font-mono text-indigo-300 break-all">{phAccount}</p>
                                        <div className="flex justify-between mt-2 pt-2 border-t border-neutral-800">
                                            <span className="text-[10px] text-neutral-500 uppercase tracking-widest">Saldo SOL (UI)</span>
                                            <span className="text-xs font-bold text-neutral-300">{phBalance.toFixed(4)}</span>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={disconnectPH}
                                        className="w-full py-2.5 rounded-xl border border-red-500/30 text-red-400 text-xs font-bold uppercase tracking-widest hover:bg-red-500/10 transition-colors"
                                    >
                                        Desconectar Phantom
                                    </button>
                                </div>
                            ) : (
                                <div>
                                    {!isPhantomInstalled && (
                                        <div className="text-xs text-amber-500 mb-3 bg-amber-500/10 p-2 rounded-lg">
                                            Phantom não instalada.
                                        </div>
                                    )}
                                    <button 
                                        onClick={connectPH}
                                        disabled={phConnecting || !isPhantomInstalled}
                                        className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold uppercase tracking-widest transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {phConnecting ? (
                                            <>
                                                <span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin"></span>
                                                Conectando...
                                            </>
                                        ) : 'Conectar Phantom'}
                                    </button>
                                </div>
                            )}
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}
