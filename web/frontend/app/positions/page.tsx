'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '../contexts/AuthContext'

type Position = {
  id: string
  token_id: string
  symbol: string
  name: string
  invested_amount_usd: number
  buy_price_usd: number
  buy_time: string
  current_price_usd?: number
  latest_price?: number
  token_balance: number
  hold_time_hours?: number
  unrealized_pnl?: number
  unrealized_pnl_percent?: number
  signal_type?: string
  confidence_score?: number
  potential_multiplier?: number
}

type ClosedPosition = {
  id: string
  token_id: string
  symbol: string
  name: string
  invested_amount_usd: number
  buy_price_usd: number
  buy_time: string
  closed_at: string
  profit_loss_usd?: number
  profit_loss_percent?: number
  hold_time_hours?: number
  signal_type?: string
  confidence_score?: number
}

type PositionsSummary = {
  total_invested: number
  unrealized_pnl: number
  realized_pnl: number
  total_pnl: number
  roi_percent: number
}

const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

const formatCurrency = (value?: number | null) =>
  Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value ?? 0)

const formatPercent = (value?: number | null) => `${Number(value ?? 0).toFixed(2)}%`

const formatHours = (hours?: number | null) => {
  if (!hours) return '—'
  if (hours < 24) return `${hours.toFixed(1)}h`
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return `${days}d ${remainingHours.toFixed(1)}h`
}

