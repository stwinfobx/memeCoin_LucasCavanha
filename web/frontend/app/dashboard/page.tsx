'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '../contexts/AuthContext'
import BalanceDisplay from '../../components/BalanceDisplay'
import InsufficientBalanceModal from '../../components/InsufficientBalanceModal'

type DashboardSummary = {
  balance: number
  totalProfit: number
  totalLoss: number
  roi: number
  totalTrades: number
  completedTrades: number
  validatedTokens: number
  highRiskTokens: number
  lowRiskTokens: number
}

type DashboardData = {
  summary: DashboardSummary
  positions: Array<{
    token_id: string
    symbol: string
    name: string
    invested_usd: number
    token_balance: number
    avg_buy_price: number
    current_price: number
    trade_count: number
  }>
  signals: Array<{
    id: string
    token_id: string
    signal_type: string
    confidence_score: number
    potential_multiplier?: number
    reasoning?: string
    created_at: string
    symbol: string
    name: string
    price_usd: number
    liquidity_usd?: number
    volume_24h_usd?: number
    contract_address?: string
    chain?: string
  }>
  recentOrders: Array<{
    id: string
    order_type: 'BUY' | 'SELL'
    status: string
    amount_usd: number
    amount_token: number
    price_usd: number
    created_at: string
    executed_at: string | null
    symbol: string
    name: string
  }>
}

type BotStatus = {
  bot_enabled: boolean
  bot_intensity: number
  risk_profile: 'conservative' | 'moderate' | 'aggressive'
  max_loss_percent: number
  max_gain_percent: number
  max_open_trades: number
} | null

type TokenFeedItem = {
  contract: string
  symbol: string
  name: string
  priceUsd: number
  liquidityUsd: number
  volume24hUsd: number
  safetyScore?: number | null
  scamProbability?: number | null
  riskLevel?: 'critical' | 'high' | 'moderate' | 'low' | null
  validatedAt?: string | null
  chain?: string | null
}

const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

const formatCurrency = (value: number | null | undefined) => {
  if (value === null || value === undefined) return null;
  const val = value;

  // Para valores muito baixos (< 0.001) mostrar mais casas decimais
  if (val > 0 && val < 0.1) {
    return `US$ ${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 12 })}`;
  }

  return Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(val);
}

const IndexingBadge = () => (
  <span className="inline-flex items-center gap-1 text-[10px] text-amber-400/80 animate-pulse">
    <span className="w-1.5 h-1.5 rounded-full bg-amber-400/60"></span>
    Indexando...
  </span>
)

const formatPercent = (value: number | null | undefined) =>
  `${Number(value ?? 0).toFixed(2)}%`

const statusColorMap: Record<string, string> = {
  completed: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  pending: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  executing: 'border-purple-400/40 bg-purple-400/10 text-purple-200',
  failed: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  cancelled: 'border-neutral-600/50 bg-neutral-700/20 text-neutral-300',
}

const riskBadgeStyles: Record<NonNullable<TokenFeedItem['riskLevel']>, { label: string; className: string; blurb: string }> = {
  critical: {
    label: 'Crítico',
    className: 'bg-rose-500/10 border border-rose-500/40 text-rose-200',
    blurb: 'Exposição incompatível com o perfil de risco. Monitorar e considerar saída imediata.',
  },
  high: {
    label: 'Alto risco',
    className: 'bg-amber-500/10 border border-amber-500/40 text-amber-200',
    blurb: 'Volatilidade elevada e sinais adversos. Operar apenas com capital tático.',
  },
  moderate: {
    label: 'Moderado',
    className: 'bg-sky-500/10 border border-sky-500/40 text-sky-200',
    blurb: 'Risco dentro dos parâmetros, demanda acompanhamento próximo.',
  },
  low: {
    label: 'Baixo risco',
    className: 'bg-emerald-500/10 border border-emerald-500/40 text-emerald-200',
    blurb: 'Liquidez e métricas consistentes. Adequado para posicionamento controlado.',
  },
}

