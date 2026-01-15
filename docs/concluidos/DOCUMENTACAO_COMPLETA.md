# 📚 Trading Bot - Documentação Técnica Completa

> **Análise Completa do Sistema de Trading Automatizado de mem**ecoins**  
> **Data**: Dezembro 2025  
> **Versão**: 1.0

---

## 🎯 Sumário Executivo

Este documento apresenta uma análise completa e detalhada do sistema TradingBot AI, um ecossistema distribuído especializado em trading automatizado de memecoins. O sistema utiliza arquitetura de microsserviços, validação de segurança on-chain, análise baseada em regras e execução automática de ordens.

### Características Principais
- **Arquitetura**: 4 microsserviços (API Gateway, Validator, Signal, Executor) + Frontend Next.js
- **Blockchain**: Suporte a BSC, Ethereum, Arbitrum, Polygon (preparado para Solana)
- **Modo de Operação**: Paper trading (simulação) e preparado para execução real
- **Banco de Dados**: PostgreSQL/Supabase com schema completo e otimizado
- **Validação**: Análise de risco multi-dimensional com scoring probabilístico
- **IA**: Sistema baseado em regras com detecção automática de memecoins

---

## 📐 Arquitetura do Sistema

### Visão Geral dos Microsserviços

```mermaid
graph TB
    Frontend[Frontend Next.js :3000]
    Gateway[API Gateway :4000]
    Validator[Validator Service :4001]
    Signal[Signal Service :4002]
    Executor[Executor Service :4003]
    DB[(PostgreSQL/Supabase)]
    Gecko[GeckoTerminal API]
    BSC[BSC/ETH RPC]
    
    Frontend -->|HTTP/WS| Gateway
    Gateway -->|HTTP| Validator
    Gateway -->|HTTP| Signal
    Gateway -->|HTTP| Executor
    Validator -->|Validate+Risk| DB
    Signal -->|Generate| DB
    Executor -->|Execute| DB
    Validator -->|Query| Gecko
    Validator -->|On-chain| BSC
    Gateway -.->|WebSocket| Frontend
```

### 1. **API Gateway** (porta 4000)

**Responsabilidades:**
- Autenticação JWT
- Roteamento e agregação de requisições
- Rate limiting (200 req/15min por IP)
- WebSocket para atualizações em tempo real
- CORS e segurança (Helmet)

**Rotas Principais:**
- `/api/auth` - Registro, login, recuperação de senha
- `/api/tokens` - Listagem e detalhes de tokens validados
- `/api/signals` - Sinais BUY/SELL/HOLD ativos
- `/api/positions` - Posições abertas do usuário
- `/api/bot` - Configurações do bot
- `/api/dashboard` - Métricas e performance
- `/ws/prices` - WebSocket de preços em tempo real

**Tecnologias:**
- Express.js + TypeScript
- PostgreSQL (pool de conexões)
- Rate limiting, Helmet, CORS
- WebSocket (ws library)

---

### 2. **Validator Service** (porta 4001)

**Responsabilidades:**
- Ingestão contínua de tokens via GeckoTerminal API
- Validação on-chain (honeypot, liquidez, holders)
- Scoring de risco multi-dimensional
- Integração com exploradores de blockchain (BSCScan, Etherscan)

**Fluxo de Validação:**

```mermaid
sequenceDiagram
    participant I as Ingestion
    participant V as Validator
    participant E as Explorer
    participant G as GeckoTerminal
    participant DB as Database
    participant S as Signal Service
    
    I->>G: GET /networks/bsc/pools/trending
    G-->>I: Lista de pools
    I->>V: validateToken(address, chain)
    V->>E: getContractCreation(address)
    V->>E: getTopHolders(address)
    V->>G: getMarketData(address)
    G-->>V: Liquidez, Volume, Preço
    V->>V: computeRiskAssessment()
    V->>DB: saveToken() + saveRiskAssessment()
    V->>S: POST /analyze (trigger signal)
    S-->>V: Signal criado
```

