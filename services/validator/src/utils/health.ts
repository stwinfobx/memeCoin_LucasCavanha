import { Pool } from 'pg';

export type ServiceName = 'HELIUS' | 'GOPLUS' | 'GECKO' | 'SOLSCAN';
export type ServiceStatus = 'online' | 'error' | 'rate_limited';

export class HealthTracker {
  private pool: Pool | null = null;
  private cache: Map<ServiceName, { status: ServiceStatus, lastError: string | null }> = new Map();
  private debounceTimeouts: Map<ServiceName, NodeJS.Timeout> = new Map();

  constructor(pool?: Pool) {
    if (pool) this.pool = pool;
  }

  setPool(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Reporta que o serviço está funcionando normalmente.
   * Evita gravações excessivas no banco de dados.
   */
  async reportSuccess(service: ServiceName) {
    const cached = this.cache.get(service);
    if (!cached || cached.status !== 'online') {
      this.cache.set(service, { status: 'online', lastError: null });
      this.scheduleUpdate(service, 'online', null);
    }
  }

  /**
   * Reporta um erro no serviço.
   */
  async reportError(service: ServiceName, error: Error | string, isRateLimit: boolean = false) {
    const errorMessage = error instanceof Error ? error.message : error;
    const newStatus: ServiceStatus = isRateLimit ? 'rate_limited' : 'error';
    
    // Simplificar a mensagem para caber melhor no front-end
    const truncatedMessage = errorMessage.substring(0, 255);

    this.cache.set(service, { status: newStatus, lastError: truncatedMessage });
    this.scheduleUpdate(service, newStatus, truncatedMessage);
  }

  private scheduleUpdate(service: ServiceName, status: ServiceStatus, lastError: string | null) {
    if (this.debounceTimeouts.has(service)) {
      clearTimeout(this.debounceTimeouts.get(service)!);
    }

    const timeout = setTimeout(async () => {
      if (!this.pool) return;
      try {
        await this.pool.query(
          `INSERT INTO service_health (service_name, status, last_error) 
           VALUES ($1, $2, $3)
           ON CONFLICT (service_name) DO UPDATE 
           SET status = EXCLUDED.status, last_error = EXCLUDED.last_error, updated_at = CURRENT_TIMESTAMP`,
          [service, status, lastError]
        );
      } catch (err) {
        console.error(`[HealthTracker] Failed to update health for ${service}:`, err);
      }
      this.debounceTimeouts.delete(service);
    }, 1000); // 1 sec debounce

    this.debounceTimeouts.set(service, timeout);
  }
}

export const healthTracker = new HealthTracker();

