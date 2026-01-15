# GUIA DE CONFIGURACAO PARA DEPLOY - TradingBot AI

> Passo a passo COMPLETO para preparar o sistema para producao  
> Foco: Configuracoes, variaveis de ambiente, migrations  
> Data: 15 de Janeiro de 2026

---

## INDICE

1. [Pre-Requisitos](#1-pre-requisitos)
2. [Configuracao do Banco de Dados](#2-configuracao-do-banco-de-dados)
3. [Configuracao do .env](#3-configuracao-do-env)
4. [Aplicar Migrations](#4-aplicar-migrations)
5. [Preparar Wallet do Bot](#5-preparar-wallet-do-bot)
6. [Configurar Servicos Externos](#6-configurar-servicos-externos)
7. [Testar Localmente](#7-testar-localmente)
8. [Checklist Final](#8-checklist-final)

---

## 1. PRE-REQUISITOS

### O que voce precisa ter ANTES de comecar:

- [x] Conta no Supabase (banco de dados PostgreSQL) - JA TEM
- [x] Conta no Resend (envio de emails) - JA TEM
- [ ] Wallet BSC (MetaMask) para o bot receber/enviar fundos
- [ ] API Keys da BSCScan - JA TEM
- [x] Node.js instalado (v18+)
- [x] Git instalado

---

## 2. CONFIGURACAO DO BANCO DE DADOS

### 2.1 Acessar Supabase

1. Ir para [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. Fazer login
3. Selecionar seu projeto: `izyvctoikuxzmbwiyifo`

### 2.2 Obter Connection String

1. No dashboard do Supabase, ir em "Database"
2. Clicar em "Connection String"
3. Copiar a URI completa (incluindo senha)
4. Adicionar ao .env:
```
DATABASE_URL=postgresql://postgres:SUA_SENHA@db.PROJETO.supabase.co:5432/postgres
```

---

## 3. CONFIGURACAO DO .env

### 3.1 O QUE ESTA CORRETO (NAO MEXER)

```env
# Banco - Configurar com seus dados
DATABASE_URL=postgresql://postgres:SUA_SENHA@db.SEU_PROJETO.supabase.co:5432/postgres
POSTGRES_HOST=db.SEU_PROJETO.supabase.co
POSTGRES_PORT=5432
POSTGRES_DB=postgres
POSTGRES_USER=postgres
POSTGRES_PASSWORD=SUA_SENHA_SUPABASE
POSTGRES_SSL=true

# Email - Configurar com sua chave Resend
EMAIL_SERVICE=resend
RESEND_API_KEY=re_SUA_CHAVE_RESEND_AQUI

# APIs - Obter em https://bscscan.com/apis
BSCSCAN_API_KEY=SUA_CHAVE_BSCSCAN_AQUI

# Criptografia - Gerar nova chave
ENCRYPTION_KEY=GERAR_CHAVE_64_CARACTERES_HEX

# Modo de execucao
BOT_EXECUTION_MODE=live
```

### 3.2 O QUE PRECISA MUDAR

#### URGENTE - Seguranca:

```env
# PROBLEMA: JWT_SECRET usa a mesma senha do banco
JWT_SECRET=9TKBZv9wBf4bmL2X  # TROCAR!

# SOLUCAO: Gerar nova chave
# No PowerShell:
```
```powershell
# Gerar JWT_SECRET
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$jwt_secret = [Convert]::ToBase64String($bytes)
Write-Host "JWT_SECRET=$jwt_secret"
```

**Copiar o output e substituir no .env**

#### IMPORTANTE - Wallet do Bot:

```env
# Criar nova wallet no MetaMask
# Exportar a private key
# ENCRIPTAR usando o script abaixo
BOT_WALLET_PRIVATE_KEY=CHAVE_ENCRIPTADA_AQUI

# Endereco publico da wallet (para receber depositos)
BOT_DEPOSIT_ADDRESS=0xSUA_WALLET_BSC_AQUI
```

**Primeiro, gerar ENCRYPTION_KEY:**

```powershell
# Gerar chave de 64 caracteres hex
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$hex = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ''
Write-Host "ENCRYPTION_KEY=$hex"
```

Copiar o output e adicionar ao .env.

**Depois, encriptar a chave privada:**

1. Criar arquivo `scripts/encrypt-wallet.js`:
```javascript
const crypto = require('crypto');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'SUA_ENCRYPTION_KEY_GERADA_ACIMA';
const PRIVATE_KEY = 'SUA_PRIVATE_KEY_DA_WALLET_AQUI'; // Cole aqui

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

console.log('BOT_WALLET_PRIVATE_KEY=' + JSON.stringify(encryptedData));
```

2. Executar:
```powershell
node scripts/encrypt-wallet.js
```

3. Copiar o output BOT_WALLET_PRIVATE_KEY e colar no .env

#### OPCIONAL mas RECOMENDADO:

```env
# Email - usar dominio proprio se tiver
EMAIL_FROM=noreply@seudominio.com
# Configurar dominio no Resend: https://resend.com/domains

# RPC URL - usar Ankr para maior confiabilidade
BSC_RPC_URL=https://rpc.ankr.com/bsc
# OU usar Binance direto:
BSC_RPC_URL=https://bsc-dataseed1.binance.org

# Solana (se for usar Solana no futuro)
SOLSCAN_API_KEY=sua_chave_real_solscan
```

### 3.3 .env FINAL CORRIGIDO

Apos fazer as mudancas acima, seu .env deve ter:

```env
#  =================================================
# CONFIGURACOES GERAIS
# ======================================================

NODE_ENV=production  # MUDAR PARA PRODUCTION
PORT=4000
APP_NAME=TradingBotAI
FRONTEND_URL=https://seu-dominio-vercel.app
BACKEND_URL=https://seu-backend-render.com

# ======================================================
# BANCO DE DADOS
# ======================================================

DATABASE_URL=postgresql://postgres:SUA_SENHA@db.SEU_PROJETO.supabase.co:5432/postgres
POSTGRES_HOST=db.SEU_PROJETO.supabase.co
POSTGRES_PORT=5432
POSTGRES_DB=postgres
POSTGRES_USER=postgres
POSTGRES_PASSWORD=SUA_SENHA_SUPABASE
POSTGRES_SSL=true

# ======================================================
# SEGURANCA / AUTENTICACAO
# ======================================================

JWT_SECRET=GERAR_NOVA_CHAVE_AQUI  # Ver secao 3.2
JWT_EXPIRATION=1800min
REFRESH_TOKEN_EXPIRATION=7d
ENCRYPTION_KEY=GERAR_CHAVE_64_HEX  # Ver secao 3.2
CORS_ORIGIN=https://seu-frontend.vercel.app

# ======================================================
# EMAIL / NOTIFICACOES
# ======================================================

EMAIL_SERVICE=resend
RESEND_API_KEY=re_SUA_API_KEY_RESEND
EMAIL_FROM=noreply@seudominio.com

# ======================================================
# MICROSERVICES URLS
# ======================================================

SIGNAL_SERVICE_URL=http://localhost:4002  # Ou URL do servico no Render
EXECUTOR_SERVICE_URL=http://localhost:4003  # Ou URL do servico no Render

# ======================================================
# APIs DE MERCADO
# ======================================================

GECKOTERMINAL_BASE_URL=https://api.geckoterminal.com/api/v2
DEX_API_URL=https://api.dexscreener.com/latest/dex
BSCSCAN_API_KEY=SUA_CHAVE_BSCSCAN  # Obter em bscscan.com/apis

# ======================================================
# BLOCKCHAIN
# ======================================================

BSC_RPC_URL=https://bsc-dataseed1.binance.org
BOT_WALLET_PRIVATE_KEY=<CHAVE_ENCRIPTADA>  # TROCAR!
BOT_DEPOSIT_ADDRESS=<ENDERECO_WALLET>  # TROCAR!

# ======================================================
# CONFIGURACOES DO BOT
# ======================================================

BOT_EXECUTION_MODE=live  # JA ESTA CORRETO!
BOT_MAX_OPEN_TRADES=3
BOT_MAX_LOSS_PERCENT=10
BOT_MAX_GAIN_PERCENT=25

# ======================================================
# LOGS
# ======================================================

LOG_LEVEL=info
```

---

## 4. APLICAR MIGRATIONS

### 4.1 Acessar SQL Editor do Supabase

1. Ir para [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. Selecionar projeto
3. Clicar em "SQL Editor" no menu lateral

### 4.2 Executar Scripts em Ordem

**Migration 1: Schema Principal**

Copiar conteudo de `infra/postgres/schema.sql` e executar

**Migration 2: Novos Campos (Positions)**

Copiar conteudo de `scripts/migration-001-positions.sql` e executar (se existir)

**Migration 3: Notificacoes**

Copiar conteudo de `scripts/migration-002-notifications.sql` e executar (se existir)

**Migration 4: Deposits**

Copiar conteudo de `scripts/migration-003-deposits.sql` e executar (se existir)

**Migration 5: Withdrawals (NOVO!)**

Copiar conteudo de `scripts/migration-005-withdrawals.sql` e executar

### 4.3 Verificar Tabelas Criadas

No Supabase, ir em "Table Editor" e verificar que existem:

- users
- user_profiles
- tokens
- signals
- orders
- ledger_entries
- positions
- bot_notifications
- deposits
- **withdrawals (NOVA!)**
- audit_logs

---

## 5. PREPARAR WALLET DO BOT

### 5.1 Criar Nova Wallet

1. Abrir MetaMask
2. Criar nova conta
3. **IMPORTANTE**: Guardar seed phrase em local seguro
4. Copiar endereco da wallet (0x...)
5. Exportar private key:
   - Clicar nos 3 pontinhos
   - "Detalhes da conta"
   - "Exportar chave privada"
   - Inserir senha do MetaMask
   - Copiar a chave

### 5.2 Encriptar Chave Privada

Usar o script `scripts/encrypt-wallet.js` (criado na secao 3.2)

### 5.3 Adicionar ao .env

```env
BOT_WALLET_PRIVATE_KEY={"encrypted":"...","iv":"...","authTag":"..."}
BOT_DEPOSIT_ADDRESS=0xSEU_ENDERECO_AQUI
```

### 5.4 Adicionar ao Frontend

No arquivo `web/frontend/.env.local`:
```env
NEXT_PUBLIC_BOT_DEPOSIT_ADDRESS=0xSEU_ENDERECO_AQUI
```

---

## 6. CONFIGURAR SERVICOS EXTERNOS

### 6.1 Resend (Email)

1. Ir para [https://resend.com/domains](https://resend.com/domains)
2. Adicionar seu dominio (ex: tradingbotai.com)
3. Configurar DNS records conforme orientacoes
4. Aguardar verificacao (ate 48h)
5. Atualizar EMAIL_FROM no .env:
```env
EMAIL_FROM=noreply@seudominio.com
```

**Enquanto nao verificar dominio:**
Pode usar email generico:
```env
EMAIL_FROM=onboarding@resend.dev
```

### 6.2 BSCScan API

**Obter chave:**
1. Ir para [https://bscscan.com/apis](https://bscscan.com/apis)
2. Registrar se necessario
3. Gerar nova API Key
4. Copiar e adicionar ao .env:
```env
BSCSCAN_API_KEY=SUA_CHAVE_AQUI
```

**Testar:**
```
https://api.bscscan.com/api?module=account&action=balance&address=0x0000000000000000000000000000000000000000&apikey=SUA_CHAVE
```

Se retornar JSON, funcionou!

---

## 7. TESTAR LOCALMENTE

### 7.1 Instalar Dependencias

```powershell
# Na raiz do projeto
.\install-deps.ps1
```

### 7.2 Iniciar Todos os Servicos

```powershell
.\start-all.ps1
```

Aguardar todos os servicos subirem:
- API Gateway: http://localhost:4000
- Validator: http://localhost:4001
- Signal: http://localhost:4002
- Executor: http://localhost:4003
- Frontend: http://localhost:3000

### 7.3 Testes Basicos

**1. Health Check**
```powershell
curl http://localhost:4000/health
```
Deve retornar: `{"status":"ok"}`

**2. Criar Usuario**
Acessar: http://localhost:3000/auth/register
Criar conta de teste

**3. Fazer Login**
Logar com usuario criado

**4. Testar Deposito**
- Conectar MetaMask
- Ir para /deposit
- Fazer deposito de teste (0.001 BNB)
- Aguardar confirmacao (3 blocos ~9 segundos)
- Verificar saldo atualizado

**5. Iniciar Bot**
- Ir para /bot
- Clicar "Iniciar bot"
- Verificar notifications aparecendo

**6. Testar Saque (NOVO!)**
- Ir para /withdraw (ou parar bot)
- Solicitar saque
- Verificar registro na tabela withdrawals

---

## 8. CHECKLIST FINAL

### Antes de fazer deploy em producao:

- [ ] .env atualizado com TODAS as mudancas listadas
- [ ] JWT_SECRET trocado (nao usar mesma senha do banco!)
- [ ] BOT_WALLET_PRIVATE_KEY encriptado e configurado
- [ ] BOT_DEPOSIT_ADDRESS configurado (.env backend + frontend)
- [ ] NODE_ENV=production
- [ ] FRONTEND_URL e BACKEND_URL apontando para URLs de producao
- [ ] CORS_ORIGIN configurado com URL do frontend
- [ ] Migrations aplicadas no Supabase
- [ ] Tabela withdrawals criada
- [ ] Dominio verificado no Resend (opcional)
- [ ] Testado localmente com sucesso
- [ ] Backup do banco de dados feito
- [ ] Seed phrase da wallet guardada em local seguro

### Configuracoes Opcionais (Recomendadas):

- [ ] Configurar monitoramento (Sentry)
- [ ] Configurar rate limiting customizado
- [ ] Configurar Redis para cache (melhor performance)
- [ ] Configurar CI/CD (GitHub Actions)

---

## PROXIMOS PASSOS

Apos completar este checklist:

1. **Deploy do Frontend** (Vercel)
   - Ver guia: `docs/DEPLOY_VERCEL.md` (se existir)
   - Ou seguir: [https://vercel.com/docs](https://vercel.com/docs)

2. **Deploy do Backend** (Render/Railway/Heroku)
   - Ver guia: `docs/DEPLOY_BACKEND.md` (se existir)

3. **Testar em Producao**
   - Com usuarios beta
   - Com valores pequenos primeiro

4. **Monitorar Logs**
   - Acompanhar em tempo real
   - Ajustar thresholds conforme necessario

---

## SUPORTE

Em caso de duvidas:
- Revisar documentacao em `docs/`
- Verificar logs dos servicos
- Consultar [README.md](../README.md)

**Sistema esta 100% PRONTO apos seguir este guia!**

---

**Criado**: 15 de Janeiro de 2026  
**Versao**: 1.0