export default function DashboardPage() {
  const router = useRouter()
  const { token, isAuthenticated, isLoading, logout, user } = useAuth()
  const [data, setData] = useState<DashboardData | null>(null)
  const [botStatus, setBotStatus] = useState<BotStatus>(null)
  const [tokenFeed, setTokenFeed] = useState<TokenFeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [botActionLoading, setBotActionLoading] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false)
  const [showBalanceModal, setShowBalanceModal] = useState(false)

  const userFirstLetter = useMemo(() => user?.email?.[0]?.toUpperCase() ?? 'U', [user?.email])

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/auth/login')
    }
  }, [isAuthenticated, isLoading, router])

  useEffect(() => {
    if (!token) return

    const controller = new AbortController()

    async function fetchDashboard() {
      setLoading(true)
      setError(null)
      try {
        const [summaryResponse, botResponse] = await Promise.all([
          fetch(`${apiBase}/api/dashboard/summary`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          }),
          fetch(`${apiBase}/api/bot/status`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          }),
        ])

        if (!summaryResponse.ok) {
          const errorBody = await summaryResponse.json().catch(() => ({}))
          // Se for 401 (token expirado), redirecionar para login
          if (summaryResponse.status === 401) {
            console.warn('[Dashboard] Token expirado ou inválido, redirecionando para login...')
            logout()
            router.push('/auth/login')
            return
          }
          throw new Error(errorBody?.error?.message || 'Falha ao carregar dashboard')
        }

        const summaryData = await summaryResponse.json()
        setData(summaryData.data)
        setLastUpdate(new Date())

        if (botResponse.ok) {
          const botData = await botResponse.json()
          setBotStatus(botData.data)
        } else if (botResponse.status === 401) {
          // Se for 401 (token expirado), redirecionar para login
          console.warn('[Dashboard] Token expirado ou inválido, redirecionando para login...')
          logout()
          router.push('/auth/login')
          return
        }

        const tokensResponse = await fetch(`${apiBase}/api/tokens?limit=20`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })
        if (tokensResponse.ok) {
          const tokensJson = await tokensResponse.json()
          const parsed: TokenFeedItem[] = (tokensJson.data ?? []).map((item: any) => ({
            contract: item.token.contract_address,
            symbol: item.token.symbol ?? 'TOKEN',
            name: item.token.name ?? 'Memecoin sem nome',
            priceUsd: Number(item.token.price_usd ?? 0),
            liquidityUsd: Number(item.token.liquidity_usd ?? 0),
            volume24hUsd: Number(item.token.volume_24h_usd ?? 0),
            memecoinScore: item.risk_assessment?.memecoin_score ?? null,
            scamProbability: item.risk_assessment?.scam_probability ?? null,
            riskLevel: item.risk_assessment?.risk_level ?? null,
            validatedAt: item.token.validated_at ?? null,
          }))
          setTokenFeed(parsed)
        } else if (tokensResponse.status === 401) {
          // Se for 401 (token expirado), redirecionar para login
          console.warn('[Dashboard] Token expirado ou inválido, redirecionando para login...')
          logout()
          router.push('/auth/login')
          return
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return
        console.error('[Dashboard] fetch error:', err)
        setError(err.message || 'Não foi possível carregar as informações do dashboard.')
      } finally {
        setLoading(false)
      }
    }

    fetchDashboard()
    return () => controller.abort()
  }, [token])

  // Auto-refresh a cada 30 segundos
  useEffect(() => {
    if (!token || loading) return

    const interval = setInterval(async () => {
      setIsAutoRefreshing(true)
      try {
        const summaryRes = await fetch(`${apiBase}/api/dashboard/summary`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (summaryRes.ok) {
          const summaryJson = await summaryRes.json()
          setData(summaryJson.data)
          setLastUpdate(new Date())
        }
      } catch (err) {
        console.error('[Dashboard] Auto-refresh error:', err)
      } finally {
        setIsAutoRefreshing(false)
      }
    }, 30000) // 30 segundos

    return () => clearInterval(interval)
  }, [token, loading])

  const handleRefresh = async () => {
    if (!token) return
    try {
      setLoading(true)
      const [summaryRes, tokensRes] = await Promise.all([
        fetch(`${apiBase}/api/dashboard/summary`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${apiBase}/api/tokens?limit=20`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ])

      if (!summaryRes.ok) {
        if (summaryRes.status === 401) {
          // Se for 401 (token expirado), redirecionar para login
          console.warn('[Dashboard] Token expirado ou inválido, redirecionando para login...')
          logout()
          router.push('/auth/login')
          return
        }
        throw new Error('Erro ao atualizar dashboard')
      }
      const summaryJson = await summaryRes.json()
      setData(summaryJson.data)
      setLastUpdate(new Date())

      if (tokensRes.ok) {
        const tokensJson = await tokensRes.json()
        const parsed: TokenFeedItem[] = (tokensJson.data ?? []).map((item: any) => ({
          contract: item.token.contract_address,
          symbol: item.token.symbol ?? 'TOKEN',
          name: item.token.name ?? 'Memecoin sem nome',
          priceUsd: Number(item.token.price_usd ?? 0),
          liquidityUsd: Number(item.token.liquidity_usd ?? 0),
          volume24hUsd: Number(item.token.volume_24h_usd ?? 0),
          safetyScore: item.risk_assessment?.risk_score ?? null,
          scamProbability: item.risk_assessment?.scam_probability ?? null,
          riskLevel: item.risk_assessment?.risk_level ?? null,
          validatedAt: item.token.validated_at ?? null,
          chain: item.token.chain ?? null,
        }))
        setTokenFeed(parsed)
      } else if (tokensRes.status === 401) {
        // Se for 401 (token expirado), redirecionar para login
        console.warn('[Dashboard] Token expirado ou inválido, redirecionando para login...')
        logout()
        router.push('/auth/login')
        return
      }
    } catch (err: any) {
      setError(err.message || 'Falha ao atualizar dados.')
    } finally {
      setLoading(false)
    }
  }

  const toggleBot = async () => {
    if (!token || !botStatus) return

    // Bloquear se for iniciar e não tiver saldo
    if (!botStatus.bot_enabled) {
      const currentBalance = data?.summary.balance || 0;
      if (currentBalance <= 0) {
        setShowBalanceModal(true);
        return;
      }
    }

    setBotActionLoading(true)
    try {
      const endpoint = botStatus.bot_enabled ? 'stop' : 'start'
      const response = await fetch(`${apiBase}/api/bot/${endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) {
        if (response.status === 401) {
          // Se for 401 (token expirado), redirecionar para login
          console.warn('[Dashboard] Token expirado ou inválido, redirecionando para login...')
          logout()
          router.push('/auth/login')
          return
        }
        throw new Error('Falha ao alterar status do bot.')
      }
      const json = await response.json()
      setBotStatus((prev) =>
        prev
          ? {
            ...prev,
            bot_enabled: json.data.bot_enabled,
          }
          : {
            bot_enabled: json.data.bot_enabled,
            bot_intensity: json.data.bot_intensity ?? 5,
            risk_profile: 'moderate',
            max_gain_percent: 25,
            max_loss_percent: 10,
            max_open_trades: 3,
          }
      )
    } catch (err: any) {
      setError(err.message || 'Erro ao alterar status do bot.')
    } finally {
      setBotActionLoading(false)
    }
  }

  const loadingState = loading || isLoading

  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <header className="flex flex-wrap items-center justify-between gap-6 border-b border-neutral-900 pb-8">
          <div>
            <span className="section-title">Painel</span>
            <h1 className="mt-3 text-3xl font-semibold text-neutral-50">Monitoramento operacional</h1>
            <p className="mt-2 text-sm text-neutral-500">
              Acompanhe indicadores de risco, sinais e execução em tempo real.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {lastUpdate && (
              <div className="flex items-center gap-2 px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-xs">
                <span className="text-neutral-500">Atualizado</span>
                <span className="font-mono text-neutral-300">
                  {lastUpdate.toLocaleTimeString('pt-BR')}
                </span>
                {isAutoRefreshing && (
                  <span className="text-purple-400 animate-pulse font-bold">●</span>
                )}
              </div>
            )}
            <Link
              href="/deposit"
              className="btn-primary px-4 py-2 text-sm flex items-center gap-2"
            >
              Depositar Fundos
            </Link>
            <button onClick={handleRefresh} className="btn-secondary px-4 py-2 text-sm">
              Atualizar
            </button>
            <div className="badge">
              <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
              <span>Serviços conectados</span>
            </div>
            <div className="flex items-center gap-3 rounded-full border border-neutral-800 bg-neutral-900 px-3 py-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-neutral-800 text-sm font-semibold text-neutral-200">
                {userFirstLetter}
              </span>
              <div className="flex flex-col text-xs text-neutral-400">
                <span className="font-medium text-neutral-200">{user?.email}</span>
                <button onClick={logout} className="text-neutral-400 hover:text-neutral-200">
                  Sair
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Informação sobre fuso horário */}
        <div className="mt-4 text-[10px] text-neutral-600 uppercase tracking-widest text-right">
          Exibindo horários em GMT-3 (Brasília)
        </div>

        {error && (
          <div className="surface-strong mt-8 border border-rose-500/40 px-5 py-4 text-sm text-rose-200">
            {error}
          </div>
        )}

        {/* Saldo Real - NOVO */}
        <section className="mt-10">
          <BalanceDisplay />
        </section>


        {/* Últimos Trades - REMOVIDO */}

        <section className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: 'Saldo Atual',
              value: formatCurrency(data?.summary.balance),
              link: '/bot-performance',
              color: 'text-neutral-50'
            },
            {
              label: 'Lucro Total',
              value: formatCurrency(data?.summary.totalProfit),
              color: data?.summary.totalProfit && data.summary.totalProfit > 0 ? 'text-emerald-400' : 'text-neutral-50'
            },
            {
              label: 'Perda Total',
              value: formatCurrency(data?.summary.totalLoss),
              color: data?.summary.totalLoss && data.summary.totalLoss > 0 ? 'text-rose-400' : 'text-neutral-50'
            },
            {
              label: 'ROI',
              value: formatPercent(data?.summary.roi),
              color: data?.summary.roi && data.summary.roi > 0 ? 'text-emerald-400' : data?.summary.roi && data.summary.roi < 0 ? 'text-rose-400' : 'text-neutral-50',
              link: '/bot-performance'
            },
            { label: 'Tokens validados', value: data?.summary.validatedTokens?.toLocaleString('pt-BR') ?? '0' },
            { label: 'Tokens baixo risco', value: data?.summary.lowRiskTokens?.toLocaleString('pt-BR') ?? '0' },
            { label: 'Tokens alto risco', value: data?.summary.highRiskTokens?.toLocaleString('pt-BR') ?? '0' },
            { label: 'Trades completados', value: data?.summary.completedTrades?.toLocaleString('pt-BR') ?? '0' },
          ].map((metric) => (
            <div
              key={metric.label}
              className={`surface p-6 ${metric.link ? 'cursor-pointer hover:border-purple-500/40 transition-all' : ''}`}
              onClick={metric.link ? () => router.push(metric.link!) : undefined}
            >
              <span className="section-title">{metric.label}</span>
              <p className={`mt-3 text-2xl font-semibold ${metric.color || 'text-neutral-50'}`}>
                {loadingState ? '•••' : metric.value}
              </p>
              {metric.link && (
                <p className="mt-2 text-xs text-purple-400">Clique para ver detalhes</p>
              )}
            </div>
          ))}
        </section>

        <section className="mt-10 grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="surface-strong xl:col-span-2 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-neutral-100">Histórico Recente (Elite Scored)</h2>
              <div className="flex items-center gap-3">
                <Link href="/bot-performance" className="text-sm text-emerald-300 hover:text-emerald-200">
                  Ver performance
                </Link>
                <Link href="/notifications" className="text-sm text-sky-300 hover:text-sky-200">
                  Ver logs
                </Link>
                <Link href="/signals" className="text-sm text-purple-300 hover:text-purple-200">
                  Ver todos
                </Link>
              </div>
            </div>
            <div className="mt-6 space-y-4 small-scrollbar max-h-[360px] overflow-y-auto pr-1">
              {loadingState && <p className="text-sm text-neutral-500">Carregando sinais...</p>}
              {(() => {
                const eliteSignals = data?.signals.filter(s => {
                  const score = s.confidence_score || 0;
                  const isBuy = s.signal_type === 'BUY';
                  const ageMs = Date.now() - new Date(s.created_at).getTime();
                  return score >= 80 && isBuy && ageMs < 60 * 60 * 1000;
                }) || [];
                
                if (!loadingState && eliteSignals.length === 0) {
                  return <p className="text-sm text-neutral-600">Nenhum sinal de elite recente (Score {'>'}= 80, COMPRA, {'<'}1h).</p>;
                }
                
                return eliteSignals.map((signal) => (
                  <div key={signal.id} className="surface border-neutral-800 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-neutral-200">{signal.symbol}</p>
                        <p className="text-xs text-neutral-500">{signal.name}</p>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-neutral-400">
                        <span className="badge border-purple-400/30 bg-purple-400/10 text-purple-200">
                          {signal.signal_type}
                        </span>
                        <div className="text-right">
                          <p className="text-xs text-neutral-500">Confiança</p>
                          <p className="text-sm font-semibold text-neutral-100">{signal.confidence_score}%</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-neutral-500">Multiplicador</p>
                          <p className="text-sm font-semibold text-neutral-100">
                            {signal.potential_multiplier ? `${signal.potential_multiplier.toFixed(2)}x` : '—'}
                          </p>
                        </div>
                      </div>
                    </div>
                    {signal.reasoning && (
                      <p className="mt-3 text-sm text-neutral-400 leading-relaxed">{signal.reasoning}</p>
                    )}
                    <div className="mt-4 flex flex-wrap gap-4 text-xs text-neutral-500">
                      <span>Cotação: {formatCurrency(signal.price_usd)}</span>
                      <span>Emitido em: {(() => {
                        const d = new Date(signal.created_at);
                        d.setHours(d.getHours() - 3); // Forçar fuso horário de Brasília (-3h)
                        return d.toLocaleString('pt-BR');
                      })()}</span>
                      {(signal.contract_address || signal.token_id) && (
                        <Link
                          href={`https://dexscreener.com/${signal.chain?.toLowerCase() || 'solana'}/${signal.contract_address || signal.token_id}`}
                          className="text-emerald-400 hover:text-emerald-300 font-medium"
                          target="_blank"
                        >
                          DexScreener ↗
                        </Link>
                      )}
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>

          <div className="surface-strong p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-neutral-100">Status do bot</h2>
              <span
                className={`h-2 w-2 rounded-full ${botStatus?.bot_enabled ? 'bg-emerald-400' : 'bg-rose-400'}`}
                aria-hidden="true"
              />
            </div>
            {loadingState ? (
              <p className="mt-6 text-sm text-neutral-500">Carregando status...</p>
            ) : (
              <>
                <dl className="mt-6 space-y-3 text-sm text-neutral-300">
                  <div className="flex justify-between">
                    <dt>Modo</dt>
                    <dd>{botStatus?.bot_enabled ? 'Ativo' : 'Inativo'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Intensidade</dt>
                    <dd>{botStatus?.bot_intensity ?? '—'}/10</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Perfil de risco</dt>
                    <dd className="capitalize">{botStatus?.risk_profile ?? 'não definido'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Perda máxima</dt>
                    <dd>{botStatus ? `${botStatus.max_loss_percent}%` : '—'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Ganho máximo</dt>
                    <dd>{botStatus ? `${botStatus.max_gain_percent}%` : '—'}</dd>
                  </div>
                  <div className="flex justify-between border-t border-neutral-700 pt-3">
                    <dt className="font-medium">Posições Abertas</dt>
                    <dd className="flex items-center gap-2">
                      <span className={`font-mono font-semibold ${data && data.positions && botStatus && data.positions.length >= (botStatus.max_open_trades || 5)
                        ? 'text-amber-400'
                        : 'text-neutral-300'
                        }`}>
                        {data?.positions?.length || 0} / {botStatus?.max_open_trades || '—'}
                      </span>
                      {data && data.positions && botStatus && data.positions.length >= (botStatus.max_open_trades || 5) && (
                        <span className="text-xs bg-amber-500/20 border border-amber-500/40 text-amber-300 px-2 py-0.5 rounded">
                          LIMITE
                        </span>
                      )}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Trades paralelos</dt>
                    <dd>{botStatus?.max_open_trades ?? '—'}</dd>
                  </div>
                </dl>
                <button
                  className="btn-primary mt-6 w-full py-3 text-sm font-semibold disabled:opacity-60"
                  onClick={toggleBot}
                  disabled={botActionLoading}
                >
                  {botActionLoading ? 'Atualizando...' : botStatus?.bot_enabled ? 'Parar bot' : 'Iniciar bot'}
                </button>
                <Link
                  href="/bot"
                  className="mt-4 block text-center text-xs text-neutral-500 hover:text-neutral-300"
                >
                  Ajustar configurações avançadas
                </Link>
              </>
            )}
          </div>
        </section>

        <section className="mt-12">
          <div className="surface-strong p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-neutral-100">Memecoins recém analisadas</h2>
                <p className="text-xs text-neutral-500">
                  Lista consolidada das últimas validações, com métricas de risco e liquidez para suportar a tomada de decisão.
                </p>
              </div>
              <button onClick={handleRefresh} className="btn-secondary px-4 py-2 text-sm">
                Atualizar lista
              </button>
            </div>
            <div className="mt-6 grid gap-4 lg:grid-cols-2 xl:grid-cols-3 max-h-[600px] overflow-y-auto pr-2 small-scrollbar">
              {loadingState && <p className="text-sm text-neutral-500">Coletando informações mais recentes...</p>}
              {!loadingState && tokenFeed.length === 0 && (
                <p className="text-sm text-neutral-600">
                  Nenhum ativo novo foi validado no período. Revise novamente nos próximos minutos.
                </p>
              )}
              {!loadingState &&
                tokenFeed.filter(t => {
                  if (!t.validatedAt) return true; // Show if just validated
                  const ageMs = Date.now() - new Date(t.validatedAt).getTime();
                  return ageMs < 60 * 60 * 1000; // 1 hora
                }).map((tokenItem) => {
                  const risk = tokenItem.riskLevel ?? 'moderate'
                  const badge = riskBadgeStyles[risk]
                  return (
                    <div key={tokenItem.contract} className="surface border border-neutral-800/60 p-5 bg-neutral-900/30 hover:bg-neutral-900/50 transition-colors">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-neutral-100">{tokenItem.symbol}</p>
                          <p className="text-xs text-neutral-500">{tokenItem.name}</p>
                        </div>
                        <div className={`rounded-full px-3 py-1 text-xs font-medium ${badge.className}`}>
                          {badge.label}
                        </div>
                      </div>
                      <p className="mt-3 text-xs text-neutral-400 leading-relaxed">{badge.blurb}</p>
                      <div className="mt-5 grid grid-cols-2 gap-4 text-xs text-neutral-400">
                        <div>
                          <p className="uppercase tracking-wide text-neutral-500">Preço</p>
                          <p className="text-neutral-100">{formatCurrency(tokenItem.priceUsd) ?? <IndexingBadge />}</p>
                        </div>
                        <div>
                          <p className="uppercase tracking-wide text-neutral-500">Liquidez</p>
                          <p className="text-neutral-100">{formatCurrency(tokenItem.liquidityUsd) ?? <IndexingBadge />}</p>
                        </div>
                        <div>
                          <p className="uppercase tracking-wide text-neutral-500">Volume 24h</p>
                          <p className="text-neutral-100">{formatCurrency(tokenItem.volume24hUsd) ?? <IndexingBadge />}</p>
                        </div>
                        <div>
                          <p className="uppercase tracking-wide text-neutral-500">Nota Segurança</p>
                          <p className="text-neutral-100">
                            {tokenItem.safetyScore != null ? `${Math.round(tokenItem.safetyScore)} / 100` : '—'}
                          </p>
                        </div>
                        <div>
                          <p className="uppercase tracking-wide text-neutral-500">Prob. Scam</p>
                          <p className="text-neutral-100">
                            {tokenItem.scamProbability != null
                              ? `${Number(tokenItem.scamProbability).toFixed(0)}%`
                              : '—'}
                          </p>
                        </div>
                        <div>
                          <p className="uppercase tracking-wide text-neutral-500">Atualização</p>
                          <p className="text-neutral-100">
                            {tokenItem.validatedAt ? (() => {
                              const d = new Date(tokenItem.validatedAt);
                              d.setHours(d.getHours() - 3); // Forçar fuso horário de Brasília (-3h)
                              return d.toLocaleString('pt-BR');
                            })() : 'Disponibilizado agora'}
                          </p>
                        </div>
                      </div>
                      <div className="mt-5 flex flex-wrap gap-3 text-[11px] text-neutral-500">
                        <span className="rounded-full border border-neutral-700/60 bg-neutral-800/40 px-3 py-1">
                          Contrato: {tokenItem.contract.slice(0, 6)}…{tokenItem.contract.slice(-4)}
                        </span>
                        <Link
                          href={`https://dexscreener.com/${tokenItem.chain?.toLowerCase() || 'solana'}/${tokenItem.contract}`}
                          className="rounded-full border border-purple-500/40 bg-purple-500/10 px-3 py-1 text-purple-200 hover:text-purple-100"
                          target="_blank"
                        >
                          Abrir no DexScreener
                        </Link>
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>
        </section>

        <section className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="surface-strong p-6">
            <h2 className="text-lg font-semibold text-neutral-100">Posições abertas</h2>
            <div className="small-scrollbar mt-5 space-y-4 max-h-[320px] overflow-y-auto pr-1">
              {loadingState && <p className="text-sm text-neutral-500">Carregando posições...</p>}
              {!loadingState && data?.positions.length === 0 && (
                <p className="text-sm text-neutral-600">Nenhuma posição aberta no momento.</p>
              )}
              {data?.positions.map((position) => (
                <div key={position.token_id} className="surface border-neutral-800 p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-neutral-200">{position.symbol}</p>
                      <p className="text-xs text-neutral-500">{position.name}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-neutral-500">Investido</p>
                      <p className="text-sm font-semibold text-neutral-100">{formatCurrency(position.invested_usd)}</p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-neutral-500">
                    <div>
                      <p className="uppercase tracking-wide">Qtd.</p>
                      <p className="text-sm text-neutral-200">{Number(position.token_balance).toFixed(4)}</p>
                    </div>
                    <div>
                      <p className="uppercase tracking-wide">Preço médio</p>
                      <p className="text-sm text-neutral-200">{formatCurrency(position.avg_buy_price)}</p>
                    </div>
                    <div>
                      <p className="uppercase tracking-wide">Preço atual</p>
                      <p className="text-sm text-neutral-200">{formatCurrency(position.current_price)}</p>
                    </div>
                    <div>
                      <p className="uppercase tracking-wide">Trades</p>
                      <p className="text-sm text-neutral-200">{position.trade_count}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="surface-strong p-6">
            <h2 className="text-lg font-semibold text-neutral-100">Ordens recentes</h2>
            <div className="small-scrollbar mt-5 space-y-4 max-h-[320px] overflow-y-auto pr-1">
              {loadingState && <p className="text-sm text-neutral-500">Carregando ordens...</p>}
              {!loadingState && data?.recentOrders.length === 0 && (
                <p className="text-sm text-neutral-600">Nenhuma ordem registrada.</p>
              )}
              {data?.recentOrders.map((order) => (
                <div key={order.id} className="surface border-neutral-800 p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-neutral-200">{order.symbol}</p>
                      <p className="text-xs text-neutral-500">{order.name}</p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${statusColorMap[order.status] ?? 'border-neutral-700 bg-neutral-800 text-neutral-300'
                        }`}
                    >
                      {order.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-neutral-500">
                    <div>
                      <p className="uppercase tracking-wide">Tipo</p>
                      <p className="text-sm text-neutral-200">{order.order_type}</p>
                    </div>
                    <div>
                      <p className="uppercase tracking-wide">Valor</p>
                      <p className="text-sm text-neutral-200">{formatCurrency(order.amount_usd)}</p>
                    </div>
                    <div>
                      <p className="uppercase tracking-wide">Preço</p>
                      <p className="text-sm text-neutral-200">{formatCurrency(order.price_usd)}</p>
                    </div>
                    <div>
                      <p className="uppercase tracking-wide">Criada</p>
                      <p className="text-sm text-neutral-200">{(() => {
                        const d = new Date(order.created_at);
                        d.setHours(d.getHours() - 3); // Fix: UTC to BRT (-3h)
                        return d.toLocaleString('pt-BR');
                      })()}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <InsufficientBalanceModal
        isOpen={showBalanceModal}
        onClose={() => setShowBalanceModal(false)}
        balance={data?.summary.balance || 0}
      />
    </div>
  )
}
