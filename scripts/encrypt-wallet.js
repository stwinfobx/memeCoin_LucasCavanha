const crypto = require('crypto');

// A ENCRYPTION_KEY deve ter 64 caracteres hexadecimais (32 bytes)
// IMPORTANTE: Esta chave deve ser a mesma no seu arquivo .env
const ENCRYPTION_KEY = '7d6435928734a6210b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a';


const PRIVATE_KEY = 'e4d60f86224035725d45c8dc7949995e3db3c738b0b7b9d58d93a7dcf1bf4222';

const algorithm = 'aes-256-gcm';
const iv = crypto.randomBytes(16);
const key = Buffer.from(ENCRYPTION_KEY, 'hex');

const cipher = crypto.createCipheriv(algorithm, key, iv);
let encrypted = cipher.update(PRIVATE_KEY, 'utf8', 'hex');
encrypted += cipher.final('hex');
const authTag = cipher.getAuthTag();

const encryptedData = {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
};

console.log('\n================================================================');
console.log(' COPIE A LINHA ABAIXO E COLE NO SEU .env NA VAR BOT_WALLET_PRIVATE_KEY');
console.log('================================================================\n');
console.log('BOT_WALLET_PRIVATE_KEY=' + JSON.stringify(encryptedData));
console.log('\n================================================================\n');
