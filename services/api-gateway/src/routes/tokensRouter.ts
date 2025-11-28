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
