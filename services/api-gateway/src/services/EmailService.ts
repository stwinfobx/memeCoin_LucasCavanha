import { Resend } from 'resend';
import crypto from 'crypto';
import { Pool } from 'pg';

export class EmailService {
    private pool: Pool;
    private resend: Resend | null = null;
    private isConfigured: boolean;
    private emailFrom: string;

    constructor(pool: Pool) {
        this.pool = pool;

        // Configurar Resend
        const apiKey = process.env.RESEND_API_KEY;
        this.emailFrom = process.env.EMAIL_FROM || 'noreply@tradingbot.ai';

        if (apiKey && apiKey !== '' && !apiKey.startsWith('re_xxx')) {
            this.resend = new Resend(apiKey);
            this.isConfigured = true;
            console.log('[EmailService] ✅ Resend configured');
        } else {
            this.isConfigured = false;
            console.warn('[EmailService] ⚠️ Resend not configured (RESEND_API_KEY missing or invalid)');
        }
    }

    /**
     * Envia e-mail de verificação de conta
     */
    async sendVerificationEmail(email: string, token: string) {
        if (!this.isConfigured || !this.resend) {
            console.log('[EmailService] Skipping verification email (not configured)');
            return;
        }

        try {
            const verifyLink = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;

            await this.resend.emails.send({
                from: this.emailFrom,
                to: email,
                subject: '✅ Verify your TradingBot account',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #8b5cf6;">Welcome to TradingBot AI! 🚀</h2>
                        <p>Thank you for registering. Please verify your email address to activate your account.</p>
                        <div style="margin: 30px 0;">
                            <a href="${verifyLink}" 
                               style="background-color: #8b5cf6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                                Verify Email
                            </a>
                        </div>
                        <p style="color: #666; font-size: 14px;">Or copy this link: ${verifyLink}</p>
                        <p style="color: #666; font-size: 12px;">This link expires in 24 hours.</p>
                    </div>
                `
            });

            console.log(`[EmailService] ✅ Verification email sent to ${email}`);
        } catch (error: any) {
            console.error('[EmailService] ❌ Failed to send verification email:', error.message);
            throw error;
        }
    }

    /**
     * Envia e-mail de recuperação de senha
     */
    async sendPasswordResetEmail(email: string, token: string) {
        if (!this.isConfigured || !this.resend) {
            console.log('[EmailService] Skipping password reset email (not configured)');
            return;
        }

        try {
            const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

            await this.resend.emails.send({
                from: this.emailFrom,
                to: email,
                subject: '🔐 Reset your TradingBot password',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #8b5cf6;">Password Reset Request</h2>
                        <p>We received a request to reset your password. Click the button below to create a new password.</p>
                        <div style="margin: 30px 0;">
                            <a href="${resetLink}" 
                               style="background-color: #8b5cf6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                                Reset Password
                            </a>
                        </div>
                        <p style="color: #666; font-size: 14px;">Or copy this link: ${resetLink}</p>
                        <p style="color: #666; font-size: 12px;">This link expires in 1 hour.</p>
                        <p style="color: #999; font-size: 12px; margin-top: 30px;">If you did not request this, please ignore this email.</p>
                    </div>
                `
            });

            console.log(`[EmailService] ✅ Password reset email sent to ${email}`);
        } catch (error: any) {
            console.error('[EmailService] ❌ Failed to send password reset email:', error.message);
            throw error;
        }
    }

