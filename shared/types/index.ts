// ======================================================
// 📝 TIPOS COMPARTILHADOS - TradingBot de Memecoins
// ======================================================

// ======================================================
// 👤 USER TYPES
// ======================================================
export interface User {
  id: string;
  email: string;
  mfa_enabled: boolean;
  is_active: boolean;
  status?: string;
  closed_at?: string;
  profit_loss_usd?: number;
  profit_loss_percent?: number;
  peak_liquidity_usd?: number; // Snapshot of highest liquidity seen
  created_at?: string;
  updated_at?: string;
}

export interface UserProfile {
  id: string;
  user_id: string;
  full_name?: string;
  phone?: string;
  bank_account_number?: string;
  bank_name?: string;
  bank_routing_number?: string;
  wallet_address?: string;
  risk_profile: 'conservative' | 'moderate' | 'aggressive';
  bot_enabled: boolean;
  bot_intensity: number; // 1-10
  kyc_status: 'pending' | 'approved' | 'rejected';
  maxLossPercent: number;
  maxGainPercent: number;
  maxOpenTrades: number;
  trading_strategy: string;
  real_trading_enabled: boolean;
  liquidity_drop_threshold?: number; // Threshold for Safety Lock (e.g., 20)
  createdAt: string;
  updatedAt: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  full_name?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: User;
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

// ======================================================
// 🪙 TOKEN TYPES
// ======================================================
export interface Token {
  id: string;
  contract_address: string;
  chain: string;
  symbol: string;
  name: string;
  decimals: number;
  total_supply?: bigint;
  liquidity_usd?: number;
  liquidity_locked: boolean;
  holders_count: number;
  volume_24h_usd: number;
  price_usd?: number;
  safety_score?: number;
  is_honeypot: boolean;
  is_validated: boolean;
  validated_at?: Date;
  first_seen_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface TokenValidationRequest {
  contract_address: string;
  chain?: string;
  first_seen_at?: number; // Discovery timestamp fallback
}

export interface TokenValidationResponse {
  token: Token;
  validation_result: {
    is_valid: boolean;
    safety_score: number;
    is_honeypot: boolean;
    liquidity_locked: boolean;
    issues: string[];
    is_indexing?: boolean;
  };
  risk_assessment?: TokenRiskAssessment;
}

export type RiskLevel = 'critical' | 'high' | 'moderate' | 'low';

export interface TokenRiskAssessment {
  id?: string;
  token_id?: string;
  contract_address: string;
  chain: string;
  memecoin_score: number; // 0-100
  risk_score: number; // 0-100 (maior = mais seguro)
  scam_probability: number; // 0-100 (maior = mais arriscado)
  risk_level: RiskLevel;
  indicators: Record<string, any>;
  is_indexing?: boolean;
  created_at?: Date;
  updated_at?: Date;
}

// ======================================================
// 📊 SIGNAL TYPES
// ======================================================
export type SignalType = 'BUY' | 'SELL' | 'HOLD';

export interface Signal {
  id: string;
  token_id: string;
  signal_type: SignalType;
  confidence_score?: number;
  potential_multiplier?: number; // 2x, 3x, 4x etc
  volume_score?: number;
  liquidity_score?: number;
  holders_score?: number;
  age_score?: number;
  safety_score?: number;
  overall_score?: number;
  price_at_signal?: number;
  reasoning?: string;
  is_active: boolean;
  expires_at?: Date;
  created_at: Date;
}

export interface SignalAnalysisRequest {
  token_id: string;
}

export interface SignalAnalysisResponse {
  signal: Signal;
  token: Token;
}

// ======================================================
// 💰 ORDER TYPES
// ======================================================
export type OrderType = 'BUY' | 'SELL';
export type OrderStatus = 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled';

export interface Order {
  id: string;
  user_id: string;
  token_id: string;
  signal_id?: string;
  order_type: OrderType;
  status: OrderStatus;
  amount_usd: number;
  amount_token?: number;
  price_usd?: number;
  transaction_hash?: string;
  gas_used?: bigint;
  gas_price?: bigint;
  block_number?: bigint;
  executed_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface ExecuteOrderRequest {
  token_id: string;
  order_type: OrderType;
  amount_usd?: number;
  amount_token?: number;
  signal_id?: string;
}

export interface ExecuteOrderResponse {
  order: Order;
  transaction_hash?: string;
}

export interface Position {
  user_id: string;
  token_id: string;
  symbol: string;
  name: string;
  invested_usd: number;
  token_balance: number;
  avg_buy_price: number;
  current_price?: number;
  trade_count: number;
}

// ======================================================
// 📈 LEDGER TYPES
// ======================================================
export type LedgerEntryType = 'deposit' | 'withdrawal' | 'trade_profit' | 'trade_loss' | 'fee' | 'gas';

export interface LedgerEntry {
  id: string;
  user_id: string;
  order_id?: string;
  entry_type: LedgerEntryType;
  amount_usd: number;
  balance_before?: number;
  balance_after?: number;
  description?: string;
  created_at: Date;
}

// ======================================================
// 🤖 BOT CONFIG TYPES
// ======================================================
export interface BotConfig {
  risk_profile: 'conservative' | 'moderate' | 'aggressive';
  bot_intensity: number; // 1-10
  bot_enabled: boolean;
  max_loss_percent: number;
  max_gain_percent: number;
  max_open_trades: number;
}

export interface BotStatus {
  is_running: boolean;
  active_trades: number;
  total_profit: number;
  total_loss: number;
  last_signal_at?: Date;
}

// ======================================================
// 📊 DASHBOARD TYPES
// ======================================================
export interface DashboardMetrics {
  total_balance: number;
  total_profit: number;
  total_loss: number;
  roi: number; // Return on Investment
  active_positions: number;
  total_trades: number;
  win_rate: number; // Percentage
}

export interface UserPerformance {
  user_id: string;
  email: string;
  total_deposits: number;
  total_withdrawals: number;
  total_profit: number;
  total_loss: number;
  total_trades: number;
  completed_trades: number;
}

// ======================================================
// 🔍 AUDIT LOG TYPES
// ======================================================
export interface AuditLog {
  id: string;
  user_id?: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  ip_address?: string;
  user_agent?: string;
  request_data?: Record<string, any>;
  response_data?: Record<string, any>;
  status_code?: number;
  error_message?: string;
  created_at: Date;
}

// ======================================================
// 🌐 API RESPONSE TYPES
// ======================================================
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: Date;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

// ======================================================
// 🔐 SECURITY TYPES
// ======================================================
export interface JWTPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

export interface EncryptedData {
  encrypted: string;
  iv: string;
}
