'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { ethers, BrowserProvider } from 'ethers';

declare global {
    interface Window {
        ethereum?: any;
    }
}

interface MetaMaskContextType {
    account: string | null;
    balance: string;
    chainId: number | null;
    isConnecting: boolean;
    error: string | null;
    isMetaMaskInstalled: boolean;
    connect: () => Promise<void>;
    disconnect: () => void;
    switchToBSC: () => Promise<void>;
}

const MetaMaskContext = createContext<MetaMaskContextType | undefined>(undefined);

export function MetaMaskProvider({ children }: { children: React.ReactNode }) {
    const [account, setAccount] = useState<string | null>(null);
    const [balance, setBalance] = useState<string>('0');
    const [isConnecting, setIsConnecting] = useState(false);
    const [chainId, setChainId] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Helpers to isolate the real MetaMask provider from Phantom injections
    const getMetaMaskProvider = useCallback(() => {
        if (typeof window === 'undefined') return null;
        if (window.ethereum?.providers) {
            const explicitProvider = window.ethereum.providers.find((p: any) => p.isMetaMask && !p.isPhantom);
            if (explicitProvider) return explicitProvider;
        }
        if (window.ethereum && (window.ethereum.isMetaMask || !window.ethereum.isPhantom)) {
            return window.ethereum;
        }
        return null;
    }, []);

    const providerSource = getMetaMaskProvider();
    const isMetaMaskInstalled = !!providerSource;

    const connect = useCallback(async () => {
        const currentProvider = getMetaMaskProvider();
        if (!currentProvider) {
            setError('MetaMask não está instalado!');
            window.open('https://metamask.io/download/', '_blank');
            return;
        }

        setIsConnecting(true);
        setError(null);
        try {
            const provider = new BrowserProvider(currentProvider, "any");
            const accounts = await provider.send('eth_requestAccounts', []);
            const address = accounts[0];

            setAccount(address);
            localStorage.setItem('metamask_account', address);

            const bal = await provider.getBalance(address);
            setBalance(ethers.formatEther(bal));

            const network = await provider.getNetwork();
            setChainId(Number(network.chainId));

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
                    body: JSON.stringify({ walletAddress: address, chain: 'BSC' }),
                }).catch(err => console.error('[MetaMaskContext] Sync failed:', err));
            }

            console.log('[MetaMaskContext] Connected:', address);
        } catch (error: any) {
            console.error('[MetaMaskContext] Error:', error.message);
            setError(error.message);
        } finally {
            setIsConnecting(false);
        }
    }, []);

    const disconnect = useCallback(() => {
        setAccount(null);
        setBalance('0');
        setChainId(null);
        setError(null);
        localStorage.removeItem('metamask_account');
        console.log('[MetaMaskContext] Disconnected');
    }, []);

    const switchToBSC = useCallback(async () => {
        const currentProvider = getMetaMaskProvider();
        if (!currentProvider) return;
        setError(null);
        try {
            await currentProvider.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: '0x38' }],
            });
        } catch (switchError: any) {
            if (switchError.code === 4902) {
                try {
                    await currentProvider.request({
                        method: 'wallet_addEthereumChain',
                        params: [
                            {
                                chainId: '0x38',
                                chainName: 'BSC Mainnet',
                                nativeCurrency: {
                                    name: 'BNB',
                                    symbol: 'BNB',
                                    decimals: 18,
                                },
                                rpcUrls: ['https://bsc-dataseed1.binance.org'],
                                blockExplorerUrls: ['https://bscscan.com'],
                            },
                        ],
                    });
                } catch (addError: any) {
                    setError(addError.message);
                }
            } else {
                setError(switchError.message);
            }
        }
    }, []);

    useEffect(() => {
        const currentProvider = getMetaMaskProvider();
        const savedAccount = localStorage.getItem('metamask_account');

        if (savedAccount && currentProvider) {
            const reconnect = async () => {
                try {
                    const provider = new BrowserProvider(currentProvider, "any");
                    const accounts = await provider.send('eth_accounts', []);
                    if (accounts.includes(savedAccount)) {
                        setAccount(savedAccount);
                        const bal = await provider.getBalance(savedAccount);
                        setBalance(ethers.formatEther(bal));
                        const network = await provider.getNetwork();
                        setChainId(Number(network.chainId));
                    } else {
                        localStorage.removeItem('metamask_account');
                    }
                } catch (error) {
                    console.error('[MetaMaskContext] Auto-reconnect failed:', error);
                }
            };
            reconnect();
        }

        if (currentProvider) {
            currentProvider.on('accountsChanged', (accounts: string[]) => {
                if (accounts.length === 0) {
                    disconnect();
                } else {
                    setAccount(accounts[0]);
                    localStorage.setItem('metamask_account', accounts[0]);
                }
            });

            currentProvider.on('chainChanged', (chainIdHex: string) => {
                setChainId(parseInt(chainIdHex, 16));
            });
        }

        return () => {
            if (currentProvider && currentProvider.removeAllListeners) {
                currentProvider.removeAllListeners('accountsChanged');
                currentProvider.removeAllListeners('chainChanged');
            }
        };
    }, [disconnect, getMetaMaskProvider]);

    return (
        <MetaMaskContext.Provider value={{
            account,
            balance,
            chainId,
            isConnecting,
            error,
            isMetaMaskInstalled,
            connect,
            disconnect,
            switchToBSC
        }}>
            {children}
        </MetaMaskContext.Provider>
    );
}

export function useMetaMaskContext() {
    const context = useContext(MetaMaskContext);
    if (context === undefined) {
        throw new Error('useMetaMaskContext must be used within a MetaMaskProvider');
    }
    return context;
}
