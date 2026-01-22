'use client';

import React from 'react';
import Link from 'next/link';

interface InsufficientBalanceModalProps {
    isOpen: boolean;
    onClose: () => void;
    balance?: number;
}

export default function InsufficientBalanceModal({ isOpen, onClose, balance = 0 }: InsufficientBalanceModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <div className="surface-strong max-w-md w-full p-8 border border-rose-500/30 animate-in fade-in zoom-in duration-200">
                <div className="flex flex-col items-center text-center">
                    {/* Icon */}
                    <div className="h-16 w-16 rounded-full bg-rose-500/10 border border-rose-500/40 flex items-center justify-center mb-6">
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={1.5}
                            stroke="currentColor"
                            className="w-8 h-8 text-rose-500"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                        </svg>
                    </div>

                    <h2 className="text-2xl font-bold text-neutral-50 mb-2">Saldo Insuficiente</h2>

                    <div className="bg-neutral-900/50 border border-neutral-800 rounded-lg px-4 py-3 mb-6 w-full">
                        <p className="text-sm text-neutral-400">Seu saldo disponível atual:</p>
                        <p className="text-xl font-mono font-bold text-rose-400">${balance.toFixed(2)}</p>
                    </div>

                    <p className="text-sm text-neutral-400 mb-8 leading-relaxed">
                        O bot está configurado para operar apenas com **saldo real**.
                        Para iniciar as operações, você precisa ter fundos disponíveis em sua carteira.
                    </p>

                    <div className="flex flex-col gap-3 w-full">
                        <Link
                            href="/deposit"
                            className="btn-primary py-3 text-sm font-semibold text-center"
                            onClick={onClose}
                        >
                            Depositar Agora
                        </Link>
                        <button
                            onClick={onClose}
                            className="btn-secondary py-3 text-sm font-semibold"
                        >
                            Voltar
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
