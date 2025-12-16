import { Router, Response } from 'express';
import { pool } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

const toNumber = (value: any): number | undefined => {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

router.get('/active', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 100);
    // Incluir sinais ativos E sinais SELL recentes (últimos 10 minutos) mesmo que não estejam mais ativos
    const result = await pool.query(
      `SELECT 
         s.id,
         s.token_id,
         s.signal_type,
         s.confidence_score,
         s.potential_multiplier,
         s.reasoning,
         s.created_at,
         s.expires_at,
         s.is_active,
         s.volume_score,
         s.liquidity_score,
         s.holders_score,
         s.age_score,
         s.safety_score,
         s.overall_score,
         s.price_at_signal,
         t.symbol,
         t.name,
         t.price_usd,
         t.liquidity_usd,
         t.volume_24h_usd,
         t.safety_score AS token_safety_score
       FROM signals s
       JOIN tokens t ON s.token_id = t.id
       WHERE (s.is_active = true AND (s.expires_at IS NULL OR s.expires_at > NOW()))
          OR (s.signal_type = 'SELL' AND s.created_at > NOW() - INTERVAL '10 minutes')
       ORDER BY s.created_at DESC
       LIMIT $1`,
      [limit]
    );

    const data = result.rows.map((row) => ({
      id: row.id,
      signal_type: row.signal_type,
      confidence_score: toNumber(row.confidence_score) ?? 0,
      potential_multiplier: toNumber(row.potential_multiplier),
      reasoning: row.reasoning ?? undefined,
      created_at: row.created_at,
      expires_at: row.expires_at,
      is_active: Boolean(row.is_active ?? true),
      token_id: row.token_id,
      symbol: row.symbol,
      name: row.name,
      price_usd: toNumber(row.price_usd) ?? toNumber(row.price_at_signal) ?? 0,
      price_at_signal: toNumber(row.price_at_signal) ?? toNumber(row.price_usd) ?? 0,
      liquidity_usd: toNumber(row.liquidity_usd) ?? 0,
      volume_24h_usd: toNumber(row.volume_24h_usd) ?? 0,
      volume_score: toNumber(row.volume_score),
      liquidity_score: toNumber(row.liquidity_score),
      holders_score: toNumber(row.holders_score),
      age_score: toNumber(row.age_score),
      safety_score: toNumber(row.safety_score) ?? toNumber(row.token_safety_score),
      overall_score: toNumber(row.overall_score),
    }));

    res.json({
      success: true,
      data,
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[Signals] active error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SIGNALS_ERROR',
        message: 'Failed to load active signals',
      },
      timestamp: new Date(),
    });
  }
});

router.get('/history', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 100), 1), 200);
    const confidenceThreshold = Number(process.env.SIGNAL_CONFIDENCE_THRESHOLD ?? 2);
    const overallThreshold = Number(process.env.SIGNAL_OVERALL_THRESHOLD ?? 2.5);

    const result = await pool.query(
      `WITH ranked AS (
         SELECT
           s.id,
           s.token_id,
           s.signal_type,
           s.confidence_score,
           s.potential_multiplier,
           s.reasoning,
           s.created_at,
           s.expires_at,
           s.is_active,
           s.overall_score,
           t.symbol,
           t.name,
           LAG(s.signal_type) OVER (PARTITION BY s.token_id ORDER BY s.created_at) AS prev_signal_type,
           LAG(s.confidence_score) OVER (PARTITION BY s.token_id ORDER BY s.created_at) AS prev_confidence,
           LAG(s.overall_score) OVER (PARTITION BY s.token_id ORDER BY s.created_at) AS prev_overall
         FROM signals s
         JOIN tokens t ON s.token_id = t.id
       )
       SELECT *
       FROM ranked
       WHERE prev_signal_type IS NULL
          OR signal_type <> prev_signal_type
          OR ABS(COALESCE(confidence_score,0) - COALESCE(prev_confidence,0)) > $2
          OR ABS(COALESCE(overall_score,0) - COALESCE(prev_overall,0)) > $3
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit, confidenceThreshold, overallThreshold]
    );

    const data = result.rows.map((row) => ({
      id: row.id,
      signal_type: row.signal_type,
      confidence_score: toNumber(row.confidence_score) ?? 0,
      potential_multiplier: toNumber(row.potential_multiplier),
      reasoning: row.reasoning ?? undefined,
      created_at: row.created_at,
      expires_at: row.expires_at,
      is_active: Boolean(row.is_active),
      overall_score: toNumber(row.overall_score),
      token_id: row.token_id,
      symbol: row.symbol,
      name: row.name,
    }));

    res.json({
      success: true,
      data,
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[Signals] history error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SIGNALS_HISTORY_ERROR',
        message: 'Failed to load signal history',
      },
      timestamp: new Date(),
    });
  }
});

export default router;


