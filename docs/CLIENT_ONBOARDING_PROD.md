# 📋 Guia de Preparação para Produção (Onboarding do Cliente)

Este guia contém todos os passos necessários para você obter as chaves e acessos precisos para colocar seu **Trading Bot AI** em operação real (Produção).

Para cada item, explicamos o que é e o passo a passo de como obter.

---

## 1. 🏦 Banco de Dados (Supabase)
O banco de dados é onde ficam guardados os usuários, o saldo deles, o histórico de trades e as configurações do sistema.

**Como obter:**
1.  Acesse [Supabase.com](https://supabase.com/) e crie uma conta (gratuita ou paga, conforme sua necessidade).
2.  Crie um novo projeto (clique em "New Project").
3.  Escolha um nome (ex: `MemeCoin Bot`) e defina uma senha forte para o banco (guarde esta senha!).
4.  Após o projeto ser criado (leva 1-2 minutos):
    *   Vá em **Project Settings** (ícone de engrenagem) no menu lateral.
    *   Clique em **Database**.
    *   Procure por **Connection String** e selecione a aba **URI**.
    *   Copie o texto que começa com `postgresql://...`.
    *   **IMPORTANTE**: Onde estiver `[YOUR-PASSWORD]`, você deve substituir pela senha que definiu no passo 3.

---

## 2. 🦊 Carteira do Bot (Binance Smart Chain)
O bot precisa de uma carteira para que o sistema funcione. Você precisará nos fornecer dois códigos desta carteira: o **Endereço Público** e a **Chave Privada**.

**Como obter:**
1.  Instale a extensão **MetaMask** ou utilize uma carteira como a **OKX Wallet** / **Trust Wallet**.
2.  Crie uma nova carteira exclusiva para o Bot. 
3.  **Endereço Público (Número da Conta):**
    *   No topo da sua carteira, copie o endereço.
    *   **IMPORTANTE:** Para a rede BNB (BSC), o endereço **DEVE começar com `0x`** (Exemplo: `0x123...`). 
    *   Não envie endereços que começam com `bc1` (Bitcoin) ou endereços de Solana para a configuração da rede Binance.
4.  **Chave Privada (Senha de Operação):**
    *   Vá nas configurações da conta e clique em **Exportar chave privada** ou **Show Private Key**.
    *   **IMPORTANTE**: Esta chave permite que o robô compre e venda moedas sozinho. Nunca a compartilhe com ninguém além do responsável pela configuração do servidor.

---

## 3. 🔍 BSCScan API (Monitoramento)
A API do BSCScan permite que o bot verifique saldos e confirme se as transações na rede Binance foram concluídas com sucesso.

**Como obter:**
1.  Acesse [BscScan.com](https://bscscan.com/).
2.  Crie uma conta gratuita em "Sign Up".
3.  Após logar, no menu lateral esquerdo, vá em **API-Keys**.
4.  Clique no botão **+ Add** para criar uma nova chave.
5.  Dê um nome (ex: `BotProducao`) e clique em **Create New API Key**.
6.  Copie o código gerado (**API Key Token**).

---

## 4. 📧 Resend (Envio de E-mails)
O Resend é o serviço que envia e-mails de confirmação de depósito, alertas de segurança e boas-vindas.

**Como obter:**
1.  Acesse [Resend.com](https://resend.com/).
2.  Crie uma conta e faça login.
3.  No menu lateral, clique em **API Keys**.
4.  Clique em **Create API Key**.
5.  Dê um nome e selecione "Full Access".
6.  Copie a chave que começa com `re_...`.
7.  *(Opcional mas recomendado)*: Na aba **Domains**, você pode adicionar seu domínio (ex: `seuapp.com`) para que os e-mails saiam com o nome da sua marca.

---

## 5. ☀️ Solana (Opcional - Expansão)
Se o sistema for operar também na rede Solana, precisaremos dos seguintes acessos:

**Como obter:**
1.  **Solscan API Key**:
    *   Acesse [Solscan.io](https://solscan.io/).
    *   Crie uma conta e vá em "API Management".
    *   Gere uma nova chave.
2.  **Solana RPC (QuickNode / Helius)**:
    *   A rede pública da Solana é limitada. Para o bot ser rápido, recomendamos criar uma conta no [QuickNode](https://www.quicknode.com/) ou [Helius.dev](https://helius.dev/).
    *   Crie um endpoint gratuito (ou pago) e copie a **HTTP URL**.

---

## 6. 🌐 URLs e Domínios
Precisamos definir onde o sistema vai morar na internet.

1.  **Domínio**: Qual endereço os usuários vão digitar? (Ex: `invest.meubot.com`).
2.  **Hospedagem**: Onde o sistema vai rodar? (Recomendado: Vercel para o site e Render ou Railway para o robô/backend).
    *   Se você já tiver essas contas, podemos fazer o deploy direto nelas.

---

## 🔐 7. Segredos de Segurança (Gerados por nós ou pelo cliente)
Estes são códigos que protegem os dados dos usuários. Caso queira gerar novos (recomendado), peça ao desenvolvedor para rodar os scripts de geração.

*   **JWT_SECRET**: Protege o login dos usuários.
*   **ENCRYPTION_KEY**: Protege a chave da sua carteira no banco de dados.

---

## ✅ Checklist de Entrega para o Cliente
Quando tiver tudo pronto, preencha o arquivo `.env` de produção com os dados abaixo (ou envie para seu desenvolvedor):

- [ ] **DATABASE_URL**: `postgresql://postgres:SENHA@db.xxx.supabase.co:5432/postgres`
- [ ] **CHAVE PRIVADA DA WALLET**: (A chave exportada do MetaMask)
- [ ] **ENDEREÇO DA WALLET (Public Address)**: `0x...` (Onde você vai depositar BNB para o bot começar)
- [ ] **BSCSCAN_API_KEY**: `...`
- [ ] **RESEND_API_KEY**: `re_...`
- [ ] **SOLSCAN_API_KEY**: (Se for usar Solana)
- [ ] **SOLANA_RPC_URL**: (Se for usar Solana)
- [ ] **DOMAIN**: `exemplo.com`

---

> **⚠️ AVISO DE SEGURANÇA:**
> Nunca envie essas chaves por WhatsApp ou e-mail sem proteção. O ideal é usar um gerenciador de senhas ou ferramentas como o [1Password](https://1password.com/) ou [Bitwarden](https://bitwarden.com/).