**Heurísticas Anti-Golpe:**
1. **Honeypot Detection**: Simula transfer para detectar tokens não vendáveis
2. **Liquidez Bloqueada**: Verifica se LP está locked
3. **Concentração de Holders**: Analisa distribuição dos top 10 holders
4. **Idade do Contrato**: Tokens muito novos (\u003c24h) recebem penalidade
5. **Volume/Liquidez**: Relações anormais indicam risco
6. **Volatilidade**: Variações \u003e50% em curto período são suspeitas

**Scoring de Risco:**
- `memecoin_score` (0-100): Aderência ao perfil de memecoin
- `risk_score` (0-100): Quanto maior, mais seguro
- `scam_probability` (0-100): Probabilidade de rugpull
- `risk_level`: `critical`, `high`, `moderate`, `low`

**Arquivo-chave:** `services/validator/src/validator.ts` (594 linhas)

---

### 3. **Signal Service** (porta 4002)

**Responsabilidades:**
- Análise baseada em regras para geração de sinais
- Detecção automática de memecoins
- Cálculo de confidence score e multiplicador potencial
- Prevenção de sinais duplicados

**Sistema de Scoring:**

| Métrica | Peso | Cálculo |
|---------|------|---------|
| Volume 24h | 30% | Faixas: \$1k (20%), \$5k (40%), \$10k (60%), \$50k (80%), \$50k+ (100%) |
| Liquidez | 25% | Faixas: \$1k (20%), \$5k (40%), \$10k (60%), \$50k (80%), \$50k+ (100%) |
| Holders | 20% | Faixas: 50 (20%), 100 (40%), 500 (60%), 1000 (80%), 1000+ (100%) |
| Idade do Token | 15% | \u003c1d (30%), \u003c7d (50%), \u003c30d (70%), \u003c90d (90%), 90d+ (100%) |
| Safety Score | 10% | Normalizado 0-1 |

**Detecção de Memecoins:**
Critérios (pelo menos 3 de 4):
1. Volume/Liquidez \u003e 5 (alta volatilidade)
2. Holders \u003e 500
3. Idade \u003c 30 dias
4. Volume 24h \u003e \$50k

**Thresholds Adaptativos:**
- **BUY**: Tokens normais: 0.55 | Memecoins: 0.50 (mais permissivo)
- **SELL**: Tokens normais: 0.25 | Memecoins: 0.30 (mais conservador)
- **HOLD**: Entre SELL e BUY thresholds

**Multiplicador Potencial:**
- **BUY**: 1.1x - 5.0x (memecoins ganham 20% extra)
- **SELL**: 0.4x - 0.9x
- **HOLD**: 0.8x - 1.5x

**Arquivo-chave:** `services/signal/src/analyzer.ts` (413 linhas)

---

### 4. **Executor Service** (porta 4003)

**Responsabilidades:**
- Execução de ordens BUY/SELL (simuladas ou reais)
- Monitoramento contínuo de posições abertas
- Aplicação de estratégias de stop-loss e take-profit
- Gerenciamento de saldo e ledger

**Estratégias de Trading:**

#### **A. Tempo Máximo de Hold**
```
┌─────────────────────────────────────────┐
│ PRIORIDADE MÁXIMA: 10 minutos           │
│ └─ Vende SEMPRE após 10min              │
│ └─ Exceto se lucro \u003e 1% (pode até 30min) │
└─────────────────────────────────────────┘
```

#### **B. Stop-Loss (Proteção de Capital)**

| Tipo | Tempo | Perda | Ação |
|------|-------|-------|------|
| **Absoluto** | Qualquer | \u003e max_loss_percent (10%) | Vende imediatamente |
| **Crítico** | 3 min | -2.0% | Vende |
| **Preventivo** | 5 min | -1.0% | Vende |
| **Ultra-Preventivo** | 10 min | -0.5% | Vende |

#### **C. Take-Profit (Realização de Lucros)**

| Tipo | Tempo | Lucro | Ação |
|------|-------|-------|------|
| **Target Absoluto** | Qualquer | \u003e max_gain_percent (25%) | Vende |
| **Ultra-Rápido** | 2-5 min | +0.5% | Vende |
| **Rápido** | 5-10 min | +0.3% | Vende |
| **Moderado** | 10-30 min | +0.2% | Vende (se lucro \u003c 1%) |
| **Inteligente** | Qualquer | 30% do multiplicador potencial | Vende |

