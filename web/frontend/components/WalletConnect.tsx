'use client';

import { useMetaMask } from '@/hooks/useMetaMask';
import { useState } from 'react';

export default function WalletConnect() {
    const {
        account,
        balance,
        isConnecting,
        error,
        isMetaMaskInstalled,
        connect,
        disconnect,
        switchToBSC,
    } = useMetaMask();

    const [isSaving, setIsSaving] = useState(false);

    const handleConnectAndSave = async () => {
        // Primeiro conectar MetaMask
        await connect();

        // TODO: Salvar no backend
        // if (account) {
        //   setIsSaving(true);
        //   try {
        //     const response = await fetch('/api/wallet/connect', {
        //       method: 'POST',
        //       headers: {
        //         'Content-Type': 'application/json',
        //         'Authorization': `Bearer ${token}`,
        //       },
        //       body: JSON.stringify({
        //         walletAddress: account,
        //         chain: 'BSC',
        //       }),
        //     });
        //     // Handle response
        //   } finally {
        //     setIsSaving(false);
        //   }
        // }
    };

    if (!isMetaMaskInstalled) {
        return (
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-yellow-500 mb-2">
                    MetaMask não detectado
                </h3>
                <p className="text-gray-400 mb-4">
                    Instale a extensão MetaMask ou certifique-se de que ela está ativa em seu navegador.
                </p>
                <div className="flex gap-3">
                  <a
                      href="https://metamask.io/download/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center px-4 py-2 bg-yellow-500 text-black font-medium rounded-lg hover:bg-yellow-400 transition-colors"
                  >
                      Baixar MetaMask
                  </a>
                  <button 
                    onClick={() => window.location.reload()}
                    className="px-4 py-2 bg-neutral-800 text-neutral-200 rounded-lg hover:bg-neutral-700 transition-colors"
                  >
                    Tentar Novamente
                  </button>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-[#0a0a1f]/50 backdrop-blur-sm border border-purple-500/20 rounded-lg p-6">
            <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 mb-6">
                Connect Your Wallet
            </h2>

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-4">
                    <p className="text-red-400">{error}</p>
                </div>
            )}

            {!account ? (
                <div className="space-y-4">
                    <p className="text-gray-400">
                        Connect your MetaMask wallet to start trading.
                    </p>
                    <button
                        onClick={handleConnectAndSave}
                        disabled={isConnecting || isSaving}
                        className="w-full px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {isConnecting || isSaving ? (
                            <>
                                <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                                <span>Connecting...</span>
                            </>
                        ) : (
                            <>
                                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M21.59 11.59l-2.83-2.83a1 1 0 00-1.41 0 1 1 0 000 1.41L19.17 12l-1.82 1.83a1 1 0 000 1.41 1 1 0 001.41 0l2.83-2.83a1 1 0 000-1.82zM2.41 11.59a1 1 0 000 1.41l2.83 2.83a1 1 0 001.41 0 1 1 0 000-1.41L4.83 12l1.82-1.83a1 1 0 00-1.41-1.41zM9 5a1 1 0 00-1 1v12a1 1 0 002 0V6a1 1 0 00-1-1zm6 0a1 1 0 00-1 1v12a1 1 0 002 0V6a1 1 0 00-1-1z" />
                                </svg>
                                <span>Connect MetaMask</span>
                            </>
                        )}
                    </button>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="bg-purple-500/10 rounded-lg p-4 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-gray-400">Connected Account:</span>
                            <span className="text-white font-mono text-sm">
                                {account.slice(0, 6)}...{account.slice(-4)}
                            </span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-gray-400">Balance:</span>
                            <span className="text-green-400 font-semibold">
                                {balance} BNB
                            </span>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={switchToBSC}
                            className="flex-1 px-4 py-2 bg-orange-500/20 text-orange-400 border border-orange-500/20 rounded-lg hover:bg-orange-500/30 transition-colors"
                        >
                            Switch to BSC
                        </button>
                        <button
                            onClick={disconnect}
                            className="flex-1 px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/30 transition-colors"
                        >
                            Disconnect
                        </button>
                    </div>

                    <div className="text-xs text-gray-500 text-center">
                        Make sure you're connected to BNB Smart Chain Network
                    </div>
                </div>
            )}
        </div>
    );
}
