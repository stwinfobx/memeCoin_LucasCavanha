# 🚀 Trading Bot AI - Guia Completo do Sistema

Este documento fornece uma visão panorâmica detalhada sobre o que é o sistema, suas funcionalidades, arquitetura e como cada parte do frontend se conecta ao ecossistema de trading.

---

## 🎯 1. O que é o sistema?
O **Trading Bot AI** é uma plataforma automatizada de alta performance especializada em **Memecoins** na rede **Binance Smart Chain (BSC)** e **Solana**. 

O objetivo principal é identificar moedas com alto potencial de valorização (o popular "moon"), validar se elas são seguras (evitar golpes/honeypots) e executar operações de compra e venda automaticamente com base em estratégias de IA e análise técnica (RSI, Peak Detection).

---

## 🛠️ 2. Principais Funcionalidades

### **Para o Usuário Comum:**
*   **Depósito via MetaMask/Phantom**: Injeção de saldo diretamente da sua carteira para o sistema.
*   **Trading 24/7 Autônomo**: O bot trabalha enquanto você dorme, buscando oportunidades.
*   **Gestão de Risco Personalizada**: Configuração de Stop-loss, Take-profit e limites de exposição.
*   **Acompanhamento em Tempo Real**: Dashboard dinâmico com lucros, perdas e sinais ativos.
*   **Notificações**: Alertas via e-mail e na plataforma sobre trades realizados e mudanças de saldo.

### **Para o Administrador:**
*   **Aprovação de Saques**: Controle manual das retiradas para garantir segurança.
*   **Monitoramento de Logs**: Visão técnica de tudo o que os microsserviços estão fazendo.
*   **Ajustes de Algoritmo**: Mudança global de parâmetros de risco e critérios de validação.

---

## 🏗️ 3. Arquitetura do Sistema (Microsserviços)

O sistema é dividido em 4 "cérebros" independentes que se comunicam:

1.  **API Gateway (Porta 4000)**: O ponto de entrada. Gerencia login, registro de usuários, WebSockets para atualizações em tempo real e serve o frontend.
2.  **Validator (Porta 4001)**: O "segurança". Analisa contratos de tokens para detectar se são "Honeypots" (moedas que você compra mas não consegue vender), verifica liquidez bloqueada e atribui um **Safety Score**.
3.  **Signal (Porta 4002)**: O "analista". Processa dados do mercado para gerar sinais de COMPRA ou VENDA baseados em pontuações de confiança e algoritmos de scoring.
4.  **Executor (Porta 4003)**: O "trader". É quem realmente envia as ordens para a blockchain (via PancakeSwap). Gerencia o ciclo de vida da posição (quando vender no lucro ou no prejuízo através de RSI e Peak Detection).

---

## 🖥️ 4. Todas as Páginas e Funcionalidades do Frontend

Abaixo, a descrição detalhada das páginas localizadas em `web/frontend/app`:

| Página | Descrição | Funcionalidades Principais |
| :--- | :--- | :--- |
| **Página Inicial (Home)** | Landing page e resumo do sistema. | Visão geral do produto e botões de chamada para ação (Login/Registro). |
| **Auth (`/auth`)** | Central de usuários. | Login, Cadastro, Recuperação de Senha e Verificação de E-mail. |
| **Dashboard (`/dashboard`)** | O painel de controle principal. | Resumo de saldo (USD/BNB), gráfico de lucro acumulado, status do bot e visão rápida de notificações. |
| **Bot Config (`/bot`)** | Onde você configura a IA. | Ativar/Desativar bot, definir Intensidade (1-10), Perda Máxima (%) e Ganho Alvo (%). |
| **Sinais (`/signals`)** | Oportunidades detectadas. | Lista de tokens encontrados pelo sistema, com seus respectivos scores de segurança e potencial de lucro. |
| **Posições (`/positions`)** | Trades em andamento e histórico. | Lista de ativos que o bot comprou, mostrando lucro/prejuízo em tempo real e botão para "Venda Manual". |
| **Performance (`/bot-performance`)** | Analítica avançada. | Estatísticas detalhadas de trades vitoriosos vs. perdedores e histogramas de performance. |
| **Depósito (`/deposit`)** | Envio de fundos. | Interface integrada com MetaMask para depositar BNB na rede BSC. Confirmações automáticas on-chain. |
| **Saque (`/withdraw`)** | Retirada de fundos. | Solicitação de saque para carteira externa. Sistema de status (Pendente, Aprovado, Rejeitado). |
| **Perfil (`/profile`)** | Dados do usuário. | Alteração de nome, telefone, endereço de carteira e configurações de segurança (MFA). |
| **Notificações (`/notifications`)** | Central de alertas. | Histórico de todas as mensagens do sistema (Ex: "Trade executado com sucesso", "Depósito confirmado"). |

---

## 📈 5. Gerenciamento de Risco e Estratégia

O sistema não compra aleatoriamente. Ele segue regras rígidas:

*   **Validação Mínima**: Liquidez deve ser > $5.000 (configurável).
*   **Antiscam**: Tokens suspeitos de serem Honeypot são ignorados.
*   **Stop-Loss Dinâmico**: Se a moeda cai abaixo do seu limite de segurança, o bot vende instantaneamente para proteger o capital.
*   **Take-Profit em Escalas**: O bot realiza lucros parciais conforme o preço sobe.
*   **Peak Detection**: Utiliza algoritmos para identificar quando uma memecoin atingiu o topo e começar a vender antes da queda.

---

## 📅 6. Status Atual e Ativação

O sistema está **95% pronto** para produção:
*   **Modo Simulação**: Ativo por padrão (faz trades imaginários para testar estratégia).
*   **Modo Live**: Pronto para ser ativado no arquivo `.env` para operar com dinheiro real via PancakeSwap.

Para mais detalhes técnicos, consulte os arquivos dentro da pasta `docs/concluidos/`.
