import { WebSocket, WebSocketServer } from 'ws';
import { Pool } from 'pg';
import axios from 'axios';
import jwt from 'jsonwebtoken';

const GECKO_API_URL = process.env.GECKOTERMINAL_BASE_URL || 'https://api.geckoterminal.com/api/v2';
const GECKO_HEADERS = {
  'User-Agent': 'TradingBotWebSocket/1.0',
  'Accept': 'application/json',
};

interface PriceUpdate {
  tokenId: string;
  symbol: string;
  priceUsd: number;
  priceChange24h?: number;
  priceChangePercent?: number;
  timestamp: number;
}

export class PriceUpdateService {
  private wss: WebSocketServer;
  private pool: Pool;
  private clients: Map<WebSocket, string> = new Map(); // WebSocket -> userId
  private priceUpdateInterval: NodeJS.Timeout | null = null;

  constructor(server: any, pool: Pool) {
    this.pool = pool;
    // Não usar o parâmetro 'server' no construtor do WebSocketServer
    // Vamos criar o WebSocketServer sem servidor e usar handleUpgrade manualmente
    this.wss = new WebSocketServer({
      noServer: true, // Criar sem servidor - vamos gerenciar upgrades manualmente
    });

    this.wss.on('connection', (ws: WebSocket, req) => {
      console.log('[WebSocket] Connection event fired');
      this.handleConnection(ws, req);
    });

    // Handler de upgrade manual - capturar upgrades do servidor HTTP
    // IMPORTANTE: Registrar ANTES do servidor começar a aceitar conexões
    server.on('upgrade', (request: any, socket: any, head: any) => {
      try {
        console.log('[WebSocket] Upgrade request received:', request.url);
        const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost:4000'}`);

        console.log('[WebSocket] Parsed pathname:', url.pathname);

        if (url.pathname === '/ws/prices') {
          console.log('[WebSocket] Accepting upgrade for /ws/prices');
          this.wss.handleUpgrade(request, socket, head, (ws) => {
            console.log('[WebSocket] Upgrade successful, emitting connection event');
            this.wss.emit('connection', ws, request);
          });
        } else {
          console.log(`[WebSocket] Rejecting upgrade for path: ${url.pathname}`);
          socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
          socket.destroy();
        }
      } catch (error: any) {
        console.error('[WebSocket] Error handling upgrade:', error.message);
        console.error('[WebSocket] Stack:', error.stack);
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.destroy();
      }
    });

    // Iniciar atualização de preços (a cada 30 segundos por padrão para evitar 429)
    const updateInterval = Number(process.env.PRICE_UPDATE_INTERVAL_MS ?? 30000);
    this.priceUpdateInterval = setInterval(() => {
      this.broadcastPriceUpdates();
    }, updateInterval);

    this.setupDatabaseListeners();

    console.log(`📡 WebSocket price update service started (interval: ${updateInterval / 1000}s)`);
  }

