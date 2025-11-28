import './config/env';
import express, { Express, Request, Response, NextFunction } from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { Pool } from 'pg';
import authRoutes from './routes/auth';
import tokensRoutes from './routes/tokensRouter';
import profileRoutes from './routes/profileRouter';
import dashboardRoutes from './routes/dashboardRouter';
import botRoutes from './routes/botRouter';
import signalsRoutes from './routes/signals';
import executorRoutes from './routes/executor';
import positionsRoutes from './routes/positions';
import investmentRoutes from './routes/investment';
import notificationsRoutes from './routes/notifications';
import botPerformanceRoutes from './routes/bot-performance';
import cleanupRoutes from './routes/cleanup';
import { PriceUpdateService } from './websocket/price-updates';
import { CleanupScheduler } from './services/cleanup-scheduler';

const app: Express = express();
const PORT = Number(process.env.API_GATEWAY_PORT ?? process.env.PORT ?? 4000);

// Criar servidor HTTP para WebSocket
const server = http.createServer(app);

// Criar pool de conexão do banco
const connectionString = process.env.DATABASE_URL;
const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
    })
  : new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5433'),
      database: process.env.POSTGRES_DB || 'tradingbot',
      user: process.env.POSTGRES_USER || 'botuser',
      password: process.env.POSTGRES_PASSWORD || 'botpass',
      ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });

// Inicializar serviço WebSocket
let priceUpdateService: PriceUpdateService | null = null;

// Inicializar serviço de limpeza automática
let cleanupScheduler: CleanupScheduler | null = null;

// ======================================================
// 🛡️ MIDDLEWARES DE SEGURANÇA
// ======================================================
app.use(helmet({
  // Permitir WebSocket upgrades
  contentSecurityPolicy: false, // Desabilitar CSP que pode interferir com WS
}));
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));

// Rate limiting (não aplicar a requisições WebSocket)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 200, // Aumentar para 200 requisições por IP (era 100)
  message: 'Too many requests from this IP, please try again later.',
  skip: (req) => {
    // Não aplicar rate limit a upgrades WebSocket
    return req.headers.upgrade === 'websocket';
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limit mais permissivo para notificações (já atualiza menos frequentemente no frontend)
const notificationsLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 30, // 30 requisições por minuto para notificações
  message: 'Too many notification requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);
app.use('/api/notifications', notificationsLimiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// ======================================================
// 🏥 HEALTH CHECK
// ======================================================
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'api-gateway',
  });
});

// ======================================================
// 📍 ROTAS
// ======================================================
app.use('/api/auth', authRoutes);
app.use('/api/tokens', tokensRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/bot', botRoutes);
app.use('/api/bot', botPerformanceRoutes); // Rotas de performance do bot
app.use('/api/signals', signalsRoutes);
app.use('/api/executor', executorRoutes);
app.use('/api/positions', positionsRoutes);
app.use('/api/investment', investmentRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/cleanup', cleanupRoutes);

// Rotas de ordens (placeholder)
app.get('/api/orders', (req: Request, res: Response) => {
  res.json({ message: 'Orders routes - to be implemented' });
});

// ======================================================
// ❌ ERROR HANDLER
// ======================================================
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    },
    timestamp: new Date(),
  });
});

// 404 Handler (ignorar requisições WebSocket)
app.use((req: Request, res: Response) => {
  // Ignorar requisições WebSocket - elas serão tratadas pelo WebSocketServer
  if (req.headers.upgrade === 'websocket') {
    return;
  }
  
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found',
    },
    timestamp: new Date(),
  });
});

// ======================================================
// 🚀 SERVER START
// ======================================================
// Inicializar WebSocket ANTES de iniciar o servidor
// Isso garante que o WebSocketServer esteja pronto quando o servidor começar a aceitar conexões
try {
  priceUpdateService = new PriceUpdateService(server, pool);
  console.log('✅ WebSocket service initialized and listening on /ws/prices');
} catch (error: any) {
  console.error('[API Gateway] Failed to initialize WebSocket service:', error.message);
  console.error('[API Gateway] Stack:', error.stack);
}

// Inicializar serviço de limpeza automática (limpa dados antigos a cada 24h)
// Executar apenas após o servidor iniciar para garantir que o banco esteja pronto
try {
  cleanupScheduler = new CleanupScheduler(pool);
  // Não iniciar imediatamente - esperar o servidor estar pronto
  // Será iniciado após o servidor começar a escutar
} catch (error: any) {
  console.error('[API Gateway] Failed to initialize cleanup scheduler:', error.message);
  console.error('[API Gateway] Stack:', error.stack);
}

server.listen(PORT, async () => {
  console.log(`🚀 API Gateway running on port ${PORT}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}/ws/prices`);
  console.log(`📊 Waiting for WebSocket connections...`);
  
  // Iniciar cleanup scheduler após servidor estar pronto
  if (cleanupScheduler) {
    // Aguardar 30 segundos para garantir que o banco esteja pronto e estável
    setTimeout(() => {
      cleanupScheduler!.start(24); // Limpar a cada 24 horas
      console.log('✅ Cleanup scheduler started - will cleanup old data every 24 hours');
      
      // Executar primeira limpeza após 1 minuto (banco já deve estar pronto)
      setTimeout(() => {
        console.log('[Cleanup Scheduler] 🧹 Running initial cleanup...');
        cleanupScheduler!.cleanupOldData();
      }, 60000);
    }, 30000);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  if (priceUpdateService) {
    priceUpdateService.close();
  }
  if (cleanupScheduler) {
    cleanupScheduler.stop();
  }
  pool.end();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;