    /**
     * Envia e-mail de depósito confirmado
     */
    async sendDepositConfirmedEmail(userId: string, amountCrypto: number, tokenSymbol: string, amountUSD: number) {
        if (!this.isConfigured || !this.resend) {
            console.log('[EmailService] Skipping deposit confirmation email (not configured)');
            return;
        }

        try {
            const user = await this.pool.query('SELECT email FROM users WHERE id = $1', [userId]);
            if (user.rows.length === 0) return;

            const email = user.rows[0].email;

            await this.resend.emails.send({
                from: this.emailFrom,
                to: email,
                subject: '💰 Deposit Confirmed - TradingBot',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #10b981;">✅ Your deposit has been confirmed!</h2>
                        <div style="background-color: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0;">
                            <p style="margin: 0; font-size: 24px; font-weight: bold; color: #10b981;">
                                ${amountCrypto.toFixed(6)} ${tokenSymbol}
                            </p>
                            <p style="margin: 5px 0 0 0; color: #666;">≈ $${amountUSD.toFixed(2)} USD</p>
                        </div>
                        <p>Your funds have been credited to your account and are ready to trade!</p>
                        <div style="margin: 30px 0;">
                            <a href="${process.env.FRONTEND_URL}/dashboard" 
                               style="background-color: #8b5cf6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                                View Dashboard
                            </a>
                        </div>
                    </div>
                `
            });

            console.log(`[EmailService] ✅ Deposit confirmation email sent to ${email}`);
        } catch (error: any) {
            console.error('[EmailService] ❌ Failed to send deposit confirmation email:', error.message);
        }
    }

    /**
     * Envia e-mail de posição aberta
     */
    async sendPositionOpenedEmail(userId: string, tokenSymbol: string, amountUSD: number) {
        if (!this.isConfigured || !this.resend) return;

        try {
            const user = await this.pool.query('SELECT email FROM users WHERE id = $1', [userId]);
            if (user.rows.length === 0) return;

            await this.resend.emails.send({
                from: this.emailFrom,
                to: user.rows[0].email,
                subject: `🛒 New Position Opened - ${tokenSymbol}`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #8b5cf6;">📈 Position Opened</h2>
                        <p>Your bot has opened a new trading position:</p>
                        <div style="background-color: #f5f3ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
                            <p><strong>Token:</strong> ${tokenSymbol}</p>
                            <p><strong>Investment:</strong> $${amountUSD.toFixed(2)}</p>
                        </div>
                        <div style="margin: 30px 0;">
                            <a href="${process.env.FRONTEND_URL}/positions" 
                               style="background-color: #8b5cf6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                                View Position
                            </a>
                        </div>
                    </div>
                `
            });
        } catch (error: any) {
            console.error('[EmailService] ❌ Failed to send position opened email:', error.message);
        }
    }

    /**
     * Envia e-mail de posição fechada (lucro/perda)
     */
    async sendPositionClosedEmail(userId: string, tokenSymbol: string, profitLossUSD: number, profitLossPercent: number) {
        if (!this.isConfigured || !this.resend) return;

        try {
            const user = await this.pool.query('SELECT email FROM users WHERE id = $1', [userId]);
            if (user.rows.length === 0) return;

            const isProfit = profitLossUSD > 0;
            const color = isProfit ? '#10b981' : '#ef4444';
            const emoji = isProfit ? '🎉' : '📉';

            await this.resend.emails.send({
                from: this.emailFrom,
                to: user.rows[0].email,
                subject: `${emoji} Position Closed - ${tokenSymbol} (${isProfit ? '+' : ''}${profitLossPercent.toFixed(2)}%)`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: ${color};">${emoji} Position Closed</h2>
                        <p>Your bot has closed a position:</p>
                        <div style="background-color: ${isProfit ? '#f0fdf4' : '#fef2f2'}; padding: 20px; border-radius: 8px; margin: 20px 0;">
                            <p><strong>Token:</strong> ${tokenSymbol}</p>
                            <p style="font-size: 24px; font-weight: bold; color: ${color}; margin: 10px 0;">
                                ${isProfit ? '+' : ''}$${Math.abs(profitLossUSD).toFixed(2)}
                            </p>
                            <p style="color: #666;">(${isProfit ? '+' : ''}${profitLossPercent.toFixed(2)}%)</p>
                        </div>
                        <div style="margin: 30px 0;">
                            <a href="${process.env.FRONTEND_URL}/dashboard" 
                               style="background-color: #8b5cf6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                                View Performance
                            </a>
                        </div>
                    </div>
                `
            });
        } catch (error: any) {
            console.error('[EmailService] ❌ Failed to send position closed email:', error.message);
        }
    }
}
