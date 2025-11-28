import { Router, Response } from 'express';
import axios from 'axios';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

const EXECUTOR_SERVICE_URL = process.env.EXECUTOR_SERVICE_URL || 'http://localhost:4003';

// GET /api/investment/calculate/:tokenId - Calcula investimento pretendido baseado em confiança
router.get('/calculate/:tokenId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { tokenId } = req.params;
    const { signal_id } = req.query;

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

    // Encaminhar para o Executor Service
    const executorResponse = await axios.get(
      `${EXECUTOR_SERVICE_URL}/calculate-investment/${tokenId}${signal_id ? `?signal_id=${signal_id}` : ''}`,
      {
        headers: {
          'X-User-Id': userId,
        },
        timeout: 5000,
      }
    );

    res.json({
      success: true,
      data: executorResponse.data.data,
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('[Investment] calculate error:', error);
    if (error.response) {
      res.status(error.response.status).json({
        success: false,
        error: {
          code: 'INVESTMENT_CALCULATION_ERROR',
          message: error.response.data?.error?.message || 'Failed to calculate intended investment',
        },
        timestamp: new Date(),
      });
    } else {
      res.status(500).json({
        success: false,
        error: {
          code: 'INVESTMENT_CALCULATION_ERROR',
          message: error.message || 'Failed to calculate intended investment',
        },
        timestamp: new Date(),
      });
    }
  }
});

export default router;

