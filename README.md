# Trading Bot AI - Sistema de Trading Automatizado

Sistema completo de trading automatizado para memecoins na BSC (Binance Smart Chain) com análise técnica, gestão de risco e interface web moderna.

## 🚀 Features

- ✅ **Trading Automatizado**: Compra e venda automática via PancakeSwap
- ✅ **Análise Técnica**: RSI + Peak Detection para identificar pontos de entrada/saída
- ✅ **Gestão de Risco**: Stop-loss, take-profit e limites configuráveis
- ✅ **MetaMask Integration**: Depósitos e saques via MetaMask (BSC)
- ✅ **Sistema de Aprovação**: Saques requerem aprovação administrativa
- ✅ **Notificações em Tempo Real**: WebSocket para updates instantâneos
- ✅ **Autenticação Completa**: JWT + recuperação de senha + verificação de email

## 📋 Pré-requisitos

- Node.js 18+
- PostgreSQL (recomendado: Supabase)
- MetaMask instalado
- Conta Resend (para emails)
- Conta BSCScan (para API)

## 🛠️ Instalação

### 1. Clonar Repositório

```bash
git clone <url-do-repositorio>
cd TradingBot
```

### 2. Instalar Dependências

```powershell
.\install-deps.ps1
```

### 3. Configurar Variáveis de Ambiente

1. Copiar `.env.example` para `.env`:
```powershell
Copy-Item .env.example .env
```

2. Editar `.env` e preencher:
   - Credenciais do Supabase
   - API Keys (Resend, BSCScan)
   - Chaves de segurança (JWT, Encryption)
   - Wallet do bot

**Ver guia completo:** `docs/GUIA_CONFIGURACAO_DEPLOY.md`

### 4. Aplicar Migrations no Banco

1. Acessar Supabase SQL Editor
2. Executar em ordem:
   - `infra/postgres/schema.sql`
   - `scripts/migration-005-withdrawals.sql`

### 5. Iniciar Sistema

```powershell
.\start-all.ps1
```

Acessar: http://localhost:3000

## 📁 Estrutura do Projeto

```
TradingBot/
├── services/
│   ├── api-gateway/     # API principal
│   ├── validator/       # Validação de tokens
│   ├── signal/          # Geração de sinais
│   └── executor/        # Execução de trades
├── web/frontend/        # Interface Next.js
├── infra/postgres/      # Schema do banco
├── docs/                # Documentação
└── scripts/             # Migrations e utilitários
```

## 🔑 Funcionalidades Principais

### Para Usuários

1. **Depósitos**: Enviar BNB via MetaMask
2. **Configurar Bot**: Ajustar risco, limites e intensidade
3. **Trading Automático**: Bot opera 24/7
4. **Saques**: Solicitar retirada de fundos (aprovação manual)
5. **Dashboard**: Acompanhar performance em tempo real

### Para Administradores

- Aprovar/rejeitar saques
- Monitorar sistema via logs
- Gerenciar riscos e limites globais

## 📚 Documentação

- **[Guia de Configuração](docs/GUIA_CONFIGURACAO_DEPLOY.md)**: Setup completo passo a passo
- **Status do Sistema**: Ver `docs/concluidos/STATUS_ATUAL.md`
- **Roadmap Futuro**: Ver `docs/concluidos/ROADMAP_FUTURO.md`

## 🔒 Segurança

- ✅ Autenticação JWT
- ✅ Private keys encriptadas (AES-256-GCM)
- ✅ Rate limiting
- ✅ CORS configurado
- ✅ Validação de entrada em todos endpoints

## 🧪 Modo de Execução

O bot pode operar em 2 modos (configurar no `.env`):

- `BOT_EXECUTION_MODE=live`: Trading real na blockchain
- `BOT_EXECUTION_MODE=simulation`: Apenas simulação (paper trading)

**Padrão para produção:** `live`

## 🚀 Deploy

Ver guia completo em: `docs/GUIA_CONFIGURACAO_DEPLOY.md`

**Recomendações:**
- Frontend: Vercel
- Backend: Render.com / Railway
- Banco: Supabase
- Email: Resend

## 🤝 Suporte

Para dúvidas ou problemas:
1. Verificar documentação em `docs/`
2. Revisar logs dos serviços
3. Verificar configurações do `.env`

## 📝 Licença

Copyright © 2026 - Todos os direitos reservados

---

**Sistema 100% Pronto para Produção**  
**Versão:** 1.0.0  
**Última Atualização:** 15 de Janeiro de 2026
