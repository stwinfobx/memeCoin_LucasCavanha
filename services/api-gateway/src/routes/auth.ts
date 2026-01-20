import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import { hashPassword, comparePassword, generateAccessToken, generateRefreshToken } from '../utils/auth';
import { authenticate, AuthRequest } from '../middleware/auth';
import { RegisterRequest, LoginRequest } from '@shared/types';
import { emailService } from '../services/email';
import crypto from 'crypto';

const router = Router();

// POST /auth/register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, full_name }: RegisterRequest = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Email and password are required',
        },
        timestamp: new Date(),
      });
    }

    // Verificar se usuário já existe
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'USER_EXISTS',
          message: 'User with this email already exists',
        },
        timestamp: new Date(),
      });
    }

    // Hash da senha
    const passwordHash = await hashPassword(password);

    // Gerar token de verificação
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    // Criar usuário (inativo até verificar email)
    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, email_verification_token, email_verification_expires, is_active) 
       VALUES ($1, $2, $3, $4, false) 
       RETURNING id, email, mfa_enabled, is_active, created_at, updated_at`,
      [email, passwordHash, verificationToken, tokenExpiry]
    );

    const user = userResult.rows[0];

    // Criar perfil do usuário
    await pool.query(
      'INSERT INTO user_profiles (user_id, full_name) VALUES ($1, $2)',
      [user.id, full_name || null]
    );

    // Enviar e-mail de verificação
    await emailService.sendVerificationEmail(email, verificationToken);

    // Gerar tokens
    const accessToken = generateAccessToken({ userId: user.id, email: user.email });
    const refreshToken = generateRefreshToken({ userId: user.id, email: user.email });

    res.status(201).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          mfa_enabled: user.mfa_enabled,
          is_active: user.is_active,
          created_at: user.created_at,
          updated_at: user.updated_at,
        },
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 3600, // 1 hora
        message: 'Registration successful. Please check your email to verify your account.',
      },
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('Register error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'production' ? 'Failed to register user' : error.message,
        details: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
      },
      timestamp: new Date(),
    });
  }
});

// POST /auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    console.log('[Auth] Login attempt:', { email: req.body?.email, hasPassword: !!req.body?.password });

    const { email, password }: LoginRequest = req.body;

    if (!email || !password) {
      console.log('[Auth] Missing credentials:', { email: !!email, password: !!password });
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Email and password are required',
        },
        timestamp: new Date(),
      });
    }

    // Verificar conexão com banco
    let userResult;
    try {
      userResult = await pool.query(
        'SELECT id, email, password_hash, mfa_enabled, is_active, created_at, updated_at FROM users WHERE email = $1',
        [email]
      );
      console.log('[Auth] User query result:', { found: userResult.rows.length > 0, userId: userResult.rows[0]?.id });
    } catch (dbError: any) {
      console.error('[Auth] Database query error:', dbError);
      throw new Error(`Database error: ${dbError.message}`);
    }

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        },
        timestamp: new Date(),
      });
    }

    const user = userResult.rows[0];

    // Verificar senha
    let passwordMatch = false;
    try {
      passwordMatch = await comparePassword(password, user.password_hash);
      console.log('[Auth] Password match:', passwordMatch);
    } catch (passwordError: any) {
      console.error('[Auth] Password comparison error:', passwordError);
      throw new Error(`Password verification error: ${passwordError.message}`);
    }

    if (!passwordMatch) {
      console.log('[Auth] Invalid password for user:', email);
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        },
        timestamp: new Date(),
      });
    }

    // Verificar se usuário está ativo
    if (!user.is_active) {
      console.log('[Auth] Account disabled for user:', email);
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCOUNT_DISABLED',
          message: 'Account is disabled. Please verify your email.',
        },
        timestamp: new Date(),
      });
    }

    // Gerar tokens
    let accessToken: string;
    let refreshToken: string;
    try {
      accessToken = generateAccessToken({ userId: user.id, email: user.email });
      refreshToken = generateRefreshToken({ userId: user.id, email: user.email });
      console.log('[Auth] Tokens generated successfully for user:', email);
    } catch (tokenError: any) {
      console.error('[Auth] Token generation error:', tokenError);
      throw new Error(`Token generation error: ${tokenError.message}`);
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          mfa_enabled: user.mfa_enabled,
          is_active: user.is_active,
          created_at: user.created_at,
          updated_at: user.updated_at,
        },
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 3600, // 1 hora
      },
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[Auth] Login error:', error);
    console.error('[Auth] Login error stack:', error.stack);
    console.error('[Auth] Login error details:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint,
    });
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'production' ? 'Failed to login' : error.message,
        details: process.env.NODE_ENV === 'production' ? undefined : {
          stack: error.stack,
          code: error.code,
          detail: error.detail,
        },
      },
      timestamp: new Date(),
    });
  }
});

// GET /auth/me
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;

    const userResult = await pool.query(
      'SELECT id, email, mfa_enabled, is_active, created_at, updated_at FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
        },
        timestamp: new Date(),
      });
    }

    const profileResult = await pool.query(
      'SELECT * FROM user_profiles WHERE user_id = $1',
      [userId]
    );

    res.json({
      success: true,
      data: {
        user: userResult.rows[0],
        profile: profileResult.rows[0] || null,
      },
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('Get me error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to get user data',
      },
      timestamp: new Date(),
    });
  }
});

// GET /auth/verify-email/:token
router.get('/verify-email/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;

    const result = await pool.query(
      `UPDATE users 
       SET is_active = true, 
           email_verification_token = NULL,
           email_verification_expires = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE email_verification_token = $1 
         AND email_verification_expires > NOW()
       RETURNING id, email`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid or expired verification token',
        },
        timestamp: new Date(),
      });
    }

    res.json({
      success: true,
      data: {
        message: 'Email verified successfully! You can now login.',
        email: result.rows[0].email,
      },
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('Verify email error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to verify email',
      },
      timestamp: new Date(),
    });
  }
});

// POST /auth/forgot-password
router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Email is required',
        },
        timestamp: new Date(),
      });
    }

    const userResult = await pool.query('SELECT id, email FROM users WHERE email = $1', [email]);

    // Por segurança, sempre retornar sucesso mesmo se email não existir
    if (userResult.rows.length > 0) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      const tokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

      await pool.query(
        `UPDATE users 
         SET password_reset_token = $1, 
             password_reset_expires = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE email = $3`,
        [resetToken, tokenExpiry, email]
      );

      await emailService.sendPasswordResetEmail(email, resetToken);
    }

    res.json({
      success: true,
      data: {
        message: 'If the email exists, a password reset link has been sent.',
      },
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to process password reset',
      },
      timestamp: new Date(),
    });
  }
});

// POST /auth/reset-password
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Token and new password are required',
        },
        timestamp: new Date(),
      });
    }

    const userResult = await pool.query(
      `SELECT id FROM users 
       WHERE password_reset_token = $1 
         AND password_reset_expires > NOW()`,
      [token]
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid or expired reset token',
        },
        timestamp: new Date(),
      });
    }

    const userId = userResult.rows[0].id;
    const passwordHash = await hashPassword(newPassword);

    await pool.query(
      `UPDATE users 
       SET password_hash = $1,
           password_reset_token = NULL,
           password_reset_expires = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [passwordHash, userId]
    );

    res.json({
      success: true,
      data: {
        message: 'Password reset successfully. You can now login with your new password.',
      },
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to reset password',
      },
      timestamp: new Date(),
    });
  }
});

export default router;


