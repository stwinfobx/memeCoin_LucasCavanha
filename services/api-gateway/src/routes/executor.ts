import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import axios from 'axios';
import { ExecuteOrderRequest } from '@shared/types';

const router = Router();

const EXECUTOR_BASE_URL = process.env.EXECUTOR_SERVICE_URL || 'http://localhost:4003';
const EXECUTOR_TIMEOUT = Number(process.env.EXECUTOR_REQUEST_TIMEOUT_MS || 5000);

router.post('/buy', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid user context' },
        timestamp: new Date(),
      });
    }

    const payload: ExecuteOrderRequest = req.body;

    const response = await axios.post(
      `${EXECUTOR_BASE_URL}/execute/buy`,
      payload,
      {
        timeout: EXECUTOR_TIMEOUT,
        headers: {
          'x-user-id': userId,
        },
      }
    );

    res.json({
      success: true,
      data: response.data.data,
      timestamp: new Date(),
    });
  } catch (error: any) {
    const status = error?.response?.status || 500;
    const message = error?.response?.data?.error?.message || error?.message || 'Failed to simulate buy order';
    console.error('[Executor] buy error:', message);
    res.status(status).json({
      success: false,
      error: { code: 'EXECUTOR_BUY_ERROR', message },
      timestamp: new Date(),
    });
  }
});

router.post('/sell', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid user context' },
        timestamp: new Date(),
      });
    }

    const payload: ExecuteOrderRequest = req.body;

    const response = await axios.post(
      `${EXECUTOR_BASE_URL}/execute/sell`,
      payload,
      {
        timeout: EXECUTOR_TIMEOUT,
        headers: {
          'x-user-id': userId,
        },
      }
    );

    res.json({
      success: true,
      data: response.data.data,
      timestamp: new Date(),
    });
  } catch (error: any) {
    const status = error?.response?.status || 500;
    const message = error?.response?.data?.error?.message || error?.message || 'Failed to simulate sell order';
    console.error('[Executor] sell error:', message);
    res.status(status).json({
      success: false,
      error: { code: 'EXECUTOR_SELL_ERROR', message },
      timestamp: new Date(),
    });
  }
});

router.get('/positions', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid user context' },
        timestamp: new Date(),
      });
    }

    const response = await axios.get(`${EXECUTOR_BASE_URL}/positions`, {
      timeout: EXECUTOR_TIMEOUT,
      headers: {
        'x-user-id': userId,
      },
    });

    res.json({
      success: true,
      data: response.data.data,
      timestamp: new Date(),
    });
  } catch (error: any) {
    const status = error?.response?.status || 500;
    const message = error?.response?.data?.error?.message || error?.message || 'Failed to load positions';
    console.error('[Executor] positions error:', message);
    res.status(status).json({
      success: false,
      error: { code: 'EXECUTOR_POSITIONS_ERROR', message },
      timestamp: new Date(),
    });
  }
});

export default router;
