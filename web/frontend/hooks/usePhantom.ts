import { useState, useEffect } from 'react';

declare global {
    interface Window {
        solana?: any;
    }
}

export function usePhantom() {
    const [publicKey, setPublicKey] = useState<string | null>(null);
    const [balance, setBalance] = useState<number>(0);
    const [isConnecting, setIsConnecting] = useState(false);
    const [isPhantomInstalled, setIsPhantomInstalled] = useState(false);

    useEffect(() => {
        // Verificar se Phantom está instalado
        setIsPhantomInstalled(typeof window.solana !== 'undefined' && window.solana.isPhantom);
    }, []);

    const connect = async () => {
        if (!window.solana) {
            alert('Phantom Wallet não está instalado! Por favor, instale a extensão.');
            window.open('https://phantom.app/', '_blank');
            return;
        }

        setIsConnecting(true);
        try {
            // Conectar com Phantom
            const resp = await window.solana.connect();
            const pubKey = resp.publicKey.toString();
            setPublicKey(pubKey);

            // Buscar saldo SOL
            // Usando RPC via proxy ou diretamente
            const connection = new (await import('@solana/web3.js')).Connection(
                process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
            );
            const pubKeyObj = new (await import('@solana/web3.js')).PublicKey(pubKey);
            const bal = await connection.getBalance(pubKeyObj);
            setBalance(bal / 1e9); // Lamports to SOL

            // Salvar wallet no backend
            const token = localStorage.getItem('access_token');
            if (token) {
                await fetch('/api/wallet/connect', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                    },
                    body: JSON.stringify({ walletAddress: pubKey, chain: 'SOLANA' }),
                });
            }

            console.log('[Phantom] Connected:', pubKey);
        } catch (error: any) {
            console.error('[Phantom] Error:', error.message);
            alert('Erro ao conectar Phantom: ' + error.message);
        } finally {
            setIsConnecting(false);
        }
    };

    const disconnect = async () => {
        if (window.solana) {
            await window.solana.disconnect();
            setPublicKey(null);
            setBalance(0);
        }
    };

    useEffect(() => {
        if (window.solana) {
            // Detectar mudanças de conta
            window.solana.on('accountChanged', (pubKey: any) => {
                if (pubKey) {
                    setPublicKey(pubKey.toString());
                } else {
                    setPublicKey(null);
                    setBalance(0);
                }
            });

            // Detectar desconexão
            window.solana.on('disconnect', () => {
                setPublicKey(null);
                setBalance(0);
            });

            // Cleanup
            return () => {
                if (window.solana) {
                    window.solana.removeAllListeners('accountChanged');
                    window.solana.removeAllListeners('disconnect');
                }
            };
        }
    }, []);

    return {
        publicKey,
        balance,
        isConnecting,
        isPhantomInstalled,
        connect,
        disconnect,
    };
}
