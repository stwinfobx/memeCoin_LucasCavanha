# TradingBot AI – Documentação Unificada

Sistema completo de trading automatizado para memecoins com validação de segurança, análise baseada em regras e execução automática de ordens. Este documento consolida todas as informações operacionais, guias de setup, diagnóstico e planejamento do projeto.

---

## 1. Visão Geral e Arquitetura

### Microserviços
- **API Gateway** (porta 4000) – Autenticação, roteamento e agregação.
- **Validator Service** (porta 4001) – Validação on-chain de tokens BSC.
- **Signal Service** (porta 4002) – IA baseada em regras, geração de sinais BUY/SELL/HOLD.
- **Executor Service** (porta 4003) – Execução de trades (simulação ou BSC Testnet).
- **Frontend** (porta 3000) – Interface Next.js futurista/minimalista.
- **PostgreSQL / Supabase** – Persistência (porta padrão 5433 local, ou conexão Supabase).

### Componentes Principais
- **Shared Types** (`shared/types`) – Interfaces TypeScript utilizadas por todos os serviços.
- **Infraestrutura** (`infra/`) – Docker Compose, schema SQL e manifests futuros.
- **Scripts** – Apenas `start-all.ps1` permanece, iniciando todos os serviços em janelas separadas.

---

## 2. Setup Rápido com Docker

### Pré-requisitos
- Docker + Docker Desktop
- Docker Compose
- `.env` na raiz (detalhes na seção 4)

### Passos
```powershell
# Na raiz do projeto
docker-compose -f infra/docker-compose.yml up -d
```

### Serviços Disponíveis
- API Gateway: http://localhost:4000/health
- Validator: http://localhost:4001/health
- Signal:    http://localhost:4002/health
- Executor:  http://localhost:4003/health
- Frontend:  http://localhost:3000

Para interromper:
```powershell
docker-compose -f infra/docker-compose.yml down
```

---

## 3. Setup Local (Sem Docker)

### Pré-requisitos
- Node.js 20+
- PostgreSQL 15+ (ou supabase connection string)
- Git

### Banco de Dados
```sql
CREATE DATABASE tradingbot;
CREATE USER botuser WITH PASSWORD 'botpass';
GRANT ALL PRIVILEGES ON DATABASE tradingbot TO botuser;
```

Aplicar schema:
```powershell
psql -U botuser -d tradingbot -f infra/postgres/schema.sql
```

### Instalação de Dependências
```powershell
# API Gateway
cd services/api-gateway
npm install
cd ../..

# Validator
cd services/validator
npm install
cd ../..

# Signal
cd services/signal
npm install
cd ../..

# Executor
cd services/executor
npm install
cd ../..

# Frontend
cd web/frontend
npm install
cd ../..
```

### Execução Manual
Abra cinco terminais e execute `npm run dev` em cada serviço (caminhos acima) ou utilize o script PowerShell abaixo.

### Script Único (`start-all.ps1`)
```powershell
# Na raiz do projeto
./start-all.ps1
```
O script detecta automaticamente o diretório raiz, carrega o `.env` global e abre uma janela separada para cada serviço.

### Kubernetes (Cloud-ready)

Os manifests de deploy estão em `infra/kubernetes/`. Para publicar no cluster:

1. Faça build das imagens e publique em um registry (`ghcr.io/sua-org/tradingbot-<servico>:tag`).
2. Edite `secret-example.yaml` com valores base64 reais (JWT, DATABASE_URL etc.) e aplique como `kubectl apply -f secret-example.yaml`. Mantenha o arquivo fora do versionamento quando contiver segredos verdadeiros.
3. Ajuste os hosts do `ingress.yaml` para o domínio pretendido e crie/import um certificado TLS (`tradingbot-tls`).
4. Aplique toda a stack com:
   ```bash
   kubectl apply -k infra/kubernetes
   ```
5. Configure DNS apontando para o controller (ou use `kubectl port-forward`) para validar.

---

## 4. Variáveis de Ambiente (Arquivo `.env` na Raiz)

Todos os serviços carregam automaticamente o arquivo `.env` localizado na raiz do projeto. Exemplo mínimo:

