'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

interface PhantomContextType {
    publicKey: string | null;
    balance: number;
    isConnecting: boolean;
    isPhantomInstalled: boolean;
    connect: () => Promise<void>;
    disconnect: () => Promise<void>;
    error: string | null;
}

const PhantomContext = createContext<PhantomContextType | undefined>(undefined);

export const PhantomProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [publicKey, setPublicKey] = useState<string | null>(null);
    const [balance, setBalance] = useState<number>(0);
    const [isConnecting, setIsConnecting] = useState(false);
    const [isPhantomInstalled, setIsPhantomInstalled] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Initial check
    useEffect(() => {
        const checkInstallation = () => {
            const isInstalled = typeof window !== 'undefined' && (window as any).solana?.isPhantom;
            setIsPhantomInstalled(!!isInstalled);
            return !!isInstalled;
        };

        checkInstallation();

        // Auto-reconnect if it was connected before
        const wasConnected = localStorage.getItem('phantom_connected') === 'true';
        if (wasConnected && (window as any).solana) {
            connect(true); // silent connect
        }

        // Listen for events
        const solana = (window as any).solana;
        if (solana) {
            solana.on('accountChanged', (newPublicKey: any) => {
                if (newPublicKey) {
                    setPublicKey(newPublicKey.toString());
                    fetchBalance(newPublicKey.toString());
                } else {
                    handleDisconnect();
                }
            });

            solana.on('disconnect', () => {
                handleDisconnect();
            });
        }

        return () => {
            if (solana) {
                solana.removeAllListeners('accountChanged');
                solana.removeAllListeners('disconnect');
            }
        };
    }, []);

    const handleDisconnect = useCallback(() => {
        setPublicKey(null);
        setBalance(0);
        localStorage.removeItem('phantom_connected');
    }, []);

    const fetchBalance = async (address: string) => {
        try {
            const rpcUrls = [
                process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
                'https://solana-rpc.publicnode.com',
                'https://rpc.ankr.com/solana',
                'https://api.mainnet-beta.solana.com'
            ].filter(Boolean) as string[];

            for (const rpc of rpcUrls) {
                try {
                    const solanaWeb3 = await import('@solana/web3.js');
                    // Desabilitar retries internos para falhar rápido e pular para o próximo RPC
                    const connection = new solanaWeb3.Connection(rpc, {
                        disableRetryOnRateLimit: true,
                        commitment: 'confirmed'
                    });
                    const pubKeyObj = new solanaWeb3.PublicKey(address);
                    const bal = await connection.getBalance(pubKeyObj);
                    setBalance(bal / 1e9);
                    console.log(`[PhantomContext] Balance fetched via ${rpc}`);
                    return;
                } catch (e: any) {
                    console.warn(`[PhantomContext] RPC fail ${rpc}:`, e.message);
                }
            }

            // Fallback Final: Solscan API (Direto via HTTPS)
            const solscanKey = process.env.NEXT_PUBLIC_SOLSCAN_API_KEY;
            if (solscanKey && solscanKey !== 'YOUR_SOLSCAN_API_KEY_HERE') {
                try {
                    console.log('[PhantomContext] All RPCs failed. Attempting Solscan API fallback...');
                    const response = await fetch(`https://pro-api.solscan.io/v2.0/account/detail?address=${address}`, {
                        headers: { 'token': solscanKey }
                    });
                    const data = await response.json();
                    if (data?.data?.sol_balance !== undefined) {
                        setBalance(Number(data.data.sol_balance));
                        console.log('[PhantomContext] Balance fetched via Solscan API');
                        return;
                    }
                } catch (err) {
                    console.error('[PhantomContext] Solscan API fallback failed:', err);
                }
            }
        } catch (e) {
            console.error('[PhantomContext] Balance error:', e);
        }
    };

    const connect = async (silent = false) => {
        if (typeof window === 'undefined') return;
        const solana = (window as any).solana;
        
        if (!solana) {
            if (!silent) alert('Phantom Wallet as not found!');
            return;
        }

        setIsConnecting(true);
        setError(null);

        try {
            const resp = await (silent 
                ? solana.connect({ onlyIfTrusted: true }) 
                : solana.connect());
            const pubKey = resp.publicKey.toString();
            setPublicKey(pubKey);
            localStorage.setItem('phantom_connected', 'true');
            await fetchBalance(pubKey);

            // Sync with backend
            const token = localStorage.getItem('access_token');
            if (token) {
                const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
                await fetch(`${apiBase}/api/wallet/connect`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                    },
                    body: JSON.stringify({ walletAddress: pubKey, chain: 'SOLANA' }),
                }).catch(e => console.error('[PhantomContext] Backend sync fail:', e));
            }
        } catch (err: any) {
            console.error('[PhantomContext] Connect error:', err);
            if (!silent) {
                if (err.message?.includes('Extension context invalidated')) {
                    alert('Phantom extension was updated or crashed. Please refresh (F5).');
                } else {
                    setError(err.message);
                }
            }
            if (silent) handleDisconnect();
        } finally {
            setIsConnecting(false);
        }
    };

    const disconnect = async () => {
        const solana = (window as any).solana;
        if (solana) {
            await solana.disconnect();
        }
        handleDisconnect();
    };

    return (
        <PhantomContext.Provider value={{
            publicKey,
            balance,
            isConnecting,
            isPhantomInstalled,
            connect,
            disconnect,
            error
        }}>
            {children}
        </PhantomContext.Provider>
    );
};

export const usePhantomContext = () => {
    const context = useContext(PhantomContext);
    if (context === undefined) {
        throw new Error('usePhantomContext must be used within a PhantomProvider');
    }
    return context;
};
