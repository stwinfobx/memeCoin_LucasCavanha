import { useState, useEffect } from 'react';
import { ethers, BrowserProvider } from 'ethers';

declare global {
    interface Window {
        ethereum?: any;
    }
}

export function useMetaMask() {
    const [account, setAccount] = useState<string | null>(() => {
        // Restaurar conexao do localStorage
        if (typeof window !== 'undefined') {
            return localStorage.getItem('metamask_account') || null;
        }
        return null;
    });
    const [balance, setBalance] = useState<string>('0');
    const [isConnecting, setIsConnecting] = useState(false);
    const [chainId, setChainId] = useState<number | null>(null);

    const connect = async () => {
        if (typeof window.ethereum === 'undefined') {
            alert('MetaMask não está instalado! Por favor, instale a extensão.');
            window.open('https://metamask.io/download/', '_blank');
            return;
        }

        setIsConnecting(true);
        try {
            // Conectar com MetaMask
            const provider = new BrowserProvider(window.ethereum);
            const accounts = await provider.send('eth_requestAccounts', []);
            const address = accounts[0];

            setAccount(address);
            // Salvar no localStorage para persistir
            localStorage.setItem('metamask_account', address);

            // Buscar saldo
            const bal = await provider.getBalance(address);
            setBalance(ethers.formatEther(bal));

            // Buscar chainId
            const network = await provider.getNetwork();
            setChainId(Number(network.chainId));

            // Salvar wallet no backend
            const token = localStorage.getItem('access_token');
            if (token) {
                await fetch('/api/wallet/connect', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                    },
                    body: JSON.stringify({ walletAddress: address, chain: 'BSC' }),
                });
            }

            console.log('[MetaMask] Connected:', address);
        } catch (error: any) {
            console.error('[MetaMask] Error:', error.message);
            alert('Erro ao conectar MetaMask: ' + error.message);
        } finally {
            setIsConnecting(false);
        }
    };

    const disconnect = () => {
        setAccount(null);
        setBalance('0');
        setChainId(null);
        // Limpar do localStorage
        localStorage.removeItem('metamask_account');
    };

    const switchToBSC = async () => {
        try {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: '0x38' }], // BSC Mainnet
            });
        } catch (switchError: any) {
            // Chain não está adicionada, adicionar
            if (switchError.code === 4902) {
                try {
                    await window.ethereum.request({
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
                } catch (addError) {
                    console.error('[MetaMask] Failed to add BSC:', addError);
                }
            }
        }
    };

    useEffect(() => {
        // Auto-reconnect se tiver conta salva
        const savedAccount = localStorage.getItem('metamask_account');
        if (savedAccount && window.ethereum) {
            // Reconectar silenciosamente
            const reconnect = async () => {
                try {
                    const provider = new BrowserProvider(window.ethereum);
                    const bal = await provider.getBalance(savedAccount);
                    setBalance(ethers.formatEther(bal));
                    const network = await provider.getNetwork();
                    setChainId(Number(network.chainId));
                } catch (error) {
                    console.error('[MetaMask] Auto-reconnect failed:', error);
                    localStorage.removeItem('metamask_account');
                    setAccount(null);
                }
            };
            reconnect();
        }

        if (window.ethereum) {
            // Detectar mudanças de conta
            window.ethereum.on('accountsChanged', (accounts: string[]) => {
                if (accounts.length === 0) {
                    disconnect();
                } else {
                    setAccount(accounts[0]);
                    localStorage.setItem('metamask_account', accounts[0]);
                }
            });

            // Detectar mudanças de rede
            window.ethereum.on('chainChanged', (chainIdHex: string) => {
                setChainId(parseInt(chainIdHex, 16));
            });
        }

        // Cleanup
        return () => {
            if (window.ethereum) {
                window.ethereum.removeAllListeners('accountsChanged');
                window.ethereum.removeAllListeners('chainChanged');
            }
        };
    }, []);

    return {
        account,
        balance,
        chainId,
        isConnecting,
        connect,
        disconnect,
        switchToBSC,
    };
}
