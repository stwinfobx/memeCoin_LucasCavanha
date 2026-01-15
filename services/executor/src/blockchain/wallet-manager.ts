import '../env';
import crypto from 'crypto';
import { Pool } from 'pg';

export interface EncryptedWallet {
    user_id: string;
    encrypted_private_key: string;
    wallet_address: string;
    chain: string;
}

export class WalletManager {
    private pool: Pool;
    private encryptionKey: string;

    constructor(pool: Pool) {
        this.pool = pool;

        const key = process.env.ENCRYPTION_KEY;
        if (!key) {
            throw new Error('ENCRYPTION_KEY not found in environment');
        }
        this.encryptionKey = key;
    }

    /**
     * Criptografa a chave privada usando AES-256-GCM
     */
    encryptPrivateKey(privateKey: string): string {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(
            'aes-256-gcm',
            Buffer.from(this.encryptionKey, 'hex'),
            iv
        );

        let encrypted = cipher.update(privateKey, 'utf8');
        encrypted = Buffer.concat([encrypted, cipher.final()]);

        // Retornar no formato: iv:encrypted (ambos em hex)
        return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
    }

    /**
     * Descriptografa a chave privada
     */
    decryptPrivateKey(encryptedKey: string): string {
        try {
            const [ivHex, encryptedHex] = encryptedKey.split(':');
            const iv = Buffer.from(ivHex, 'hex');
            const encrypted = Buffer.from(encryptedHex, 'hex');

            const decipher = crypto.createDecipheriv(
                'aes-256-gcm',
                Buffer.from(this.encryptionKey, 'hex'),
                iv
            );

            let decrypted = decipher.update(encrypted);
            decrypted = Buffer.concat([decrypted, decipher.final()]);

            return decrypted.toString('utf8');
        } catch (error: any) {
            throw new Error('Failed to decrypt private key: ' + error.message);
        }
    }

    /**
     * Salva wallet criptografada no banco
     */
    async saveWallet(
        userId: string,
        privateKey: string,
        walletAddress: string,
        chain: string = 'BSC'
    ): Promise<void> {
        const encryptedKey = this.encryptPrivateKey(privateKey);

        await this.pool.query(
            `INSERT INTO user_wallets (user_id, encrypted_private_key, wallet_address, chain)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, chain) 
       DO UPDATE SET encrypted_private_key = $2, wallet_address = $3`,
            [userId, encryptedKey, walletAddress, chain]
        );

        console.log(`[WalletManager] Wallet saved for user ${userId} on ${chain}`);
    }

    /**
     * Recupera wallet do banco
     */
    async getWallet(userId: string, chain: string = 'BSC'): Promise<EncryptedWallet | null> {
        const result = await this.pool.query(
            `SELECT user_id, encrypted_private_key, wallet_address, chain 
       FROM user_wallets 
       WHERE user_id = $1 AND chain = $2`,
            [userId, chain]
        );

        if (result.rows.length === 0) {
            return null;
        }

        return result.rows[0] as EncryptedWallet;
    }

    /**
     * Remove wallet do banco
     */
    async deleteWallet(userId: string, chain: string = 'BSC'): Promise<void> {
        await this.pool.query(
            `DELETE FROM user_wallets WHERE user_id = $1 AND chain = $2`,
            [userId, chain]
        );

        console.log(`[WalletManager] Wallet deleted for user ${userId} on ${chain}`);
    }

    /**
     * Verifica se usuário tem wallet
     */
    async hasWallet(userId: string, chain: string = 'BSC'): Promise<boolean> {
        const wallet = await this.getWallet(userId, chain);
        return wallet !== null;
    }
}
