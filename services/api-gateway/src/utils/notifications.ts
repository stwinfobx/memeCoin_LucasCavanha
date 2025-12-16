import { Pool } from 'pg';

/**
 * Helper para criar notificações do bot
 */
export async function createNotification(
  pool: Pool,
  userId: string,
  type: string,
  severity: 'success' | 'info' | 'warning' | 'error',
  title: string,
  message: string,
  data?: any
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO bot_notifications (user_id, notification_type, severity, title, message, data)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [userId, type, severity, title, message, data ? JSON.stringify(data) : null]
    );
  } catch (error: any) {
    console.error('[Notifications] Failed to create notification:', error.message);
    // Não propagar erro - notificações não são críticas
  }
}

/**
 * Mensagens do robô para diferentes tipos de eventos
 */
export const BotMessages = {
  tokenValidated: (symbol: string, riskLevel: string) => ({
    title: 'Token validado',
    message: `🤖 Analisei ${symbol} e classifiquei como risco ${riskLevel}. Calculando sinais de trading...`,
  }),
  signalGenerated: (symbol: string, signalType: string, confidence: number) => ({
    title: `Sinal ${signalType} gerado`,
    message: `🤖 Identifiquei oportunidade em ${symbol}! Sinal ${signalType} com ${confidence}% de confiança. Decidindo investimento...`,
  }),
  orderExecuted: (symbol: string, orderType: string, amount: number) => ({
    title: `Ordem ${orderType} executada`,
    message: `🤖 Executei uma ordem ${orderType} de $${amount.toFixed(2)} em ${symbol}! Simulando execução...`,
  }),
  positionOpened: (symbol: string, invested: number, price: number) => ({
    title: 'Nova posição aberta',
    message: `🤖 Abri uma posição em ${symbol}! Investi $${invested.toFixed(2)} a $${price.toFixed(6)} por token. Monitorando...`,
  }),
  positionClosed: (symbol: string, profit: number, percent: number) => {
    const isProfit = profit >= 0;
    return {
      title: 'Posição fechada',
      message: `🤖 Fechei a posição em ${symbol}! ${isProfit ? 'Ganho' : 'Perda'} de $${Math.abs(profit).toFixed(2)} (${Math.abs(percent).toFixed(2)}%). Continuando análise...`,
    };
  },
  takeProfitHit: (symbol: string, profit: number) => ({
    title: 'Take-profit atingido!',
    message: `🤖 🎉 Take-profit atingido em ${symbol}! Lucro de $${profit.toFixed(2)} realizado. Vou fechar a posição agora!`,
  }),
  stopLossHit: (symbol: string, loss: number) => ({
    title: 'Stop-loss atingido',
    message: `🤖 ⚠️ Stop-loss atingido em ${symbol}. Perda de $${Math.abs(loss).toFixed(2)}. Fechando posição para proteger capital...`,
  }),
  monitoringCheck: (positionsCount: number) => ({
    title: 'Verificação de posições',
    message: `🤖 Verifiquei ${positionsCount} posição(ões) aberta(s). Analisando preços e sinais para decisões de venda...`,
  }),
  botStarted: () => ({
    title: 'Bot iniciado',
    message: '🤖 Bot de trading iniciado! Estou pronto para analisar memecoins e executar trades automaticamente!',
  }),
  botStopped: () => ({
    title: 'Bot parado',
    message: '🤖 Bot de trading parado. Nenhuma nova operação será executada até você me iniciar novamente!',
  }),
  configUpdated: (intensity: number, riskProfile: string) => ({
    title: 'Configurações atualizadas',
    message: `🤖 Minhas configurações foram atualizadas! Intensidade: ${intensity}/10, Perfil: ${riskProfile}. Vou ajustar minha estratégia!`,
  }),
  errorOccurred: (error: string) => ({
    title: 'Erro detectado',
    message: `🤖 ⚠️ Ops! Encontrei um problema: ${error}. Continuando operação normalmente...`,
  }),
};

