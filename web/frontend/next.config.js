const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const ROOT_ENV_FLAG = 'TRADINGBOT_ROOT_ENV_INITIALIZED';

if (!process.env[ROOT_ENV_FLAG]) {
  const rootEnvPath = path.resolve(__dirname, '../../.env');

  if (fs.existsSync(rootEnvPath)) {
    dotenv.config({ path: rootEnvPath });
  } else {
    dotenv.config();
  }

  process.env[ROOT_ENV_FLAG] = 'true';
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000',
    NEXT_PUBLIC_BOT_DEPOSIT_ADDRESS: process.env.NEXT_PUBLIC_BOT_DEPOSIT_ADDRESS,
  },
}

// Garantir que a porta padrão seja 3000
if (!process.env.PORT) {
  process.env.PORT = '3000';
}

module.exports = nextConfig
