'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '../contexts/AuthContext'

type BotPerformance = {
  debug?: {
    user_id: string
    total_orders_in_db: number
    completed_orders: number
  }
  balance?: {
    available: number
    total: number
    invested_in_positions: number
  }
  trades: {
    total: number
    buys: number
    sells: number
    wins: number
    losses: number
    break_even: number
    win_rate: number
  }
  profits: {
    realized_profit?: number
    realized_loss?: number
    net_profit_realized?: number
    unrealized_profit?: number
    unrealized_loss?: number
    net_profit_unrealized?: number
    total_profit: number
    total_loss: number
    net_profit: number
    roi: number
    avg_profit_loss_percent: number
    best_trade: number
    worst_trade: number
  }
  positions: {
    open: number
    total_invested: number
    current_value: number
    unrealized_pnl: number
    unrealized_pnl_percent?: number
    unrealized_profit?: number
    unrealized_loss?: number
    avg_hold_time_hours?: number
    details?: Array<{
      id: string
      token_id: string
      symbol: string
      name: string
      invested_amount_usd: number
      buy_price_usd: number
      current_price_usd: number
      token_balance: number
      current_value: number
      unrealized_pnl: number
      unrealized_pnl_percent: number
      hold_time_hours: number
      buy_time: string
    }>
  }
  signals: {
    buy_signals: number
    sell_signals: number
    hold_signals: number
    avg_confidence: number
  }
  recent_orders?: Array<{
    id: string
    order_type: string
    status: string
    amount_usd: number
    amount_token: number
    price_usd: number
    profit_loss_usd: number | null
    profit_loss_percent: number | null
    created_at: string
    executed_at: string | null
    symbol: string
    name: string
  }>
  balance_history: Array<{
    hour: string
    deposits: number
    withdrawals: number
  }>
} | null

const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

const formatCurrency = (value: number | null | undefined) =>
  Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' }).format(value ?? 0)

const formatPercent = (value: number | null | undefined) =>
  `${Number(value ?? 0).toFixed(2)}%`

