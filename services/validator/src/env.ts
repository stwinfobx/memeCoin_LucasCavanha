import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs';

const ROOT_ENV_FLAG = 'TRADINGBOT_ROOT_ENV_INITIALIZED';

if (!process.env[ROOT_ENV_FLAG]) {
  // Busca recursiva para cima até encontrar o .env
  let currentDir = __dirname;
  let rootEnvPath = '';

  while (currentDir !== path.parse(currentDir).root) {
    const potentialPath = path.join(currentDir, '.env');
    if (fs.existsSync(potentialPath)) {
      rootEnvPath = potentialPath;
      break;
    }
    currentDir = path.dirname(currentDir);
  }

  if (rootEnvPath) {
    console.log('✅ [Validator] Found root .env at:', rootEnvPath);
    dotenv.config({ path: rootEnvPath });
  } else {
    console.log('⚠️ [Validator] Root .env not found in any parent directories');
    dotenv.config();
  }

  process.env[ROOT_ENV_FLAG] = 'true';
}


