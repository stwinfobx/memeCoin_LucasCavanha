import sgMail from '@sendgrid/mail';
import { Resend } from 'resend';

// Configurar API Keys
const sendgridKey = process.env.SENDGRID_API_KEY;
const resendKey = process.env.RESEND_API_KEY;

if (sendgridKey) {
  sgMail.setApiKey(sendgridKey);
}

const resend = resendKey ? new Resend(resendKey) : null;

if (!sendgridKey && !resendKey) {
  console.warn('[Email Service] Email API key not configured (RESEND_API_KEY or SENDGRID_API_KEY) - email notifications disabled');
}

export interface EmailParams {
  to: string;
  subject: string;
  html: string;
}

export class EmailService {
  private from: string;
  private enabled: boolean;
  private mode: 'sendgrid' | 'resend' | 'none';

  constructor() {
    this.from = process.env.EMAIL_FROM || 'noreply@tradingbot777.com';
    this.mode = resendKey ? 'resend' : (sendgridKey ? 'sendgrid' : 'none');
    this.enabled = this.mode !== 'none';
  }

  /**
   * Envia e-mail genérico
   */
  async sendEmail(params: EmailParams): Promise<boolean> {
    if (!this.enabled) {
      console.warn('[Email Service] Email disabled - skipping send');
      return false;
    }

    try {
      if (this.mode === 'resend' && resend) {
        console.log(`[Email Service] Attempting to send email via Resend from ${this.from} to ${params.to}...`);
        const result = await resend.emails.send({
          from: this.from,
          to: params.to,
          subject: params.subject,
          html: params.html,
        });

        if (result.error) {
          console.error(`[Email Service] ❌ Resend API Error:`, result.error);
          return false;
        }

        console.log(`[Email Service] ✅ Resend Email Sent ID: ${result.data?.id}`);
      } else if (this.mode === 'sendgrid') {
        await sgMail.send({
          to: params.to,
          from: this.from,
          subject: params.subject,
          html: params.html,
        });
      }

      console.log(`[Email Service] ✅ Email sent via ${this.mode} to ${params.to}: ${params.subject}`);
      return true;
    } catch (error: any) {
      console.error(`[Email Service] ❌ Exception sending email via ${this.mode}:`, error.message);
      if (error.response) {
        console.error(`[Email Service] ❌ Error details:`, JSON.stringify(error.response.data || error.response.body || error.response, null, 2));
      }
      return false;
    }
  }

  /**
   * E-mail de verificação
   */
  async sendVerificationEmail(email: string, token: string): Promise<boolean> {
    const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email/${token}`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px; }
          .container { background-color: white; padding: 30px; border-radius: 8px; max-width: 600px; margin: 0 auto; }
          .button { background-color: #7c3aed; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin-top: 20px; }
          .footer { margin-top: 30px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>🤖 Bem-vindo ao TradingBot AI!</h2>
          <p>Obrigado por se registrar. Para ativar sua conta, clique no botão abaixo:</p>
          <a href="${verificationUrl}" class="button">Verificar E-mail</a>
          <p style="margin-top: 20px;">Ou copie e cole este link no seu navegador:</p>
          <p style="word-break: break-all; background-color: #f9f9f9; padding: 10px;">${verificationUrl}</p>
          <div class="footer">
            <p>Este link expira em 24 horas.</p>
            <p>Se você não solicitou este cadastro, ignore este e-mail.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to: email,
      subject: '🤖 TradingBot AI - Verifique seu e-mail',
      html,
    });
  }

  /**
   * E-mail de ordem executada
   */
  async sendOrderExecutedEmail(
    email: string,
    orderType: 'BUY' | 'SELL',
    token: string,
    amount: number,
    pnl?: number,
    pnlPercent?: number
  ): Promise<boolean> {
    const isBuy = orderType === 'BUY';
    const emoji = isBuy ? '🟢' : (pnl && pnl >= 0 ? '🎉' : '⚠️');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px; }
          .container { background-color: white; padding: 30px; border-radius: 8px; max-width: 600px; margin: 0 auto; }
          .success { color: #10b981; }
          .warning { color: #ef4444; }
          .info-box { background-color: #f9fafb; padding: 15px; border-radius: 6px; margin: 20px 0; }
          .footer { margin-top: 30px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>${emoji} Ordem Executada - ${orderType}</h2>
          <div class="info-box">
            <p><strong>Token:</strong> ${token}</p>
            <p><strong>Tipo:</strong> ${orderType}</p>
            <p><strong>Valor:</strong> $${amount.toFixed(2)}</p>
            ${pnl !== undefined ? `
              <p class="${pnl >= 0 ? 'success' : 'warning'}">
                <strong>${pnl >= 0 ? 'Lucro' : 'Perda'}:</strong> 
                $${Math.abs(pnl).toFixed(2)} (${Math.abs(pnlPercent || 0).toFixed(2)}%)
              </p>
            ` : ''}
          </div>
          <div class="footer">
            <p>Acesse o dashboard para ver mais detalhes.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to: email,
      subject: `🤖 TradingBot - Ordem ${orderType} Executada - ${token}`,
      html,
    });
  }

  /**
   * E-mail de depósito confirmado
   */
  async sendDepositConfirmedEmail(
    email: string,
    amount: number,
    tokenSymbol: string,
    txHash: string
  ): Promise<boolean> {
    const explorerUrl = `https://bscscan.com/tx/${txHash}`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px; }
          .container { background-color: white; padding: 30px; border-radius: 8px; max-width: 600px; margin: 0 auto; }
          .success { color: #10b981; }
          .info-box { background-color: #f9fafb; padding: 15px; border-radius: 6px; margin: 20px 0; }
          .button { background-color: #7c3aed; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin-top: 20px; }
          .footer { margin-top: 30px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2 class="success">✅ Depósito Confirmado!</h2>
          <div class="info-box">
            <p><strong>Valor:</strong> ${amount.toFixed(4)} ${tokenSymbol}</p>
            <p><strong>Status:</strong> Confirmado (3 blocos)</p>
          </div>
          <p>Seu saldo foi creditado e está disponível para trading.</p>
          <a href="${explorerUrl}" class="button">Ver no BSCScan</a>
          <div class="footer">
            <p>TX Hash: ${txHash}</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to: email,
      subject: '🤖 TradingBot - Depósito Confirmado',
      html,
    });
  }

  /**
   * E-mail de recuperação de senha
   */
  async sendPasswordResetEmail(email: string, token: string): Promise<boolean> {
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password/${token}`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px; }
          .container { background-color: white; padding: 30px; border-radius: 8px; max-width: 600px; margin: 0 auto; }
          .button { background-color: #7c3aed; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin-top: 20px; }
          .footer { margin-top: 30px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>🔐 Redefinir Senha</h2>
          <p>Recebemos uma solicitação para redefinir sua senha. Clique no botão abaixo:</p>
          <a href="${resetUrl}" class="button">Redefinir Senha</a>
          <p style="margin-top: 20px;">Ou copie e cole este link:</p>
          <p style="word-break: break-all; background-color: #f9f9f9; padding: 10px;">${resetUrl}</p>
          <div class="footer">
            <p>Este link expira em 1 hora.</p>
            <p>Se você não solicitou esta alteração, ignore este e-mail.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to: email,
      subject: '🤖 TradingBot - Redefinir Senha',
      html,
    });
  }
}

export const emailService = new EmailService();
