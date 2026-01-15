'use client';

import { usePhantom } from '@/hooks/usePhantom';

export default function PhantomConnect() {
    const {
        publicKey,
        balance,
        isConnecting,
        isPhantomInstalled,
        connect,
        disconnect,
    } = usePhantom();

    if (!isPhantomInstalled) {
        return (
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-purple-400 mb-2">
                    Phantom Wallet Not Installed
                </h3>
                <p className="text-neutral-400 mb-4">
                    You need Phantom Wallet to connect. Download it for your browser.
                </p>
                <a
                    href="https://phantom.app/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center px-4 py-2 bg-purple-500 text-white font-medium rounded-lg hover:bg-purple-600 transition-colors"
                >
                    Download Phantom
                </a>
            </div>
        );
    }

    return (
        <div className="bg-[#0a0a1f]/50 backdrop-blur-sm border border-purple-500/20 rounded-lg p-6">
            <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 mb-6">
                Connect Phantom Wallet (Solana)
            </h2>

            {!publicKey ? (
                <div className="space-y-4">
                    <p className="text-neutral-400">
                        Connect your Phantom wallet to trade on Solana.
                    </p>
                    <button
                        onClick={connect}
                        disabled={isConnecting}
                        className="w-full px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {isConnecting ? (
                            <>
                                <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                                <span>Connecting...</span>
                            </>
                        ) : (
                            <>
                                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" />
                                </svg>
                                <span>Connect Phantom</span>
                            </>
                        )}
                    </button>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="bg-purple-500/10 rounded-lg p-4 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-neutral-400">Connected Address:</span>
                            <span className="text-white font-mono text-sm">
                                {publicKey.slice(0, 8)}...{publicKey.slice(-6)}
                            </span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-neutral-400">Balance:</span>
                            <span className="text-green-400 font-semibold">
                                {balance.toFixed(4)} SOL
                            </span>
                        </div>
                    </div>

                    <button
                        onClick={disconnect}
                        className="w-full px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/30 transition-colors"
                    >
                        Disconnect
                    </button>

                    <div className="text-xs text-neutral-500 text-center">
                        Make sure you're on Solana Mainnet
                    </div>
                </div>
            )}
        </div>
    );
}