#### **D. Venda por Inatividade**
- **Condição**: Após 5 minutos com variação \u003c 1% E sinal HOLD
- **Ação**: Vende para liberar capital

**Perfis de Risco:**

| Perfil | % do Saldo/Trade | Max Loss | Max Gain | Max Trades |
|--------|------------------|----------|----------|------------|
| Conservative | 1% | 10% | 25% | 3 |
| Moderate | 3% | 10% | 25% | 5 |
| Aggressive | 6% | 10% | 25% | 10 |

**Monitoramento:**
- Intervalo: 30 segundos
- Verificações: Preço atual, tempo de hold, sinais ativos
- Auto-execução: Sim (para default user em paper trading)

**Arquivo-chave:** `services/executor/src/trader.ts` (1979 linhas!)

---

### 5. **Frontend** (porta 3000)

**Tecnologias:**
- Next.js 14 (App Router)
- React
- Tailwind CSS
- Tema: Roxo/Branco/Preto (futurista/minimalista)

**Páginas Principais:**
- `/` - Landing page
- `/login` - autenticação
- ` /register` - Registro
- `/dashboard` - Visão geral de performance
- `/signals` - Sinais BUY/SELL/HOLD em tempo real
- `/positions` - Posições abertas e histórico
- `/profile` - Configurações de perfil e risco

**Recursos:**
- WebSocket para updates em tempo real
- Notificações de ordens executadas
- Gráficos de performance
- Histórico de trades

---

## 🗄️ Banco de Dados - Schema Completo

### Tabelas Principais

#### **1. `users`**
Armazena informações de autenticação dos usuários.

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    mfa_enabled BOOLEAN DEFAULT false,
    mfa_secret VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Índices**: `email`, `is_active`

---

#### **2. `user_profiles`**
Perfil de risco e configurações do bot por usuário.