export default function BotPerformancePage() {
  const router = useRouter()
  const { token, isAuthenticated, isLoading, logout } = useAuth()
  const [performance, setPerformance] = useState<BotPerformance>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/auth/login')
    }
  }, [isAuthenticated, isLoading, router])

  useEffect(() => {
    if (!token) return

    fetchPerformance()

    // Atualizar a cada 30 segundos
    const interval = setInterval(() => {
      fetchPerformance()
    }, 30000)

    return () => clearInterval(interval)
  }, [token])

  const fetchPerformance = async () => {
    if (!token) return

    try {
      setLoading(true)
      const response = await fetch(`${apiBase}/api/bot/performance`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (response.status === 401) {
        // Se for 401 (token expirado), redirecionar para login
        console.warn('[Bot Performance] Token expirado ou inválido, redirecionando para login...')
        logout()
        router.push('/auth/login')
        return
      }

      if (!response.ok) {
        throw new Error('Falha ao carregar performance do bot')
      }

      const json = await response.json()
      setPerformance(json.data)
      setError(null)
    } catch (err: any) {
      console.error('[Bot Performance] fetch error:', err)
      setError(err.message || 'Não foi possível carregar a performance do bot')
    } finally {
      setLoading(false)
    }
  }

  if (loading && !performance) {
    return (
      <div className="min-h-screen bg-neutral-950">
        <div className="mx-auto max-w-7xl px-6 py-10">
          <div className="text-center text-neutral-500">Carregando métricas do bot...</div>
        </div>
      </div>
    )
  }

  if (!performance) {
    return (
      <div className="min-h-screen bg-neutral-950">
        <div className="mx-auto max-w-7xl px-6 py-10">
          <div className="text-center text-neutral-600">Erro ao carregar performance do bot</div>
        </div>
      </div>
    )
  }

  // Usar lucro total (realizado + não realizado) para exibição principal
  const netProfit = performance.profits.net_profit ?? 0
  const netProfitRealized = performance.profits.net_profit_realized ?? 0
  const netProfitUnrealized = performance.profits.net_profit_unrealized ?? 0
  const isProfit = netProfit >= 0

  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <header className="flex flex-wrap items-center justify-between gap-6 border-b border-neutral-900 pb-8">
          <div>
            <span className="section-title">Performance</span>
            <h1 className="mt-3 text-3xl font-semibold text-neutral-50">Métricas do Bot</h1>
            <p className="mt-2 text-sm text-neutral-500">
              Acompanhe ganhos, perdas, win rate e performance em tempo real
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={fetchPerformance} className="btn-secondary px-4 py-2 text-sm">
              Atualizar
            </button>
            <Link href="/dashboard" className="btn-secondary px-4 py-2 text-sm">
              Voltar ao dashboard
            </Link>
          </div>
        </header>

        {error && (
          <div className="surface-strong mt-8 border border-rose-500/40 px-5 py-4 text-sm text-rose-200">
            {error}
          </div>
        )}

        {/* Informações de Debug */}
        {performance.debug && (
          <div className="mt-8 surface-strong border border-amber-500/40 px-5 py-4 text-sm">
            <p className="text-amber-200 font-semibold mb-2">Informações de Debug:</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-neutral-400">
              <div>
                <span className="text-neutral-500">User ID:</span> <span className="font-mono">{performance.debug.user_id}</span>
              </div>
              <div>
                <span className="text-neutral-500">Total de Ordens no DB:</span> <span className="text-amber-400 font-bold">{performance.debug.total_orders_in_db}</span>
              </div>
              <div>
                <span className="text-neutral-500">Ordens Completadas:</span> <span className="text-amber-400 font-bold">{performance.debug.completed_orders}</span>
              </div>
            </div>
          </div>
        )}

        {/* Saldo Atual */}
        {performance.balance && (
          <div className="mt-8">
            <div className="surface-strong p-6 border border-sky-500/40">
              <h2 className="text-lg font-semibold text-neutral-100 mb-4">Saldo Atual</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-neutral-500">Saldo Disponível</p>
                  <p className="mt-1 text-2xl font-bold text-sky-400">
                    {formatCurrency(performance.balance.available)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-neutral-500">Saldo Total</p>
                  <p className="mt-1 text-2xl font-bold text-neutral-100">
                    {formatCurrency(performance.balance.total)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-neutral-500">Investido em Posições</p>
                  <p className="mt-1 text-2xl font-bold text-purple-400">
                    {formatCurrency(performance.balance.invested_in_positions)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Saldo Líquido */}
        <div className="mt-10">
          <div className={`surface-strong p-8 ${isProfit ? 'border-emerald-500/40' : 'border-rose-500/40'}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-neutral-500">Lucro/Perda Total</p>
                <p className={`mt-2 text-5xl font-bold ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {formatCurrency(netProfit)}
                </p>
                <div className="mt-2 space-y-1 text-xs text-neutral-400">
                  <p>
                    {isProfit ? 'Bot está lucrando!' : 'Bot está com prejuízo'}
                  </p>
                  {netProfitRealized !== 0 && (
                    <p>Realizado: <span className={netProfitRealized >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{formatCurrency(netProfitRealized)}</span></p>
                  )}
                  {netProfitUnrealized !== 0 && (
                    <p>Não Realizado: <span className={netProfitUnrealized >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{formatCurrency(netProfitUnrealized)}</span></p>
                  )}
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm text-neutral-500">Win Rate</p>
                <p className="mt-2 text-4xl font-bold text-purple-400">
                  {formatPercent(performance.trades.win_rate)}
                </p>
                <p className="mt-2 text-sm text-neutral-400">
                  {performance.trades.wins} vitórias de {performance.trades.total} trades
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Cards de Métricas */}
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-4">
          <div className="surface p-6">
            <span className="section-title">Total de Trades</span>
            <p className="mt-3 text-3xl font-semibold text-neutral-50">{performance.trades.total}</p>
            <div className="mt-3 flex gap-4 text-xs text-neutral-500">
              <span>BUY: {performance.trades.buys}</span>
              <span>SELL: {performance.trades.sells}</span>
            </div>
          </div>

          <div className="surface p-6">
            <span className="section-title">Ganhos Totais</span>
            <p className="mt-3 text-3xl font-semibold text-emerald-400">
              {formatCurrency(performance.profits.total_profit)}
            </p>
            <div className="mt-2 space-y-1 text-xs text-neutral-400">
              {performance.profits.realized_profit !== undefined && (
                <p>Realizado: {formatCurrency(performance.profits.realized_profit)}</p>
              )}
              {performance.profits.unrealized_profit !== undefined && (
                <p>Não Realizado: {formatCurrency(performance.profits.unrealized_profit)}</p>
              )}
              <p>{performance.trades.wins} trades vencedores</p>
            </div>
          </div>

          <div className="surface p-6">
            <span className="section-title">Perdas Totais</span>
            <p className="mt-3 text-3xl font-semibold text-rose-400">
              {formatCurrency(performance.profits.total_loss)}
            </p>
            <div className="mt-2 space-y-1 text-xs text-neutral-400">
              {performance.profits.realized_loss !== undefined && (
                <p>Realizado: {formatCurrency(performance.profits.realized_loss)}</p>
              )}
              {performance.profits.unrealized_loss !== undefined && (
                <p>Não Realizado: {formatCurrency(performance.profits.unrealized_loss)}</p>
              )}
              <p>{performance.trades.losses} trades perdedores</p>
            </div>
          </div>

          <div className="surface p-6">
            <span className="section-title">Posições Abertas</span>
            <p className="mt-3 text-3xl font-semibold text-sky-400">{performance.positions.open}</p>
            <p className="mt-2 text-sm text-neutral-400">
              Investido: {formatCurrency(performance.positions.total_invested)}
            </p>
          </div>
        </div>

        {/* Estatísticas Detalhadas */}
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="surface-strong p-6">
            <h2 className="text-lg font-semibold text-neutral-100">Estatísticas de Trades</h2>
            <dl className="mt-6 space-y-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-neutral-400">Melhor Trade</dt>
                <dd className="font-semibold text-emerald-400">
                  {formatCurrency(performance.profits.best_trade)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-400">Pior Trade</dt>
                <dd className="font-semibold text-rose-400">
                  {formatCurrency(performance.profits.worst_trade)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-400">Média P/L por Trade</dt>
                <dd className={`font-semibold ${performance.profits.avg_profit_loss_percent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {formatPercent(performance.profits.avg_profit_loss_percent)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-400">Trades Sem Lucro/Perda</dt>
                <dd className="font-semibold text-neutral-300">{performance.trades.break_even}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-400">ROI (Retorno sobre Investimento)</dt>
                <dd className={`font-semibold ${performance.profits.roi >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {formatPercent(performance.profits.roi)}
                </dd>
              </div>
            </dl>
          </div>

          <div className="surface-strong p-6">
            <h2 className="text-lg font-semibold text-neutral-100">Posições Atuais</h2>
            <dl className="mt-6 space-y-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-neutral-400">Valor Investido</dt>
                <dd className="font-semibold text-neutral-100">
                  {formatCurrency(performance.positions.total_invested)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-400">Valor Atual</dt>
                <dd className="font-semibold text-neutral-100">
                  {formatCurrency(performance.positions.current_value)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-400">Lucro/Perda Não Realizado</dt>
                <dd className={`font-semibold ${performance.positions.unrealized_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {formatCurrency(performance.positions.unrealized_pnl)}
                  {performance.positions.unrealized_pnl_percent !== undefined && (
                    <span className="ml-2 text-xs">
                      ({performance.positions.unrealized_pnl_percent >= 0 ? '+' : ''}{performance.positions.unrealized_pnl_percent.toFixed(2)}%)
                    </span>
                  )}
                </dd>
              </div>
              {performance.positions.avg_hold_time_hours !== undefined && (
                <div className="flex justify-between">
                  <dt className="text-neutral-400">Tempo Médio de Hold</dt>
                  <dd className="font-semibold text-neutral-100">
                    {performance.positions.avg_hold_time_hours.toFixed(1)}h
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        {/* Sinais */}
        <div className="mt-8">
          <div className="surface-strong p-6">
            <h2 className="text-lg font-semibold text-neutral-100">Sinais (Últimas 24h)</h2>
            <div className="mt-6 grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-emerald-400">{performance.signals.buy_signals}</p>
                <p className="mt-1 text-sm text-neutral-400">Sinais BUY</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-rose-400">{performance.signals.sell_signals}</p>
                <p className="mt-1 text-sm text-neutral-400">Sinais SELL</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-purple-400">{performance.signals.hold_signals}</p>
                <p className="mt-1 text-sm text-neutral-400">Sinais HOLD</p>
              </div>
            </div>
            <div className="mt-6 text-center">
              <p className="text-sm text-neutral-400">Confiança Média</p>
              <p className="mt-1 text-2xl font-bold text-purple-400">
                {formatPercent(performance.signals.avg_confidence)}
              </p>
            </div>
          </div>
        </div>

        {/* Ordens Recentes */}
        {performance.recent_orders && performance.recent_orders.length > 0 && (
          <div className="mt-8">
            <div className="surface-strong p-6">
              <h2 className="text-lg font-semibold text-neutral-100 mb-4">Ordens Recentes</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-800">
                      <th className="text-left py-3 px-4 text-neutral-400">Data/Hora</th>
                      <th className="text-left py-3 px-4 text-neutral-400">Tipo</th>
                      <th className="text-left py-3 px-4 text-neutral-400">Token</th>
                      <th className="text-right py-3 px-4 text-neutral-400">Valor USD</th>
                      <th className="text-right py-3 px-4 text-neutral-400">Preço</th>
                      <th className="text-right py-3 px-4 text-neutral-400">P/L</th>
                      <th className="text-center py-3 px-4 text-neutral-400">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance.recent_orders.slice(0, 20).map((order) => {
                      const isProfit = order.profit_loss_usd && order.profit_loss_usd > 0
                      const isLoss = order.profit_loss_usd && order.profit_loss_usd < 0
                      const date = new Date(order.created_at)
                      return (
                        <tr key={order.id} className="border-b border-neutral-900 hover:bg-neutral-900/50">
                          <td className="py-3 px-4 text-neutral-400 text-xs">
                            {date.toLocaleString('pt-BR')}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-1 rounded text-xs font-semibold ${order.order_type === 'BUY'
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-rose-500/20 text-rose-400'
                              }`}>
                              {order.order_type}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div>
                              <div className="font-semibold text-neutral-100">{order.symbol}</div>
                              <div className="text-xs text-neutral-500">{order.name}</div>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right font-semibold text-neutral-100">
                            {formatCurrency(order.amount_usd)}
                          </td>
                          <td className="py-3 px-4 text-right text-neutral-400">
                            ${Number(order.price_usd).toFixed(8)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {order.order_type === 'SELL' && order.profit_loss_usd !== null ? (
                              <div>
                                <div className={`font-semibold ${isProfit ? 'text-emerald-400' : isLoss ? 'text-rose-400' : 'text-neutral-400'}`}>
                                  {formatCurrency(order.profit_loss_usd)}
                                </div>
                                {order.profit_loss_percent !== null && (
                                  <div className={`text-xs ${isProfit ? 'text-emerald-400' : isLoss ? 'text-rose-400' : 'text-neutral-500'}`}>
                                    {formatPercent(order.profit_loss_percent)}
                                  </div>
                                )}
                              </div>
                            ) : order.order_type === 'BUY' ? (
                              <span className="text-xs text-neutral-500">Aguardando venda</span>
                            ) : (
                              <span className="text-neutral-500 text-xs">-</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className={`px-2 py-1 rounded text-xs ${order.status === 'completed'
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : order.status === 'pending'
                                  ? 'bg-amber-500/20 text-amber-400'
                                  : 'bg-neutral-500/20 text-neutral-400'
                              }`}>
                              {order.status}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {performance.recent_orders.length > 20 && (
                <p className="mt-4 text-center text-sm text-neutral-500">
                  Mostrando 20 de {performance.recent_orders.length} ordens. Ver todas no dashboard.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Detalhes das Posições Abertas */}
        {performance.positions.details && performance.positions.details.length > 0 && (
          <div className="mt-8">
            <div className="surface-strong p-6">
              <h2 className="text-lg font-semibold text-neutral-100 mb-4">Detalhes das Posições Abertas</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-800">
                      <th className="text-left py-3 px-4 text-neutral-400">Token</th>
                      <th className="text-right py-3 px-4 text-neutral-400">Investido</th>
                      <th className="text-right py-3 px-4 text-neutral-400">Preço Compra</th>
                      <th className="text-right py-3 px-4 text-neutral-400">Preço Atual</th>
                      <th className="text-right py-3 px-4 text-neutral-400">Valor Atual</th>
                      <th className="text-right py-3 px-4 text-neutral-400">P/L</th>
                      <th className="text-right py-3 px-4 text-neutral-400">Tempo Hold</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance.positions.details.map((pos) => {
                      const isProfit = pos.unrealized_pnl >= 0
                      const priceChange = ((pos.current_price_usd - pos.buy_price_usd) / pos.buy_price_usd) * 100
                      return (
                        <tr key={pos.id} className="border-b border-neutral-900 hover:bg-neutral-900/50">
                          <td className="py-3 px-4">
                            <div>
                              <div className="font-semibold text-neutral-100">{pos.symbol}</div>
                              <div className="text-xs text-neutral-500">{pos.name}</div>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right font-semibold text-neutral-100">
                            {formatCurrency(pos.invested_amount_usd)}
                          </td>
                          <td className="py-3 px-4 text-right text-neutral-400">
                            ${pos.buy_price_usd.toFixed(8)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div>
                              <div className={`font-semibold ${priceChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                ${pos.current_price_usd.toFixed(8)}
                              </div>
                              <div className={`text-xs ${priceChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right font-semibold text-neutral-100">
                            {formatCurrency(pos.current_value)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div>
                              <div className={`font-semibold ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {formatCurrency(pos.unrealized_pnl)}
                              </div>
                              <div className={`text-xs ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {isProfit ? '+' : ''}{pos.unrealized_pnl_percent.toFixed(2)}%
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right text-neutral-400">
                            {pos.hold_time_hours.toFixed(1)}h
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {(!performance.recent_orders || performance.recent_orders.length === 0) && (
          <div className="mt-8">
            <div className="surface-strong p-6 border border-amber-500/40">
              <p className="text-amber-200 text-center">
                Nenhuma ordem encontrada no banco de dados. O bot pode não ter executado trades ainda.
              </p>
              {performance.debug && (
                <p className="text-neutral-400 text-center mt-2 text-sm">
                  Total de ordens no DB: {performance.debug.total_orders_in_db} | User ID: {performance.debug.user_id}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Link para Notificações */}
        <div className="mt-8">
          <div className="surface-strong p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-neutral-100">Logs do Bot em Tempo Real</h2>
                <p className="mt-1 text-sm text-neutral-500">
                  Veja tudo que o bot está fazendo: validações, sinais, compras, vendas...
                </p>
              </div>
              <Link href="/notifications" className="btn-primary px-4 py-2 text-sm">
                Ver Logs
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

