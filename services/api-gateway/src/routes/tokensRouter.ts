import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import { Token, TokenRiskAssessment } from '@shared/types';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);

    const query = await pool.query(
      `SELECT 
         t.*,
         ra.id AS risk_id,
         ra.memecoin_score,
         ra.risk_score,
         ra.scam_probability,
         ra.risk_level,
         ra.indicators,
         ra.created_at AS risk_created_at,
         ra.updated_at AS risk_updated_at
       FROM tokens t
       LEFT JOIN token_risk_assessments ra ON ra.token_id = t.id
       WHERE t.is_validated = true
       ORDER BY t.validated_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const data = query.rows.map(mapTokenRiskRow);

    res.json({
      success: true,
      data,
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[API] List tokens error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to list tokens',
      },
      timestamp: new Date(),
    });
  }
});

router.get('/export', async (req: Request, res: Response) => {
  try {
    const hours = Number(req.query.hours) || 24;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    
    let queryText = `
      SELECT 
         t.id, t.symbol, t.name, t.contract_address, t.chain,
         t.price_usd, t.liquidity_usd, t.volume_24h_usd, t.holders_count,
         t.safety_score, t.is_honeypot, t.validated_at,
         s.signal_type, s.confidence_score, s.reasoning, s.created_at as signal_created_at
       FROM tokens t
       LEFT JOIN signals s ON s.token_id = t.id AND s.is_active = true
       WHERE t.is_validated = true
    `;
    
    const params: any[] = [];
    
    if (startDate && endDate) {
      params.push(startDate, endDate);
      queryText += ` AND t.validated_at BETWEEN $1 AND $2`;
    } else {
      params.push(hours);
      queryText += ` AND t.validated_at >= NOW() - INTERVAL '1 hour' * $1`;
    }
    
    queryText += ` ORDER BY t.validated_at DESC`;

    const query = await pool.query(queryText, params);

    const exportData = {
      exported_at: new Date().toISOString(),
      timeframe_hours: hours,
      total_tokens: query.rowCount,
      tokens: query.rows
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="tokens_export_${Date.now()}.json"`);
    
    // Retornamos raw (sem o padrao de success/data da API web comum) 
    // pois este é um endpoint focado no download do JSON local
    res.send(JSON.stringify(exportData, null, 2));

  } catch (error: any) {
    console.error('[API] Export tokens error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to export tokens' }
    });
  }
});

router.get('/:contractAddress', async (req: Request, res: Response) => {
  try {
    const { contractAddress } = req.params;
    const query = await pool.query(
      `SELECT 
         t.*,
         ra.id AS risk_id,
         ra.memecoin_score,
         ra.risk_score,
         ra.scam_probability,
         ra.risk_level,
         ra.indicators,
         ra.created_at AS risk_created_at,
         ra.updated_at AS risk_updated_at
       FROM tokens t
       LEFT JOIN token_risk_assessments ra ON ra.token_id = t.id
       WHERE LOWER(t.contract_address) = LOWER($1)
       LIMIT 1`,
      [contractAddress]
    );

    if (query.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Token not found',
        },
        timestamp: new Date(),
      });
    }

    const data = mapTokenRiskRow(query.rows[0]);

    res.json({
      success: true,
      data,
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[API] Get token error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to get token details',
      },
      timestamp: new Date(),
    });
  }
});

function mapTokenRiskRow(row: any): { token: Token; risk_assessment: TokenRiskAssessment | null } {
  const {
    risk_id,
    memecoin_score,
    risk_score,
    scam_probability,
    risk_level,
    indicators,
    risk_created_at,
    risk_updated_at,
    ...tokenFields
  } = row;

  let risk: TokenRiskAssessment | null = null;
  if (risk_id) {
    risk = {
      id: risk_id,
      token_id: tokenFields.id,
      contract_address: tokenFields.contract_address,
      chain: tokenFields.chain,
      memecoin_score: Number(memecoin_score),
      risk_score: Number(risk_score),
      scam_probability: Number(scam_probability),
      risk_level,
      indicators,
      created_at: risk_created_at,
      updated_at: risk_updated_at,
    };
  }

  return {
    token: tokenFields as Token,
    risk_assessment: risk,
  };
}

export default router;
