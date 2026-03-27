const crypto = require('crypto');

const encryptionKey = '7d6435928734a6210b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a';
const privateKey = '5fcAayBmKbM4HYXAHvqeBjuEMYwRZZvVLmB3Je5ZzzoddUxVo1RcWY2493jCbvkGZ1hB96y1n1DvMBrGcudxzjJ';

function encrypt(text, keyHex) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
    
    let encrypted = cipher.update(text, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    const authTag = cipher.getAuthTag();
    
    return JSON.stringify({
        encrypted: encrypted.toString('hex'),
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex')
    });
}

const fs = require('fs');
fs.writeFileSync('encrypted_result.txt', encrypt(privateKey, encryptionKey), 'utf8');
