import express, { Request, Response, Router } from 'express';

const router: Router = express.Router();

/**
 * Health checks e status de serviços
 */

// GET /api/health - Health check geral
router.get('/', (req: Request, res: Response) => {
    res.json({
        status: 'healthy',
        service: 'api-gateway',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: {
            used: process.memoryUsage().heapUsed / 1024 / 1024,
            total: process.memoryUsage().heapTotal / 1024 / 1024,
        },
    });
});

// GET /api/health/services - Status de todos os serviços
router.get('/services', async (req: Request, res: Response) => {
    const services = [
        {
            name: 'validator',
            url: process.env.VALIDATOR_SERVICE_URL || 'http://localhost:4001',
        },
        {
            name: 'signal',
            url: process.env.SIGNAL_SERVICE_URL || 'http://localhost:4002',
        },
        {
            name: 'executor',
            url: process.env.EXECUTOR_SERVICE_URL || 'http://localhost:4003',
        },
    ];

    const results = await Promise.all(
        services.map(async (service) => {
            try {
                const response = await fetch(`${service.url}/health`, {
                    signal: AbortSignal.timeout(5000),
                });

                return {
                    name: service.name,
                    status: response.ok ? 'healthy' : 'unhealthy',
                    url: service.url,
                };
            } catch (error) {
                return {
                    name: service.name,
                    status: 'unreachable',
                    url: service.url,
                };
            }
        })
    );

    const allHealthy = results.every((r) => r.status === 'healthy');

    res.status(allHealthy ? 200 : 503).json({
        status: allHealthy ? 'healthy' : 'degraded',
        services: results,
        timestamp: new Date().toISOString(),
    });
});

// GET /api/health/database - Status do banco de dados
router.get('/database', async (req: Request, res: Response) => {
    try {
        // Assumir que pool existe no contexto
        const { pool } = require('../config/database');

        const start = Date.now();
        await pool.query('SELECT NOW()');
        const latency = Date.now() - start;

        const poolStats = {
            total: pool.totalCount,
            idle: pool.idleCount,
            waiting: pool.waitingCount,
        };

        res.json({
            status: 'healthy',
            latency_ms: latency,
            pool: poolStats,
            timestamp: new Date().toISOString(),
        });
    } catch (error: any) {
        res.status(503).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString(),
        });
    }
});

// GET /api/health/ready - Readiness probe (K8s)
router.get('/ready', async (req: Request, res: Response) => {
    try {
        const { pool } = require('../config/database');
        await pool.query('SELECT 1');

        res.json({
            ready: true,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        res.status(503).json({
            ready: false,
            timestamp: new Date().toISOString(),
        });
    }
});

// GET /api/health/live - Liveness probe (K8s)
router.get('/live', (req: Request, res: Response) => {
    res.json({
        alive: true,
        timestamp: new Date().toISOString(),
    });
});

export default router;
