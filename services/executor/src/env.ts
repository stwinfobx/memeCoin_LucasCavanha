import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs';

// FORÇA carregamento do .env do root (mesmo que outro serviço já tenha carregado)
const rootEnvPath = path.resolve(__dirname, '../../..', '.env');

console.log('[Executor ENV] Loading .env from:', rootEnvPath);
console.log('[Executor ENV] File exists:', fs.existsSync(rootEnvPath));

if (fs.existsSync(rootEnvPath)) {
  // override: true permite recarregar variáveis já definidas
  dotenv.config({ path: rootEnvPath, override: true });
  console.log('[Executor ENV] .env loaded! ENCRYPTION_KEY exists:', !!process.env.ENCRYPTION_KEY);
  if (process.env.ENCRYPTION_KEY) {
    console.log('[Executor ENV] ENCRYPTION_KEY length:', process.env.ENCRYPTION_KEY.length);
  }
} else {
  console.error('[Executor ENV] ERROR: .env file not found at', rootEnvPath);
  dotenv.config();
}