```sql
CREATE TABLE user_profiles (
    id UUID PRIMARY KEY,
    user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    full_name VARCHAR(255),
    phone VARCHAR(50),
    wallet_address VARCHAR(255),
    risk_profile VARCHAR(20) DEFAULT 'moderate' 
        CHECK (risk_profile IN ('conservative', 'moderate', 'aggressive')),
    bot_enabled BOOLEAN DEFAULT false,
    bot_intensity INTEGER DEFAULT 5 CHECK (bot_intensity BETWEEN 1 AND 10),
    max_loss_percent DECIMAL(5,2) DEFAULT 10.00,
    max_gain_percent DECIMAL(5,2) DEFAULT 25.00,
    max_open_trades INTEGER DEFAULT 3,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

**Índices**: `user_id`, `risk_profile`

---

#### **3. `tokens`**
Todos os tokens validados e seus dados de mercado.

```sql
CREATE TABLE tokens (
    id UUID PRIMARY KEY,
    contract_address VARCHAR(255) UNIQUE NOT NULL,
    chain VARCHAR(50) DEFAULT 'BSC' NOT NULL,
    symbol VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    decimals INTEGER DEFAULT 18,
    total_supply NUMERIC(78, 0),
    liquidity_usd DECIMAL(20, 2),
    liquidity_locked BOOLEAN DEFAULT false,
    holders_count INTEGER DEFAULT 0,
    volume_24h_usd DECIMAL(20, 2) DEFAULT 0,
    price_usd DECIMAL(20, 10),
    safety_score INTEGER CHECK (safety_score BETWEEN 0 AND 100),
    is_honeypot BOOLEAN DEFAULT false,
    is_validated BOOLEAN DEFAULT false,
    validated_at TIMESTAMP,
    first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

**Índices**: `contract_address`, `chain`, `is_validated`, `safety_score DESC`

---

#### **4. `token_risk_assessments`**
Avaliação de risco multi-dimensional de cada token.

```sql
CREATE TABLE token_risk_assessments (
    id UUID PRIMARY KEY,
    token_id UUID UNIQUE REFERENCES tokens(id) ON DELETE CASCADE,
    contract_address VARCHAR(255) NOT NULL,
    chain VARCHAR(50) NOT NULL,
    memecoin_score DECIMAL(5,2) NOT NULL,    -- 0-100
    risk_score DECIMAL(5,2) NOT NULL,        -- 0-100 (maior = mais seguro)
    scam_probability DECIMAL(5,2) NOT NULL,  -- 0-100
    risk_level VARCHAR(32) NOT NULL,         -- critical/high/moderate/low
    indicators JSONB NOT NULL,               -- Detalhes dos indicadores
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

**Índices**: `token_id` (unique), `(contract_address, chain)`

---

#### **5. `signals`**
Sinais gerados pela IA (BUY/SELL/HOLD).

```sql
CREATE TABLE signals (
    id UUID PRIMARY KEY,
    token_id UUID REFERENCES tokens(id) ON DELETE CASCADE,
    signal_type VARCHAR(10) CHECK (signal_type IN ('BUY', 'SELL', 'HOLD')),
    confidence_score DECIMAL(5,2) CHECK (confidence_score BETWEEN 0 AND 100),
    potential_multiplier DECIMAL(4,2),
    volume_score DECIMAL(5,2),
    liquidity_score DECIMAL(5,2),
    holders_score DECIMAL(5,2),
    age_score DECIMAL(5,2),
    safety_score DECIMAL(5,2),
    overall_score DECIMAL(5,2),
    price_at_signal DECIMAL(20, 10),
    reasoning TEXT,
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMP,
    created_at TIMESTAMP
);
```

**Índices**: `token_id`, `signal_type`, `is_active` (partial), `created_at DESC`

---

#### **6. `orders`**
Todas as ordens de compra e venda executadas.

```sql
CREATE TABLE orders (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_id UUID REFERENCES tokens(id) ON DELETE CASCADE,
    signal_id UUID REFERENCES signals(id),
    order_type VARCHAR(10) CHECK (order_type IN ('BUY', 'SELL')),
    status VARCHAR(20) DEFAULT 'pending' 
        CHECK (status IN ('pending', 'executing', 'completed', 'failed', 'cancelled')),
    amount_usd DECIMAL(20, 2) NOT NULL,
    amount_token DECIMAL(40, 18),
    price_usd DECIMAL(20, 10),
    transaction_hash VARCHAR(255),
    executed_at TIMESTAMP,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

**Índices**: `user_id`, `token_id`, `status`, `order_type`, `created_at DESC`

---

#### **7. `ledger_entries`**
Registro contábil de todas as transações (depósitos, retiradas, lucros, perdas).

```sql
CREATE TABLE ledger_entries (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    order_id UUID REFERENCES orders(id),
    entry_type VARCHAR(20) CHECK (entry_type IN 
        ('deposit', 'withdrawal', 'trade_profit', 'trade_loss', 'fee', 'gas')),
    amount_usd DECIMAL(20, 2) NOT NULL,
    balance_before DECIMAL(20, 2),
    balance_after DECIMAL(20, 2),
    description TEXT,
    created_at TIMESTAMP
);
```

**Índices**: `user_id`, `order_id`, `entry_type`, `created_at DESC`

---

#### **8. `audit_logs`**
Auditoria completa de ações do sistema.

```sql
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id UUID,
    ip_address VARCHAR(45),
    user_agent TEXT,
    request_data JSONB,
    response_data JSONB,
    status_code INTEGER,
    error_message TEXT,
    created_at TIMESTAMP
);
```

**Índices**: `user_id`, `action`, `(resource_type, resource_id)`, `created_at DESC`

---

### Views Úteis

#### **`open_positions`**
Posições abertas por usuário com cálculo de lucro/perda.

```sql
CREATE OR REPLACE VIEW open_positions AS
SELECT 
    o.user_id,
    o.token_id,
    t.symbol,
    t.name,
    SUM(CASE WHEN o.order_type = 'BUY' THEN o.amount_usd ELSE -o.amount_usd END) as invested_usd,
    SUM(CASE WHEN o.order_type = 'BUY' THEN o.amount_token ELSE -o.amount_token END) as token_balance,
    AVG(CASE WHEN o.order_type = 'BUY' THEN o.price_usd END) as avg_buy_price,
    t.price_usd as current_price,
    COUNT(*) as trade_count
FROM orders o
JOIN tokens t ON o.token_id = t.id
WHERE o.status = 'completed'
GROUP BY o.user_id, o.token_id, t.symbol, t.name, t.price_usd
HAVING SUM(CASE WHEN o.order_type = 'BUY' THEN o.amount_token ELSE -o.amount_token END) \u003e 0;
```

#### **`user_performance`**
Performance consolidada de cada usuário.

```sql
CREATE OR REPLACE VIEW user_performance AS
SELECT 
    u.id as user_id,
    u.email,
    COALESCE(SUM(CASE WHEN le.entry_type IN ('trade_profit', 'deposit') THEN le.amount_usd ELSE 0 END), 0) as total_deposits,
    COALESCE(SUM(CASE WHEN le.entry_type = 'trade_profit' THEN le.amount_usd ELSE 0 END), 0) as total_profit,
    COALESCE(SUM(CASE WHEN le.entry_type = 'trade_loss' THEN le.amount_usd ELSE 0 END), 0) as total_loss,
    COUNT(DISTINCT o.id) as total_trades,
    COUNT(DISTINCT CASE WHEN o.status = 'completed' THEN o.id END) as completed_trades
FROM users u
LEFT JOIN ledger_entries le ON u.id = le.user_id
LEFT JOIN orders o ON u.id = o.user_id
GROUP BY u.id, u.email;
```

---

### Triggers

**`update_updated_at_column()`**
Atualiza automaticamente o campo `updated_at` nas tabelas: `users`, `user_profiles`, `tokens`, `orders`, `token_risk_assessments`.

---

## ⚙️ Configurações e Variáveis de Ambiente

### Arquivo `.env` (Raiz do Projeto)

```env
# ========================================
# DATABASE
# ========================================
POSTGRES_HOST=localhost
POSTGRES_PORT=5433
POSTGRES_USER=botuser
POSTGRES_PASSWORD=botpass
POSTGRES_DB=tradingbot
DATABASE_URL=postgresql://botuser:botpass@localhost:5433/tradingbot
POSTGRES_SSL=false

# ========================================
# AUTHENTICATION
# ========================================
JWT_SECRET=seu_jwt_secret_super_seguro_aqui
JWT_EXPIRATION=1h
REFRESH_TOKEN_EXPIRATION=7d
ENCRYPTION_KEY=9b1de1a7d6f4c5a8e2b7f9a1d3e4f8c9

# ========================================
# BOT CONFIGURATION
# ========================================
BOT_EXECUTION_MODE=simulation     # simulation | live
BOT_RISK_LEVEL=medium            # low | medium | high
MONITOR_INTERVAL_SECONDS=30     # Intervalo de monitoramento

# ========================================
# BLOCKCHAIN - BSC
# ========================================
BSC_RPC_URL=https://data-seed-prebsc-1-s1.binance.org:8545/
BSC_TESTNET_RPC=https://data-seed-prebsc-1-s1.binance.org:8545/
BSCSCAN_API_KEY=
PANCAKESWAP_ROUTER=0xD99D1c33F9fC3444f8101754aBC46c52416550D1
WBNB_ADDRESS=0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd

# ========================================
# SERVICES
# ========================================
VALIDATOR_SERVICE_URL=http://localhost:4001
SIGNAL_SERVICE_URL=http://localhost:4002
EXECUTOR_SERVICE_URL=http://localhost:4003

# ========================================
# FRONTEND
# ========================================
NEXT_PUBLIC_API_URL=http://localhost:4000
CORS_ORIGIN=http://localhost:3000
```

---

## 🔄 Fluxos de Operação

### Fluxo 1: Ingestão e Validação de Token

```
1. Ingestion Service (Validator)
   ├─ Consulta GeckoTerminal /networks/bsc/pools/trending
   ├─ Filtra pools com liquidez \u003e \$5k e volume \u003e \$1k
   └─ Para cada pool:
       ├─ validateToken(contractAddress, 'BSC')
       ├─ Consulta on-chain (RPC): symbol, name, decimals, totalSupply
       ├─ checkHoneypot() - Tenta simulação de transfer
       ├─ checkLiquidityLocked() - Verifica via BSCScan
       ├─ getMarketData() - GeckoTerminal API
       ├─ ExplorerClient.getContractCreation() - Idade do contrato
       ├─ ExplorerClient.getTopHolders() - Concentração de holders
       ├─ computeRiskAssessment() - Calcula scores
       ├─ saveToken() - Persiste no DB
       ├─ saveRiskAssessment() - Persiste risk assessment
       └─ triggerSignalGeneration() - POST /analyze no Signal Service
```

### Fluxo 2: Geração de Sinal

```
2. Signal Service
   ├─ Recebe POST /analyze com token_id
   ├─ Busca token e risk_assessment do DB
   ├─ calculateVolumeScore() - Score baseado em volume 24h
   ├─ calculateLiquidityScore() - Score baseado em liquidez
   ├─ calculateHoldersScore() - Score baseado em quantidade de holders
   ├─ calculateAgeScore() - Score baseado na idade do token
   ├─ Calculate overallScore = 
   │   volume*0.30 + liquidity*0.25 + holders*0.20 + age*0.15 + safety*0.10
   ├─ isMemecoin() - Detecta se é memecoin (4 critérios)
   ├─ Determina signal_type:
   │   ├─ BUY se overallScore \u003e= 0.55 (0.50 para memecoins) E !honeypot
   │   ├─ SELL se overallScore \u003c 0.25 (0.30 para memecoins) OU honeypot
   │   └─ HOLD caso contrário
   ├─ Calculate confidence_score (30%-95%)
   ├─ Calculate potential_multiplier (0.4x - 5.0x)
   ├─ Verifica se sinal anterior é duplicado (evita spam)
   └─ saveSignal() ou updateSignal() - Persiste no DB
```

### Fluxo 3: Execução de Ordem BUY

```
3. Executor Service (Auto-Trade)
   ├─ Monitoramento a cada 30 segundos
   ├─ Busca sinais ativos com signal_type = 'BUY'
   ├─ Para cada sinal BUY:
   │   ├─ Verifica se usuário tem saldo disponível
   │   ├─ Verifica se não excede max_open_trades
   │   ├─ calculateIntendedInvestment():
   │   │   ├─ baseAmount = saldo * perfil_risco (1%, 3%, 6%)
   │   │   ├─ confidenceFactor = confidence_score / 50
   │   │   ├─ multiplierFactor = potential_multiplier * 0.4
   │   │   └─ investAmount = baseAmount * confidenceFactor * multiplierFactor
   │   ├─ createOrder(type='BUY', amount=investAmount)
   │   ├─ simulateBuy():
   │   │   ├─ Calcula amount_token = investAmount / price
   │   │   ├─ Gera transaction_hash simulado
   │   │   └─ Atualiza ordem status='completed'
   │   └─ createOrUpdatePosition():
   │       ├─ Cria ou atualiza posição na tabela positions
   │       └─ Registra invested_amount_usd, buy_price, buy_time
```

### Fluxo 4: Monitoramento e Venda

```
4. Executor Service (Monitor Loop)
   ├─ A cada 30 segundos:
   ├─ Busca posições abertas (status='open')
   ├─ Para cada posição:
   │   ├─ Busca token atualizado (preço atual)
   │   ├─ Busca sinal ativo do token
   │   ├─ Calcula holdTimeMinutes = (now - buy_time) / 60000
   │   ├─ Calcula gainPercent = (currentPrice / buyPrice - 1) * 100
   │   ├─ shouldSellPosition():
   │   │   ├─ **PRIORIDADE MÁXIMA**: holdTime \u003e= 10 min → VENDE
   │   │   ├─ **STOP-LOSS ABSOLUTO**: lossPercent \u003e= max_loss_percent → VENDE
   │   │   ├─ **STOP-LOSS CRÍTICO**: holdTime \u003e= 3min E loss \u003e= 2% → VENDE
   │   │   ├─ **STOP-LOSS PREVENTIVO**: holdTime \u003e= 5min E loss \u003e= 1% → VENDE
   │   │   ├─ **TAKE-PROFIT ABSOLUTO**: gainPercent \u003e= max_gain_percent → VENDE
   │   │   ├─ **VENDA ULTRA-RÁPIDA**: holdTime 2-5min E gain \u003e= 0.5% → VENDE
   │   │   ├─ **VENDA RÁPIDA**: holdTime 5-10min E gain \u003e= 0.3% → VENDE
   │   │   ├─ **SINAL SELL**: signal_type = 'SELL' → VENDE
   │   │   └─ **INATIVIDADE**: holdTime \u003e= 5min E variação \u003c 1% E HOLD → VENDE
   │   ├─ Se shouldSell = true:
   │   │   ├─ createOrder(type='SELL', amount_token=positionBalance)
   │   │   ├─ simulateSell():
   │   │   │   ├─ Calcula amount_usd = amount_token * currentPrice
   │   │   │   ├─ Calcula profit_loss_usd = amount_usd - invested_amount
   │   │   │   ├─ Calcula profit_loss_percent = (profit_loss / invested) * 100
   │   │   │   ├─ Atualiza ordem com profit/loss
   │   │   │   └─ Registra ledger_entry(type='trade_profit')
   │   │   └─ createOrUpdatePosition(action='sell'):
   │   │       ├─ Atualiza posição: status='closed', profit_loss, hold_time
   │   │       └─ Cria notificação de posição fechada
```

---

## 📊 Métricas e Performance Esperada

### Configuração Atual (Otimizada para Win Rate 35-45%)

| Métrica | Valor Esperado |
|---------|---------------|
| **Win Rate** | 35% - 45% |
| **Tempo Médio de Hold** | 5 - 10 minutos |
| **Trades em 30 min** | 3 - 6 trades |
| **Lucro Médio por Trade Vencedor** | +0.6% a +0.8% |
| **Perda Média por Trade Perdedor** | -1.0% a -1.2% |
| **Resultado Líquido** | Break-even ou ligeiramente positivo |

### Monitoramento em Tempo Real

O sistema registra:
- Total de trades (completed_trades)
- Total de lucro (SUM profit_loss WHERE \u003e 0)
- Total de perda (SUM profit_loss WHERE \u003c 0)
- Saldo atual (depósitos + lucros - perdas - investido em posições)
- Posições abertas (invested_amount, current_value, unrealized_pnl)

---

## 📝 Resumo dos Arquivos-Chave

| Arquivo | Linhas | Descrição |
|---------|--------|-----------|
| `services/api-gateway/src/server.ts` | 228 | Servidor principal, rotas, WebSocket |
| `services/validator/src/server.ts` | 327 | API do validador, ingestão contínua |
| `services/validator/src/validator.ts` | 594 | Lógica de validação on-chain e risco |
| `services/validator/src/risk-scoring.ts` | ~250 | Cálculo de risk_score, memecoin_score |
| `services/validator/src/ingestion.ts` | ~400 | Ingestão GeckoTerminal |
| `services/signal/src/analyzer.ts` | 413 | IA baseada em regras, scoring |
| `services/signal/src/server.ts` | ~200 | API do signal service |
| `services/executor/src/trader.ts` | **1979** | Toda lógica de trading (BUY/SELL, stop-loss, take-profit) |
| `services/executor/src/server.ts` | ~300 | API do executor, monitor loop |
| `infra/postgres/schema.sql` | 263 | Schema completo do banco |
| `web/frontend/app/**` | Múltiplos | Páginas e componentes Next.js |

---

**FIM DA PARTE 1**  
Próximos arquivos: `GAPS_E_MELHORIAS.md`, `ROADMAP_FUTURO.md`, `DATABASE_GUIDE.md`