```env
# Database
POSTGRES_HOST=localhost
POSTGRES_PORT=5433
POSTGRES_USER=botuser
POSTGRES_PASSWORD=botpass
POSTGRES_DB=tradingbot
DATABASE_URL=postgresql://botuser:botpass@localhost:5433/tradingbot
DATABASE_DIRECT_URL=postgresql://botuser:botpass@localhost:5433/tradingbot
DATABASE_SHADOW_URL=postgresql://botuser:botpass@localhost:5433/tradingbot_shadow
POSTGRES_SSL=false

# JWT / Auth
JWT_SECRET=seu_jwt_secret_super_seguro_aqui_123456789
JWT_EXPIRATION=1h
REFRESH_TOKEN_EXPIRATION=7d

# Encryption / Bot
ENCRYPTION_KEY=9b1de1a7d6f4c5a8e2b7f9a1d3e4f8c9
BOT_EXECUTION_MODE=simulation
BOT_RISK_LEVEL=medium

# Blockchain (BSC Testnet)
BSC_RPC_URL=https://data-seed-prebsc-1-s1.binance.org:8545/
BSC_TESTNET_RPC=https://data-seed-prebsc-1-s1.binance.org:8545/
BSCSCAN_API_KEY=
PANCAKESWAP_ROUTER=0xD99D1c33F9fC3444f8101754aBC46c52416550D1
WBNB_ADDRESS=0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd

# Serviços
VALIDATOR_SERVICE_URL=http://localhost:4001
SIGNAL_SERVICE_URL=http://localhost:4002
EXECUTOR_SERVICE_URL=http://localhost:4003

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:4000
CORS_ORIGIN=http://localhost:3000
```

### Uso com Supabase

Para apontar todo o ecossistema para o banco gerenciado do Supabase:

1. No painel da Supabase, copie a string de conexão (URI) com SSL habilitado.
2. No `.env` raiz, defina:
   ```env
   DATABASE_URL=postgresql://<user>:<password>@db.<ref>.supabase.co:5432/postgres?sslmode=require
   DATABASE_DIRECT_URL=postgresql://<user>:<password>@db.<ref>.supabase.co:5432/postgres?sslmode=require
   DATABASE_SHADOW_URL=postgresql://<user>:<password>@db.<ref>.supabase.co:5432/postgres_shadow?sslmode=require
   POSTGRES_SSL=true
   ```
3. Todos os microserviços reconhecem automaticamente `DATABASE_URL` e ativam SSL (`rejectUnauthorized=false`).
4. Para gerar o client Prisma acoplado ao Supabase:
   ```powershell
   cd services/api-gateway
   npm install
   npm run prisma:generate
   ```
5. Recomenda-se criar um banco “shadow” próprio para migrações Prisma, evitando alterações no banco primário.

---

## 5. Endpoints Principais da API