  private async setupDatabaseListeners() {
    try {
      const client = await this.pool.connect();
      await client.query('LISTEN new_token_scanned');
      client.on('notification', (msg) => {
        if (msg.channel === 'new_token_scanned' && msg.payload) {
          try {
            const data = JSON.parse(msg.payload);
            const message = JSON.stringify({
              type: 'new_token_scanned',
              data,
              timestamp: Date.now()
            });

            for (const [ws] of this.clients.entries()) {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(message);
              }
            }
          } catch (e) {
            console.error('[WebSocket] Error parsing notification payload', e);
          }
        }
      });
      console.log('📡 Listening for new_token_scanned events from DB');
    } catch (err) {
      console.error('❌ Failed to setup DB listeners:', err);
    }
  }

  private handleConnection(ws: WebSocket, req: any): void {
    console.log('[WebSocket] New connection attempt...');

    // Extrair token JWT da query string
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost:4000'}`);
    const token = url.searchParams.get('token');

    if (!token) {
      console.warn('[WebSocket] Connection rejected: no token provided');
      ws.close(1008, 'Authentication required');
      return;
    }

    // Verificar token JWT
    try {
      const JWT_SECRET = process.env.JWT_SECRET;
      if (!JWT_SECRET) {
        throw new Error('JWT_SECRET not configured');
      }

      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const userId = decoded.userId || decoded.id;

      if (!userId) {
        console.warn('[WebSocket] Connection rejected: invalid token');
        ws.close(1008, 'Invalid token');
        return;
      }

      this.clients.set(ws, userId);
      console.log(`[WebSocket] Client connected: userId=${userId}, total clients: ${this.clients.size}`);

      ws.on('message', (message: Buffer) => {
        try {
          const data = JSON.parse(message.toString());
          if (data.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          }
        } catch (error) {
          console.error('[WebSocket] Error parsing message:', error);
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log(`[WebSocket] Client disconnected, total clients: ${this.clients.size}`);
      });

      ws.on('error', (error) => {
        console.error('[WebSocket] Client error:', error);
        this.clients.delete(ws);
      });

      // Enviar mensagem de boas-vindas
      ws.send(
        JSON.stringify({
          type: 'connected',
          message: 'Connected to price update stream',
          timestamp: Date.now(),
        })
      );
    } catch (error: any) {
      console.error('[WebSocket] Authentication error:', error.message);
      // Verificar se o erro é de token expirado
      if (error.name === 'TokenExpiredError' || error.message.includes('expired')) {
        ws.close(1008, '401 Unauthorized: Token expired');
      } else if (error.name === 'JsonWebTokenError') {
        ws.close(1008, '401 Unauthorized: Invalid token');
      } else {
        ws.close(1008, 'Authentication failed');
      }
    }
  }

  private async broadcastPriceUpdates(): Promise<void> {
    // IMPORTANTE: Atualizar preços mesmo se não houver clientes conectados
    // Isso garante que o banco tenha preços atualizados para o monitoramento de posições
    try {
      // Buscar tokens com sinais ativos ou posições abertas
      const tokensResult = await this.pool.query(
        `SELECT DISTINCT t.id, t.symbol, t.contract_address, t.chain, t.price_usd
         FROM tokens t
         WHERE EXISTS (
           SELECT 1 FROM signals s WHERE s.token_id = t.id AND s.is_active = true
         ) OR EXISTS (
           SELECT 1 FROM positions p WHERE p.token_id = t.id AND p.status = 'open'
         )
         LIMIT 100`
      );

      const tokens = tokensResult.rows;
      if (tokens.length === 0) {
        return;
      }

      // Buscar preços atualizados via GeckoTerminal (usando endpoint MULTI para evitar 429)
      const updates: PriceUpdate[] = [];
      const network = 'bsc'; // Default
      const batchSize = 30; // GeckoTerminal multi endpoint suporta até 30 endereços

      for (let i = 0; i < tokens.length; i += batchSize) {
        const batch = tokens.slice(i, i + batchSize);
        const addresses = batch.map(t => t.contract_address).join(',');

        try {
          const response = await axios.get(
            `${GECKO_API_URL}/networks/${network}/tokens/multi/${addresses}`,
            {
              headers: GECKO_HEADERS,
              timeout: 10000,
            }
          );

          const tokenList = response.data?.data || [];

          for (const tokenData of tokenList) {
            const address = tokenData.attributes?.address?.toLowerCase();
            const originalToken = batch.find(t => t.contract_address.toLowerCase() === address);

            if (originalToken && tokenData.attributes?.price_usd) {
              const newPrice = Number(tokenData.attributes.price_usd);
              const oldPrice = Number(originalToken.price_usd ?? 0);
              const priceChange = oldPrice > 0 ? ((newPrice - oldPrice) / oldPrice) * 100 : 0;

              updates.push({
                tokenId: originalToken.id,
                symbol: originalToken.symbol,
                priceUsd: newPrice,
                priceChangePercent: priceChange,
                timestamp: Date.now(),
              });

              // Atualizar preço no banco
              await this.pool.query('UPDATE tokens SET price_usd = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [
                newPrice,
                originalToken.id,
              ]);
            }
          }

          // Pequeno delay entre batches para evitar rate limit
          if (tokens.length > batchSize) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } catch (error: any) {
          console.error(`[WebSocket] Failed to update prices for batch ${i}:`, error.message);
        }
      }

      // Broadcast para todos os clientes conectados
      if (updates.length > 0) {
        const message = JSON.stringify({
          type: 'price_update',
          updates,
          timestamp: Date.now(),
        });

        for (const [ws] of this.clients.entries()) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
          }
        }
      }
    } catch (error: any) {
      console.error('[WebSocket] Error broadcasting price updates:', error);
    }
  }

  public get wssInstance(): WebSocketServer {
    return this.wss;
  }

  public close(): void {
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
    }
    this.wss.close();
  }
}

