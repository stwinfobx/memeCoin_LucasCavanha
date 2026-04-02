import express, { Request, Response, Router } from 'express';
import { Pool } from 'pg';
import { authenticate } from '../middleware/auth';
import { WalletManager } from '../../../executor/src/blockchain/wallet-manager';
import { ethers } from 'ethers';

const router: Router = express.Router();

// Assumir que pool já existe no contexto
let pool: Pool;
let walletManager: WalletManager;

export function initWalletRoutes(dbPool: Pool): Router {
    pool = dbPool;
    walletManager = new WalletManager(pool);

    // POST /api/wallet/connect - Conectar wallet existente
    router.post('/connect', authenticate, async (req: Request, res: Response) => {
        try {
            const userId = (req as any).user.userId;
            const { walletAddress, chain = 'BSC' } = req.body;

            const isEvm = chain === 'BSC' || chain === 'BASE' || chain === 'ETH';
            if (isEvm && (!walletAddress || !ethers.isAddress(walletAddress))) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'INVALID_ADDRESS', message: 'Invalid EVM wallet address' },
                });
            }

            // Simple Solana validation (base58, approx length)
            if (chain === 'SOLANA' && (!walletAddress || walletAddress.length < 32 || walletAddress.length > 44)) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'INVALID_ADDRESS', message: 'Invalid Solana wallet address' },
                });
            }

            // Salvar apenas o endereço (sem private key, pois é wallet externa)
            await pool.query(
                `INSERT INTO user_profiles (user_id, wallet_address)
         VALUES ($1, $2)
         ON CONFLICT (user_id)
         DO UPDATE SET wallet_address = $2, updated_at = CURRENT_TIMESTAMP`,
                [userId, walletAddress]
            );

            res.json({
                success: true,
                data: { walletAddress, chain },
                timestamp: new Date(),
            });
        } catch (error: any) {
            console.error('[Wallet] Connect error:', error);
            res.status(500).json({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: error.message },
            });
        }
    });

    // POST /api/wallet/create - Criar nova wallet gerenciada
    router.post('/create', authenticate, async (req: Request, res: Response) => {
        try {
            const userId = (req as any).user.userId;
            const { chain = 'BSC' } = req.body;

            // Verificar se já tem wallet
            const existing = await walletManager.hasWallet(userId, chain);
            if (existing) {
                return res.status(409).json({
                    success: false,
                    error: { code: 'WALLET_EXISTS', message: 'User already has a wallet' },
                });
            }

            // Criar nova wallet
            const wallet = ethers.Wallet.createRandom();
            const privateKey = wallet.privateKey;
            const address = wallet.address;

            // Salvar criptografada
            await walletManager.saveWallet(userId, privateKey, address, chain);

            // IMPORTANTE: Nunca retornar a private key!
            res.json({
                success: true,
                data: {
                    walletAddress: address,
                    chain,
                    message: 'Wallet created successfully. IMPORTANT: Save your recovery phrase!',
                },
                timestamp: new Date(),
            });
        } catch (error: any) {
            console.error('[Wallet] Create error:', error);
            res.status(500).json({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: error.message },
            });
        }
    });

    // GET /api/wallet/info - Obter informações da wallet
    router.get('/info', authenticate, async (req: Request, res: Response) => {
        try {
            const userId = (req as any).user.userId;
            const chain = (req.query.chain as string) || 'BSC';

            const wallet = await walletManager.getWallet(userId, chain);

            if (!wallet) {
                return res.status(404).json({
                    success: false,
                    error: { code: 'WALLET_NOT_FOUND', message: 'No wallet found for this chain' },
                });
            }

            res.json({
                success: true,
                data: {
                    walletAddress: wallet.wallet_address,
                    chain: wallet.chain,
                },
                timestamp: new Date(),
            });
        } catch (error: any) {
            console.error('[Wallet] Info error:', error);
            res.status(500).json({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: error.message },
            });
        }
    });

    // DELETE /api/wallet - Deletar wallet
    router.delete('/', authenticate, async (req: Request, res: Response) => {
        try {
            const userId = (req as any).user.userId;
            const chain = (req.query.chain as string) || 'BSC';

            await walletManager.deleteWallet(userId, chain);

            res.json({
                success: true,
                message: 'Wallet deleted successfully',
                timestamp: new Date(),
            });
        } catch (error: any) {
            console.error('[Wallet] Delete error:', error);
            res.status(500).json({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: error.message },
            });
        }
    });

    return router;
}

export default router;
