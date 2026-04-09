import { Router, Response, Request } from 'express';
import { Pool } from 'pg';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// Middleware para verificar se o usuário é Administrador
const adminOnly = async (req: AuthRequest, res: Response, next: any) => {
  const userId = req.user?.userId;
  const adminEmail = process.env.ADMIN_EMAIL || 'mulack.zuguenberg@gmail.com';

  if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    const pool: Pool = req.app.get('pool');
    const result = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
    const user = result.rows[0];

    if (!user || user.email !== adminEmail) {
      return res.status(403).json({ success: false, message: 'Access denied. Admin only.' });
    }

    next();
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// GET /api/admin/settings - Listar todas as configurações (com censura em segredos)
router.get('/settings', authenticate, adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const pool: Pool = req.app.get('pool');
    const result = await pool.query('SELECT key, value, description, is_secret, updated_at FROM system_settings ORDER BY key');
    
    const settings = result.rows.map(row => {
      if (row.is_secret && row.value) {
        // Censura a chave: mostra apenas os primeiros 4 e últimos 4 caracteres
        const val = row.value;
        if (val.length > 10) {
          row.value = `${val.substring(0, 4)}...${val.substring(val.length - 4)}`;
        } else {
          row.value = '********';
        }
      }
      return row;
    });

    res.json({ success: true, data: settings });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/admin/settings/:key - Atualizar uma configuração
router.put('/settings/:key', authenticate, adminOnly, async (req: AuthRequest, res: Response) => {
  const { key } = req.params;
  const { value } = req.body;

  if (value === undefined) {
    return res.status(400).json({ success: false, message: 'Value is required' });
  }

  try {
    const pool: Pool = req.app.get('pool');
    const result = await pool.query(
      'UPDATE system_settings SET value = $1, updated_at = NOW() WHERE key = $2 RETURNING *',
      [String(value), key]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Setting not found' });
    }

    // Notificar mudanças via PostgreSQL LISTEN/NOTIFY para o serviço validator escutar
    await pool.query("SELECT pg_notify('settings_changed', $1)", [JSON.stringify({ key, value })]);

    res.json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/users - Performance e lista de usuários
router.get('/users', authenticate, adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const pool: Pool = req.app.get('pool');
    const result = await pool.query('SELECT * FROM user_performance ORDER BY total_profit DESC');
    res.json({ success: true, data: result.rows });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/health - Monitoramento de APIs
router.get('/health', authenticate, adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const pool: Pool = req.app.get('pool');
    const result = await pool.query('SELECT service_name, status, last_error, updated_at FROM service_health ORDER BY service_name');
    res.json({ success: true, data: result.rows });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
