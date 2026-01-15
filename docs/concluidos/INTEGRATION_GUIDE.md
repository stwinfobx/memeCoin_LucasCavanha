# 🔧 Guia de Integração - TradingBot AI

> **Status**: Módulos P0+P1 criados, integrações em andamento  
> **Data**: 13 de Janeiro de 2026

---

## ✅ O Que Já Foi Integrado

### 1. Signal Service
- ✅ PriceCollector iniciado automaticamente (1min interval)
- ✅ Coleta histórico OHLCV para análise técnica

### 2. API Gateway  
- ✅ Rotas de health (`/api/health/*`)
- ✅ Rotas de wallet (`/api/wallet/*`)
- ✅ Email service integrado no auth

### 3. Database
- ✅ Migrations aplicadas (wallets, deposits, candles)
- ✅ Índices otimizados criados

---

## ⏳ Integrações Pendentes (Fazer Manualmente)

### 1. Trader.ts - Adicionar TradingStrategy

**Arquivo**: `services/executor/src/trader.ts`

**Adicionar no topo**:
```typescript
import { TradingStrategyManager } from './strategies/trading-strategy';
```

**No construtor** (linha ~24):
```typescript
export class TradeExecutor {
  private pool: Pool;
  private executionMode: 'simulation';
  private defaultUserId: string;
  private strategyManager: TradingStrategyManager; // ADICIONAR

  constructor(pool: Pool) {
    this.pool = pool;
    this.executionMode = 'simulation';
    this.defaultUserId = process.env.EXECUTOR_DEFAULT_USER_ID || 'xxx';
    this.strategyManager = new TradingStrategyManager(pool); // ADICIONAR
  }
```

**No método `executeBuy`** (antes de criar ordem, linha ~618):
```typescript
async executeBuy(request: ExecuteOrderRequest, userId: string): Promise<Order> {
  const tokenResult = await this.pool.query('SELECT * FROM tokens WHERE id = $1', [request.token_id]);
  if (tokenResult.rowCount === 0) throw new Error('Token not found');
  const token = tokenResult.rows[0] as Token;

  // ADICIONAR: Verificar estratégia antes de comprar
  if (request.signal_id) {
    const signalResult = await this.pool.query('SELECT * FROM signals WHERE id = $1', [request.signal_id]);
    const signal = signalResult.rows[0];
    
    const riskResult = await this.pool.query(
      'SELECT memecoin_score, risk_score, scam_probability FROM token_risk_assessments WHERE token_id = $1',
      [request.token_id]
    );
    const validation = riskResult.rows[0];

    const decision = await this.strategyManager.shouldBuy(userId, signal, validation);
    if (!decision.shouldBuy) {
      throw new Error(`Strategy blocked: ${decision.reason}`);
    }
    console.log(`[Strategy] ${decision.reason}`);
  }

  // ... continuar com código existente
}
```

---

### 2. Trader.ts - Adicionar RSI e Peak Detection

**Adicionar no topo**:
```typescript
import { calculateRSI, interpretRSI } from '../../signal/src/technical-analysis/rsi';
import { detectPeak } from '../../signal/src/technical-analysis/peak-detection';
import { PriceCollector } from '../../signal/src/workers/price-collector';
```

**No método `shouldSellPosition`** (adicionar ANTES das verificações existentes, linha ~709):
```typescript
async shouldSellPosition(
  userId: string,
  tokenId: string,
  signal: Signal,
  currentPrice: number,
  buyPrice: number,
  holdTimeMinutes: number,
  potentialMultiplier: number
): Promise<{ shouldSell: boolean; reason: string }> {
  
  // PRIORIDADE 0: ANÁLISE TÉCNICA (se disponível)
  try {
    const collector = new PriceCollector(this.pool);
    const candles = await collector.getRecentCandles(tokenId, '1m', 50);
    
    if (candles.length >= 20) {
      const prices = candles.map(c => Number(c.close_price));
      const volumes = candles.map(c => Number(c.volume_usd));
      
      // RSI Analysis
      const rsi = calculateRSI(prices, 14);
      if (rsi.signal === 'OVERBOUGHT' && rsi.confidence > 70) {
        console.log(`[TA] 🔴 RSI OVERBOUGHT: ${rsi.rsi} (${rsi.confidence}%)`);
        return { 
          shouldSell: true, 
          reason: `📊 RSI sobrecomprado (${rsi.rsi}) - venda técnica recomendada` 
        };
      }
      
      // Peak Detection
      const peak = detectPeak(prices, volumes);
      if (peak.shouldSell && peak.confidence > 60) {
        console.log(`[TA] 🔴 PEAK DETECTED: ${peak.reason}`);
        return { shouldSell: true, reason: `🎯 ${peak.reason}` };
      }
      
      console.log(`[TA] RSI: ${rsi.rsi}, Peak: ${peak.isPeak ? 'YES' : 'NO'}, Momentum: ${peak.momentum}`);
    }
  } catch (error) {
    console.error('[TA] Technical analysis failed:', error);
    // Continuar com lógica tradicional
  }

  // PRIORIDADE 1: SINAL SELL
  if (signal.signal_type === 'SELL') {
    return { shouldSell: true, reason: 'Sinal SELL emitido' };
  }

  // ... resto do código existente
}
```