export default function PositionsPage() {
  const router = useRouter()
  const { token, isAuthenticated, isLoading } = useAuth()
  const [openPositions, setOpenPositions] = useState<Position[]>([])
  const [closedPositions, setClosedPositions] = useState<ClosedPosition[]>([])
  const [summary, setSummary] = useState<PositionsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'open' | 'closed' | 'summary'>('open')

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/auth/login')
    }
  }, [isAuthenticated, isLoading, router])

  useEffect(() => {
    if (!token) return

    async function fetchPositions() {
      setLoading(true)
      setError(null)
      try {
        const [openResponse, closedResponse, summaryResponse] = await Promise.all([
          fetch(`${apiBase}/api/positions`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${apiBase}/api/positions/closed`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${apiBase}/api/positions/summary`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ])

        if (!openResponse.ok) {
          throw new Error('Erro ao carregar posições.')
        }

        const openJson = await openResponse.json()
        setOpenPositions(openJson.data ?? [])

        if (closedResponse.ok) {
          const closedJson = await closedResponse.json()
          setClosedPositions(closedJson.data ?? [])
        }

        if (summaryResponse.ok) {
          const summaryJson = await summaryResponse.json()
          setSummary(summaryJson.data)
        }
      } catch (err: any) {
        console.error('[Positions] fetch error:', err)
        setError(err.message || 'Não foi possível carregar as posições.')
      } finally {
        setLoading(false)
      }
    }

    fetchPositions()

    // Atualizar a cada 30 segundos
    const interval = setInterval(fetchPositions, 30000)
    return () => clearInterval(interval)
  }, [token])

  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <header className="flex flex-wrap items-center justify-between gap-6 border-b border-neutral-900 pb-6">
          <div>
            <span className="section-title">Posições</span>
            <h1 className="mt-3 text-3xl font-semibold text-neutral-50">Portfólio de Investimentos</h1>
            <p className="mt-2 text-sm text-neutral-500">
              Acompanhe suas posições abertas e fechadas com ganhos e perdas em tempo real.
            </p>
          </div>
          <Link href="/dashboard" className="btn-secondary px-4 py-2 text-sm">
            Voltar ao dashboard
          </Link>
        </header>

        {error && (
          <div className="surface-strong mt-8 border border-rose-500/40 px-5 py-4 text-sm text-rose-200">{error}</div>
        )}

        {/* Resumo */}
        {summary && (
          <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="surface-strong p-5">
              <p className="text-xs uppercase tracking-wide text-neutral-500">Total Investido</p>
              <p className="mt-2 text-2xl font-bold text-neutral-100">{formatCurrency(summary.total_invested)}</p>
            </div>
            <div className="surface-strong p-5">
              <p className="text-xs uppercase tracking-wide text-neutral-500">Ganhos Não Realizados</p>
              <p
                className={`mt-2 text-2xl font-bold ${
                  summary.unrealized_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {formatCurrency(summary.unrealized_pnl)}
              </p>
            </div>
            <div className="surface-strong p-5">
              <p className="text-xs uppercase tracking-wide text-neutral-500">Ganhos Realizados</p>
              <p
                className={`mt-2 text-2xl font-bold ${
                  summary.realized_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {formatCurrency(summary.realized_pnl)}
              </p>
            </div>
            <div className="surface-strong p-5">
              <p className="text-xs uppercase tracking-wide text-neutral-500">ROI Total</p>
              <p
                className={`mt-2 text-2xl font-bold ${
                  summary.roi_percent >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {formatPercent(summary.roi_percent)}
              </p>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="mt-10 border-b border-neutral-800">
          <nav className="flex gap-4">
            <button
              onClick={() => setActiveTab('open')}
              className={`border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
                activeTab === 'open'
                  ? 'border-emerald-500 text-emerald-400'
                  : 'border-transparent text-neutral-500 hover:text-neutral-300'
              }`}
            >
              Posições Abertas ({openPositions.length})
            </button>
            <button
              onClick={() => setActiveTab('closed')}
              className={`border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
                activeTab === 'closed'
                  ? 'border-emerald-500 text-emerald-400'
                  : 'border-transparent text-neutral-500 hover:text-neutral-300'
              }`}
            >
              Posições Fechadas ({closedPositions.length})
            </button>
            <button
              onClick={() => setActiveTab('summary')}
              className={`border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
                activeTab === 'summary'
                  ? 'border-emerald-500 text-emerald-400'
                  : 'border-transparent text-neutral-500 hover:text-neutral-300'
              }`}
            >
              Resumo
            </button>
          </nav>
        </div>

        {/* Conteúdo */}
        {loading ? (
          <p className="mt-10 text-center text-sm text-neutral-500">Carregando posições...</p>
        ) : activeTab === 'open' ? (
          <div className="mt-10">
            {openPositions.length === 0 ? (
              <p className="text-center text-sm text-neutral-600">Nenhuma posição aberta no momento.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm text-neutral-300">
                  <thead className="text-xs uppercase tracking-[0.3em] text-neutral-500">
                    <tr>
                      <th className="py-3 text-left">Token</th>
                      <th className="py-3 text-right">Investido</th>
                      <th className="py-3 text-right">Preço Compra</th>
                      <th className="py-3 text-right">Preço Atual</th>
                      <th className="py-3 text-right">Quantidade</th>
                      <th className="py-3 text-right">Ganho/Perda</th>
                      <th className="py-3 text-right">ROI</th>
                      <th className="py-3 text-right">Tempo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openPositions.map((position) => {
                      const currentPrice = position.latest_price ?? position.current_price_usd ?? position.buy_price_usd
                      const currentValue = currentPrice * position.token_balance
                      const pnl = currentValue - position.invested_amount_usd
                      const pnlPercent = (pnl / position.invested_amount_usd) * 100
                      const priceChange = ((currentPrice - position.buy_price_usd) / position.buy_price_usd) * 100

                      return (
                        <tr key={position.id} className="border-t border-neutral-800">
                          <td className="py-4">
                            <div>
                              <p className="text-sm font-medium text-neutral-200">{position.symbol}</p>
                              <p className="text-xs text-neutral-500">{position.name}</p>
                            </div>
                          </td>
                          <td className="py-4 text-right">{formatCurrency(position.invested_amount_usd)}</td>
                          <td className="py-4 text-right">{formatCurrency(position.buy_price_usd)}</td>
                          <td className="py-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <span>{formatCurrency(currentPrice)}</span>
                              <span
                                className={`text-xs font-semibold ${priceChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
                              >
                                {priceChange >= 0 ? '↑' : '↓'} {Math.abs(priceChange).toFixed(2)}%
                              </span>
                            </div>
                          </td>
                          <td className="py-4 text-right">{Number(position.token_balance).toFixed(4)}</td>
                          <td className={`py-4 text-right font-semibold ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {formatCurrency(pnl)}
                          </td>
                          <td className={`py-4 text-right font-semibold ${pnlPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {formatPercent(pnlPercent)}
                          </td>
                          <td className="py-4 text-right text-xs">{formatHours(position.hold_time_hours)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : activeTab === 'closed' ? (
          <div className="mt-10">
            {closedPositions.length === 0 ? (
              <p className="text-center text-sm text-neutral-600">Nenhuma posição fechada ainda.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm text-neutral-300">
                  <thead className="text-xs uppercase tracking-[0.3em] text-neutral-500">
                    <tr>
                      <th className="py-3 text-left">Token</th>
                      <th className="py-3 text-right">Investido</th>
                      <th className="py-3 text-right">Preço Compra</th>
                      <th className="py-3 text-right">Ganho/Perda</th>
                      <th className="py-3 text-right">ROI</th>
                      <th className="py-3 text-right">Tempo Retenção</th>
                      <th className="py-3 text-right">Fechado em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closedPositions.map((position) => {
                      const pnl = Number(position.profit_loss_usd ?? 0)
                      const pnlPercent = Number(position.profit_loss_percent ?? 0)

                      return (
                        <tr key={position.id} className="border-t border-neutral-800">
                          <td className="py-4">
                            <div>
                              <p className="text-sm font-medium text-neutral-200">{position.symbol}</p>
                              <p className="text-xs text-neutral-500">{position.name}</p>
                            </div>
                          </td>
                          <td className="py-4 text-right">{formatCurrency(position.invested_amount_usd)}</td>
                          <td className="py-4 text-right">{formatCurrency(position.buy_price_usd)}</td>
                          <td className={`py-4 text-right font-semibold ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {formatCurrency(pnl)}
                          </td>
                          <td className={`py-4 text-right font-semibold ${pnlPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {formatPercent(pnlPercent)}
                          </td>
                          <td className="py-4 text-right text-xs">{formatHours(position.hold_time_hours)}</td>
                          <td className="py-4 text-right text-xs">
                            {new Date(position.closed_at).toLocaleString('pt-BR')}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-10 space-y-6">
            {summary && (
              <>
                <div className="surface-strong p-6">
                  <h2 className="text-lg font-semibold text-neutral-100">Resumo Geral</h2>
                  <div className="mt-4 grid grid-cols-2 gap-6">
                    <div>
                      <p className="text-sm text-neutral-500">Total Investido</p>
                      <p className="mt-1 text-2xl font-bold text-neutral-100">{formatCurrency(summary.total_invested)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-neutral-500">ROI Total</p>
                      <p
                        className={`mt-1 text-2xl font-bold ${summary.roi_percent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
                      >
                        {formatPercent(summary.roi_percent)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-neutral-500">Ganhos Não Realizados</p>
                      <p
                        className={`mt-1 text-xl font-semibold ${
                          summary.unrealized_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {formatCurrency(summary.unrealized_pnl)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-neutral-500">Ganhos Realizados</p>
                      <p
                        className={`mt-1 text-xl font-semibold ${
                          summary.realized_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {formatCurrency(summary.realized_pnl)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="surface-strong p-6">
                  <h2 className="text-lg font-semibold text-neutral-100">Estatísticas</h2>
                  <div className="mt-4 grid grid-cols-3 gap-6">
                    <div>
                      <p className="text-sm text-neutral-500">Posições Abertas</p>
                      <p className="mt-1 text-xl font-semibold text-neutral-200">{openPositions.length}</p>
                    </div>
                    <div>
                      <p className="text-sm text-neutral-500">Posições Fechadas</p>
                      <p className="mt-1 text-xl font-semibold text-neutral-200">{closedPositions.length}</p>
                    </div>
                    <div>
                      <p className="text-sm text-neutral-500">Total de Operações</p>
                      <p className="mt-1 text-xl font-semibold text-neutral-200">
                        {openPositions.length + closedPositions.length}
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

