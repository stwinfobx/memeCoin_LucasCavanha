import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs';

const ROOT_ENV_FLAG = 'TRADINGBOT_ROOT_ENV_INITIALIZED';

if (!process.env[ROOT_ENV_FLAG]) {
  const rootEnvPath = path.resolve(__dirname, '../../../../.env');

  if (fs.existsSync(rootEnvPath)) {
    console.log('✅ Found root .env at:', rootEnvPath);
    dotenv.config({ path: rootEnvPath });
  } else {
    console.log('⚠️ Root .env not found at:', rootEnvPath, '- using local .env');
    dotenv.config();
  }

  process.env[ROOT_ENV_FLAG] = 'true';
}


