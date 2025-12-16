import { Router, Response } from 'express';
import { pool } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid user context',
      },
      timestamp: new Date(),
    });
  }

  try {
    const [userResult, profileResult] = await Promise.all([
      pool.query(
        `SELECT id, email, mfa_enabled, is_active, created_at, updated_at
         FROM users
         WHERE id = $1`,
        [userId]
      ),
      pool.query(
        `SELECT
           full_name,
           phone,
           bank_account_number,
           bank_name,
           bank_routing_number,
           wallet_address,
           risk_profile,
           bot_enabled,
           bot_intensity,
           max_loss_percent,
           max_gain_percent,
           max_open_trades
         FROM user_profiles
         WHERE user_id = $1`,
        [userId]
      ),
    ]);

    res.json({
      success: true,
      data: {
        user: userResult.rows[0] ?? null,
        profile: profileResult.rows[0] ?? null,
      },
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[Profile] get error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PROFILE_ERROR',
        message: error.message || 'Failed to load profile',
      },
      timestamp: new Date(),
    });
  }
});

router.put('/', authenticate, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid user context',
      },
      timestamp: new Date(),
    });
  }

  try {
    const {
      full_name,
      phone,
      bank_account_number,
      bank_name,
      bank_routing_number,
      wallet_address,
    } = req.body ?? {};

    await pool.query(
      `UPDATE user_profiles SET
         full_name = $2,
         phone = $3,
         bank_account_number = $4,
         bank_name = $5,
         bank_routing_number = $6,
         wallet_address = $7,
         updated_at = NOW()
       WHERE user_id = $1`,
      [
        userId,
        normalizeString(full_name),
        normalizeString(phone),
        normalizeString(bank_account_number),
        normalizeString(bank_name),
        normalizeString(bank_routing_number),
        normalizeString(wallet_address),
      ]
    );

    const profileResult = await pool.query(
      `SELECT
         full_name,
         phone,
         bank_account_number,
         bank_name,
         bank_routing_number,
         wallet_address,
         risk_profile,
         bot_enabled,
         bot_intensity,
         max_loss_percent,
         max_gain_percent,
         max_open_trades
       FROM user_profiles
       WHERE user_id = $1`,
      [userId]
    );

    res.json({
      success: true,
      data: {
        profile: profileResult.rows[0] ?? null,
      },
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[Profile] update error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PROFILE_UPDATE_ERROR',
        message: error.message || 'Failed to update profile',
      },
      timestamp: new Date(),
    });
  }
});

export default router;