### Autenticação
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`

### Validação (Validator Service)
- `POST /validate`
- `GET /validated-tokens`
- `GET /risk/:contractAddress`

### Tokens (API Gateway)
- `GET /api/tokens`
- `GET /api/tokens/:contractAddress`

### Sinais (Signal Service)
- `POST /analyze`
- `GET /signals/active`

### Execução (Executor Service)
- `POST /execute/buy`
- `POST /execute/sell`
- `GET /positions`

---

## 6. Segurança
- JWT para autenticação entre serviços.
- Bcrypt para hash de senhas.
- Criptografia AES-256 para chaves privadas.
- Rate limiting e CORS configurados no API Gateway.
- Validação de input com Zod.

---

## 7. Banco de Dados
Tabelas principais: `users`, `user_profiles`, `tokens`, `signals`, `orders`, `ledger_entries`, `audit_logs`. Views auxiliares: `open_positions`, `user_performance`. Triggers mantêm `updated_at` em sincronia.

---

## 8. Validação e Análise de Risco
- Ingestão contínua via GeckoTerminal (pools trending/volume da rede BSC) com fallback automático e filtro heurístico para memecoins.
- Consulta a BscScan/Etherscan para obter idade do contrato e concentração dos principais holders.
- Heurísticas anti-golpe: honeypot, liquidez bloqueada, número de holders, idade do par, volatilidade e distribuição.
- Motor probabilístico (`token_risk_assessments`) gera:
  - `memecoin_score` (0-100) — aderência ao perfil memecoin.
  - `risk_score` (0-100) — quanto maior, mais seguro.
  - `scam_probability` (0-100) — probabilidade de rugpull.
  - `risk_level` (`critical`, `high`, `moderate`, `low`) com indicadores detalhados (JSON).
- Resultados expostos via API Gateway (`GET /api/tokens`) e pelo próprio serviço Validator (`GET /risk/:contractAddress`).

---

## 9. IA de Sinais
Sistema baseado em regras que avalia:
- Volume 24h (30%)
- Liquidez (25%)
- Número de holders (20%)
- Idade do token (15%)
- Score de segurança (10%)

Gera sinais BUY/SELL/HOLD com confiança e potencial multiplicador (até 5x).

---

## 10. Execução de Trades
- Modos: `simulation` (padrão) e `live` (BSC Testnet).
- Perfis de risco: Conservador (1%), Moderado (3%), Agressivo (6%).
- Integração com PancakeSwap Router Testnet.
- Ledger registra transações simuladas ou reais.

---

## 11. Diagnóstico e Troubleshooting

### Erro 500 ao Registrar Usuário
1. **Confirme banco ativo**
   ```powershell
   docker ps | findstr postgres
   Get-Service | Where-Object { $_.Name -like '*postgres*' }
   ```
2. **Cheque tabelas**
   ```sql
   \dt
   SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
   ```
3. **Verifique variáveis** – o arquivo `.env` raiz deve conter as chaves do banco e JWT.
4. **Logs de inicialização**
   - Esperado: `✅ Database connected successfully`.
   - Se houver `❌ Database connection error`, revise as credenciais.
5. **Criar/ajustar banco manualmente** (ver seção 3).
6. **Aplicar schema manualmente**
   ```powershell
   psql -U botuser -d tradingbot -f infra/postgres/schema.sql
   ```
7. **Teste direto**
   ```powershell
   cd services/api-gateway
   node -e "const {pool} = require('./dist/config/database'); pool.query('SELECT NOW()').then(() => console.log('OK')).catch(e => console.error(e)).finally(() => process.exit())"
   ```

### Conflito de Porta 5432
- O projeto usa **5433** como padrão local para evitar conflitos com outros PostgreSQL.
- Ajustes já aplicados em `infra/docker-compose.yml` e no código.
- Para confirmar:
  ```powershell
  netstat -ano | findstr ':5433'
  ```
- Se precisar usar outra porta, edite o `.env` global (`POSTGRES_PORT`) e reinicie os serviços.

---

## 12. Tecnologias
- **Backend**: Node.js, Express, TypeScript
- **Blockchain**: ethers.js, web3.js
- **Database**: PostgreSQL / Supabase, Prisma (schema pronto)
- **Frontend**: Next.js 14, React, Tailwind CSS
- **Infraestrutura**: Docker, Docker Compose, scripts PowerShell
- **IA (MVP)**: sistema baseado em regras

---

## 13. Plano de Implementação MVP

### Estrutura do Monorepo
```
/services
  ├── api-gateway/
  ├── validator/
  ├── signal/
  └── executor/
/web
  └── frontend/
/infra
  ├── docker-compose.yml
  └── postgres/
/shared
  └── types/
```

### Metas por Fase
1. **Ingestão + Validação** – detectar memecoins e aplicar checagens anti-golpe.
2. **IA de Sinais** – gerar sinais e estimar multiplicadores.
3. **Executor** – comprar/segurar/vender em tempo real (testnet).
4. **Backend/API Gateway** – autenticação, orquestração e documentação.
5. **Frontend Futurista** – UI minimalista nas cores roxo/branco/preto.

### To-dos de Referência
- [ ] Estrutura do monorepo
- [ ] Schema PostgreSQL/Supabase
- [ ] Docker Compose completo
- [ ] API Gateway + autenticação JWT
- [ ] Validator com integração BSC Testnet
- [ ] Signal Service com regras
- [ ] Executor com PancakeSwap Testnet
- [ ] Frontend (login/registro/dashboard/perfil)
- [ ] Configurações cloud-ready (Kubernetes, Supabase, documentação final)

---

## 14. Licença e Contribuição
- Licença: **MIT**
- Contribuições e pull requests são bem-vindos.

---

## 15. Contato e Suporte
Para dúvidas ou problemas, consulte a seção 10 (Diagnóstico) e abra uma issue descrevendo o contexto, logs e passos realizados.


