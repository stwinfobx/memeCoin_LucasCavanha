import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs';

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

console.log('[Executor ENV] Searching for .env upwards from:', __dirname);

if (rootEnvPath) {
  // override: true permite recarregar variáveis já definidas
  dotenv.config({ path: rootEnvPath, override: true });
  console.log('[Executor ENV] .env loaded from:', rootEnvPath);
  console.log('[Executor ENV] ENCRYPTION_KEY exists:', !!process.env.ENCRYPTION_KEY);
} else {
  console.error('[Executor ENV] ERROR: .env file not found in any parent directories');
  dotenv.config();
}
