import { Pool } from 'pg';

export class SettingsManager {
  private pool: Pool;
  private cache: Map<string, string> = new Map();
  private lastFetch: number = 0;
  private TTL = 60000; // 1 minuto de cache

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async getSetting(key: string, defaultValue: string = ''): Promise<string> {
    const now = Date.now();
    if (this.cache.has(key) && (now - this.lastFetch < this.TTL)) {
      return this.cache.get(key) || defaultValue;
    }

    await this.refreshCache();
    return this.cache.get(key) || defaultValue;
  }

  async refreshCache() {
    try {
      const result = await this.pool.query('SELECT key, value FROM system_settings');
      this.cache.clear();
      result.rows.forEach(row => {
        this.cache.set(row.key, row.value);
      });
      this.lastFetch = Date.now();
    } catch (error) {
      console.error('[SettingsManager] Error fetching settings:', error);
    }
  }

  setSettingLocal(key: string, value: string) {
    this.cache.set(key, value);
    this.lastFetch = Date.now();
  }
}