---

### 3. Instalar Dependências Faltantes

```powershell
# API Gateway
cd services/api-gateway
npm install @sendgrid/mail ethers

# Validator
cd ../validator
npm install @solana/web3.js axios

# Signal  
cd ../signal
npm install

# Executor
cd ../executor
npm install @solana/web3.js @solana/spl-token ethers
```

---

### 4. Configurar Variáveis de Ambiente

**Adicionar em `.env`**:
```bash
# SendGrid
SENDGRID_API_KEY=SG.xxxxxxxxxxxxx
EMAIL_FROM=noreply@tradingbot.ai
FRONTEND_URL=http://localhost:3000

# Encryption
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

# Solana
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLSCAN_API_KEY=your_solscan_key_here

# Price Collection
PRICE_COLLECTION_MINUTES=1

# Auto Analysis
AUTO_ANALYZE_INTERVAL_MINUTES=5
```

---

### 5. Aplicar Migrations

```powershell
psql -U botuser -d tradingbot -f infra/postgres/migrations/002_wallets_and_verification.sql
psql -U botuser -d tradingbot -f infra/postgres/migrations/003_technical_analysis.sql
```

---

## 🧪 Testando as Integrações

### 1. Testar Price Collector

```powershell
# Iniciar Signal Service
cd services/signal
npm run dev

# Verificar logs
# Deve aparecer: "📈 Price Collector started (1min interval)"
# A cada 1 minuto: "📊 Collecting prices..."
```

### 2. Testar Health Checks

```powershell
curl http://localhost:4000/api/health
curl http://localhost:4000/api/health/services
curl http://localhost:4000/api/health/database
```

### 3. Testar Estratégia Agressiva

```typescript
// No banco, ativar modo agressivo para um usuário
UPDATE user_profiles 
SET trading_strategy = 'auto_buy_verified' 
WHERE user_id = 'xxx';

  // Executar trade - deve comprar mesmo com confiança baixa!
```

### 4. Testar Análise Técnica

```sql
-- Verificar se candles estão sendo coletados
SELECT COUNT(*), interval, MAX(timestamp) as last_candle
FROM price_candles
GROUP BY interval;

-- Deve mostrar candles de 1m, 5m, 15m, 1h
```

---

## 🎯 Checklist de Integração

### Signal Service
- [x] PriceCollector importado
- [x] Iniciado no startup
- [ ] Logs confirmados

### API Gateway
- [x] Health routes adicionadas
- [x] Wallet routes adicionadas
- [ ] Testado endpoints

### Executor Service
- [ ] TradingStrategy importado
- [ ] Integrado em executeBuy
- [ ] RSI/Peak integrados em shouldSellPosition
- [ ] Testado com trades reais

### Database
- [x] Migration 002 aplicada
- [x] Migration 003 aplicada
- [ ] Verificar dados em price_candles

### Environment
- [ ] SENDGRID_API_KEY configurado
- [ ] ENCRYPTION_KEY configurado (64 hex chars)
- [ ] SOLANA_RPC_URL configurado
- [ ] Demais variáveis configuradas

---

## 🚨 Problemas Comuns

### 1. "Cannot find module 'xxx'"
**Solução**: Instalar dependências
```bash
npm install
```

### 2. "ENCRYPTION_KEY not found"
**Solução**: Gerar chave
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. "Database relation does not exist"
**Solução**: Aplicar migrations
```bash
psql -U botuser -d tradingbot -f infra/postgres/migrations/002_wallets_and_verification.sql
```

### 4. Imports entre serviços não funcionam
**Solução**: Ajustar paths ou duplicar arquivos
- RSI e Peak podem ser copiados para `/executor/src/technical-analysis/`

---

## ✅ Após Integração Completa

Você terá:
- ✅ Análise técnica funcionando (RSI + Peak)
- ✅ Histórico de preços sendo coletado
- ✅ Estratégia agressiva ativa
- ✅ Health monitoring funcionando
- ✅ Wallets integradas
- ✅ Email notifications prontas

**Próximo passo**: Testar em testnet (BSC + Solana)!
