'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '../contexts/AuthContext'

type Signal = {
  id: string
  signal_type: 'BUY' | 'SELL' | 'HOLD'
  confidence_score: number
  potential_multiplier?: number | null
  reasoning?: string
  created_at: string
  expires_at?: string | null
  is_active: boolean
  token_id: string
  symbol: string
  name: string
  price_usd?: number
  price_at_signal?: number
  liquidity_usd?: number
  volume_24h_usd?: number
  contract_address?: string
  chain?: string
  safety_score?: number | null
  overall_score?: number | null
  volume_score?: number | null
  liquidity_score?: number | null
  holders_score?: number | null
  age_score?: number | null
}

const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

const typeColors: Record<string, string> = {
  BUY: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  SELL: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
  HOLD: 'border-purple-400/30 bg-purple-400/10 text-purple-200',
}

const formatCurrency = (val?: number | null) => {
  if (val === null || val === undefined) return 'US$ 0,00';
  if (val > 0 && val < 0.1) {
    return `US$ ${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 12 })}`;
  }
  return Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(val);
}

const formatPercent = (value?: number | null) => `${Number(value ?? 0).toFixed(1)}%`

type PriceUpdate = {
  tokenId: string
  symbol: string
  priceUsd: number
  priceChangePercent?: number
  timestamp: number
}

export default function SignalsPage() {
  const router = useRouter()
  const { token, isAuthenticated, isLoading } = useAuth()
  const [activeSignals, setActiveSignals] = useState<Signal[]>([])
  const [history, setHistory] = useState<Signal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [priceUpdates, setPriceUpdates] = useState<Map<string, PriceUpdate>>(new Map())
  const [intendedInvestments, setIntendedInvestments] = useState<Map<string, number>>(new Map())
  const [isExportModalOpen, setIsExportModalOpen] = useState(false)
  const [exportHours, setExportHours] = useState(24)
  const [exportStartDate, setExportStartDate] = useState('')
  const [exportEndDate, setExportEndDate] = useState('')
  const [isExporting, setIsExporting] = useState(false)

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/auth/login')
    }
  }, [isAuthenticated, isLoading, router])

  useEffect(() => {
    if (!token) return

    const controller = new AbortController()

    async function fetchSignals() {
      setLoading(true)
      setError(null)
      try {
        const [activeResponse, historyResponse] = await Promise.all([
          fetch(`${apiBase}/api/signals/active`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          }),
          fetch(`${apiBase}/api/signals/history`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          }),
        ])

        if (!activeResponse.ok) {
          throw new Error('Erro ao carregar sinais ativos.')
        }

        const activeJson = await activeResponse.json()
        const signals = activeJson.data ?? []
        setActiveSignals(signals)

        // Buscar investimentos pretendidos para cada sinal BUY
        const investmentPromises = signals
          .filter((s: Signal) => s.signal_type === 'BUY')
          .map(async (s: Signal) => {
            try {
              const invResponse = await fetch(`${apiBase}/api/investment/calculate/${s.token_id}?signal_id=${s.id}`, {
                headers: { Authorization: `Bearer ${token}` },
              })
              if (invResponse.ok) {
                const invJson = await invResponse.json()
                return { tokenId: s.token_id, amount: invJson.data?.amountUsd ?? 0 }
              }
            } catch (err) {
              console.warn(`[Signals] Failed to fetch investment for ${s.symbol}:`, err)
            }
            return null
          })

        const investments = await Promise.all(investmentPromises)
        const investmentMap = new Map<string, number>()
        investments.forEach((inv) => {
          if (inv) investmentMap.set(inv.tokenId, inv.amount)
        })
        setIntendedInvestments(investmentMap)

        if (historyResponse.ok) {
          const historyJson = await historyResponse.json()
          setHistory(historyJson.data ?? [])
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return
        console.error('[Signals] fetch error:', err)
        setError(err.message || 'Não foi possível carregar os sinais.')
      } finally {
        setLoading(false)
      }
    }

    fetchSignals()
    return () => controller.abort()
  }, [token])

  // WebSocket para atualizações de preços em tempo real
  useEffect(() => {
    if (!token || !isAuthenticated) {
      console.log('[WebSocket] Skipping connection - no token or not authenticated')
      return
    }

    let ws: WebSocket | null = null
    let reconnectTimeout: NodeJS.Timeout | null = null
    let heartbeatInterval: NodeJS.Timeout | null = null
    let shouldReconnect = true
    let authenticationError = false

    const connect = () => {
      if (!shouldReconnect || authenticationError) {
        console.log('[WebSocket] Skipping connection - authentication error or reconnection disabled')
        return
      }

      const wsProtocol = apiBase.startsWith('https') ? 'wss' : 'ws'
      const wsHost = apiBase.replace(/^https?:\/\//, '').replace(/\/$/, '') // Remove trailing slash
      const wsUrl = `${wsProtocol}://${wsHost}/ws/prices?token=${token}`
      console.log('[WebSocket] Connecting to:', wsUrl)
      
      try {
        ws = new WebSocket(wsUrl)
      } catch (error) {
        console.error('[WebSocket] Failed to create WebSocket:', error)
        return
      }

      ws.onopen = () => {
        console.log('[WebSocket] ✅ Connected to price updates')
        authenticationError = false // Reset auth error on successful connection
      }

      ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'price_update' && data.updates) {
          const updates = new Map<string, PriceUpdate>()
          data.updates.forEach((update: PriceUpdate) => {
            updates.set(update.tokenId, update)
          })
          setPriceUpdates((prev) => {
            const merged = new Map(prev)
            updates.forEach((update, tokenId) => {
              merged.set(tokenId, update)
            })
            return merged
          })

          // Atualizar preços nos sinais ativos
          setActiveSignals((prev) =>
            prev.map((signal) => {
              const update = updates.get(signal.token_id)
              if (update) {
                return { ...signal, price_usd: update.priceUsd }
              }
              return signal
            })
          )
        } else if (data.type === 'connected') {
          console.log('[WebSocket]', data.message)
        } else if (data.type === 'pong') {
          // Heartbeat
        }
      } catch (err) {
        console.error('[WebSocket] Error parsing message:', err)
      }
    }

      ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error)
        if (ws) {
          console.error('[WebSocket] ReadyState:', ws.readyState)
        }
      }

      ws.onclose = (event) => {
        console.log('[WebSocket] Disconnected', {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean
        })
        
        // Verificar se foi erro de autenticação (401 ou 1008 - policy violation)
        if (event.code === 1008 || event.code === 4001 || event.reason?.includes('401') || event.reason?.includes('Unauthorized')) {
          console.warn('[WebSocket] Authentication error detected, stopping reconnection attempts')
          authenticationError = true
          shouldReconnect = false
          return
        }
        
        // Limpar heartbeat
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval)
          heartbeatInterval = null
        }

        // Reconectar apenas se não foi um fechamento normal, não foi erro de auth, e se ainda devemos reconectar
        if (shouldReconnect && !authenticationError && event.code !== 1000) {
          console.log('[WebSocket] Will attempt reconnection in 3 seconds...')
          reconnectTimeout = setTimeout(() => {
            if (shouldReconnect && !authenticationError) {
              connect()
            }
          }, 3000)
        }
      }

      // Heartbeat
      heartbeatInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }))
        }
      }, 30000)
    }

    // Iniciar conexão
    connect()

    // Cleanup
    return () => {
      console.log('[WebSocket] Cleaning up connection')
      shouldReconnect = false
      
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout)
        reconnectTimeout = null
      }
      
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval)
        heartbeatInterval = null
      }
      
      if (ws) {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, 'Component unmounting')
        }
        ws = null
      }
    }
  }, [token, isAuthenticated, apiBase])

  const handleExportJSON = async () => {
    if (!token) return
    setIsExporting(true)
    setError(null)
    try {
      let url = `${apiBase}/api/tokens/export?hours=${exportHours}`
      if (exportStartDate && exportEndDate) {
        url = `${apiBase}/api/tokens/export?startDate=${exportStartDate}&endDate=${exportEndDate}`
      }
      
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      })

      if (!res.ok) throw new Error('Falha ao exportar os tokens.')

      const blob = await res.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = `tokens_export_${exportHours}h_${Date.now()}.json`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(downloadUrl)
      document.body.removeChild(a)
      setIsExportModalOpen(false)
    } catch (err: any) {
      console.error('[Export] Erro:', err)
      setError(err.message || 'Ocorreu um erro na exportação.')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="flex flex-wrap items-center justify-between gap-6 border-b border-neutral-900 pb-6">
          <div>
            <span className="section-title">Sinais</span>
            <h1 className="mt-3 text-3xl font-semibold text-neutral-50">Inteligência de sinais</h1>
            <p className="mt-2 text-sm text-neutral-500">
              Acompanhamento dos sinais emitidos pelo motor de regras e do histórico recente.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsExportModalOpen(true)}
              className="btn-primary px-4 py-2 text-sm bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 transition-colors"
            >
              ⇩ Exportar Histórico (JSON)
            </button>
            <Link href="/dashboard" className="btn-secondary px-4 py-2 text-sm">
              Voltar ao dashboard
            </Link>
          </div>
        </header>

        {isExportModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
            <div className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
              <h3 className="text-xl font-semibold text-neutral-100 mb-2">Exportar Histórico</h3>
              <p className="text-sm text-neutral-400 mb-6">
                Faça o download dos tokens validados para análise. Escolha o período (em horas):
              </p>
              
              <div className="flex flex-col gap-4 mb-6">
                <div>
                  <label className="text-[10px] uppercase text-neutral-500 mb-1 block">Período (Horas)</label>
                  <input
                    type="number"
                    min="1"
                    max="720"
                    value={exportHours}
                    onChange={(e) => setExportHours(Number(e.target.value))}
                    disabled={!!(exportStartDate || exportEndDate)}
                    className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-4 py-2 text-neutral-200 focus:border-emerald-500/50 focus:outline-none disabled:opacity-30"
                    placeholder="24"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] uppercase text-neutral-500 mb-1 block">Início</label>
                    <input
                      type="datetime-local"
                      value={exportStartDate}
                      onChange={(e) => setExportStartDate(e.target.value)}
                      className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-2 text-xs text-neutral-200 focus:border-emerald-500/50 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase text-neutral-500 mb-1 block">Fim</label>
                    <input
                      type="datetime-local"
                      value={exportEndDate}
                      onChange={(e) => setExportEndDate(e.target.value)}
                      className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-2 text-xs text-neutral-200 focus:border-emerald-500/50 focus:outline-none"
                    />
                  </div>
                </div>
                {(exportStartDate || exportEndDate) && (
                  <button 
                    onClick={() => { setExportStartDate(''); setExportEndDate(''); }}
                    className="text-[10px] text-rose-400 hover:text-rose-300 text-left"
                  >
                    ✕ Limpar datas (usar horas)
                  </button>
                )}
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => setIsExportModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium hover:text-white text-neutral-400"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleExportJSON}
                  disabled={isExporting}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {isExporting ? 'Processando...' : 'Baixar JSON'}
                </button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="surface-strong mt-8 border border-rose-500/40 px-5 py-4 text-sm text-rose-200">
            {error}
          </div>
        )}

        <section className="mt-10 surface-strong p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-neutral-100">Sinais de Elite (Score {'>'}= 80)</h2>
            <span className="text-xs uppercase tracking-[0.3em] text-neutral-500">
              {loading ? 'CARREGANDO...' : `${activeSignals.filter(s => (s.confidence_score || 0) >= 80).length} SINAIS`}
            </span>
          </div>

          {loading ? (
            <p className="mt-6 text-sm text-neutral-500">Carregando sinais de elite...</p>
          ) : activeSignals.filter(s => (s.confidence_score || 0) >= 80 && s.signal_type === 'BUY').length === 0 ? (
            <p className="mt-6 text-sm text-neutral-600">Nenhum sinal de elite (Score {'>'}= 80) ativo no momento.</p>
          ) : (
            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              {activeSignals.filter(s => (s.confidence_score || 0) >= 80 && s.signal_type === 'BUY').map((signal) => (
                <div key={signal.id} className="surface border-neutral-800 p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-neutral-200">{signal.symbol}</p>
                      <p className="text-xs text-neutral-500">{signal.name}</p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        typeColors[signal.signal_type] ?? 'border-neutral-700 bg-neutral-800 text-neutral-300'
                      }`}
                    >
                      {signal.signal_type}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-neutral-500">
                    <div>
                      <p className="uppercase tracking-wide">Confiança</p>
                      <p className="text-sm font-semibold text-neutral-100">{formatPercent(signal.confidence_score)}</p>
                    </div>
                    <div>
                      <p className="uppercase tracking-wide">Multiplicador</p>
                      <p className="text-sm font-semibold text-neutral-100">
                        {signal.potential_multiplier ? `${signal.potential_multiplier.toFixed(2)}x` : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="uppercase tracking-wide">Liquidez</p>
                      <p className="text-sm text-neutral-200">{formatCurrency(signal.liquidity_usd)}</p>
                    </div>
                    <div>
                      <p className="uppercase tracking-wide">Volume 24h</p>
                      <p className="text-sm text-neutral-200">{formatCurrency(signal.volume_24h_usd)}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-neutral-500">
                    <div>
                      <p className="uppercase tracking-wide">Preço do sinal</p>
                      <p className="text-sm text-neutral-200">{formatCurrency(signal.price_at_signal)}</p>
                    </div>
                    <div>
                      <p className="uppercase tracking-wide">Preço atual</p>
                      <div className="flex items-center gap-1">
                        <p className="text-sm text-neutral-200">{formatCurrency(signal.price_usd)}</p>
                        {signal.price_at_signal && signal.price_usd && (() => {
                          const priceChange = ((signal.price_usd - signal.price_at_signal) / signal.price_at_signal) * 100
                          const isPositive = priceChange > 0
                          const isSignificant = Math.abs(priceChange) > 5
                          return (
                            <span
                              className={`text-xs font-semibold ${isPositive ? 'text-emerald-400' : 'text-rose-400'} ${
                                isSignificant ? 'animate-pulse' : ''
                              }`}
                            >
                              {isPositive ? '↑' : '↓'} {Math.abs(priceChange).toFixed(2)}%
                            </span>
                          )
                        })()}
                      </div>
                    </div>
                    <div>
                      <p className="uppercase tracking-wide">Score geral</p>
                      <p className="text-sm text-neutral-200">{formatPercent(signal.overall_score)}</p>
                    </div>
                    <div>
                      <p className="uppercase tracking-wide">Score segurança</p>
                      <p className="text-sm text-neutral-200">{formatPercent(signal.safety_score)}</p>
                    </div>
                  </div>

                  {signal.signal_type === 'BUY' && intendedInvestments.has(signal.token_id) && (
                    <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                        Bot pretende investir
                      </p>
                      <p className="mt-1 text-lg font-bold text-emerald-200">
                        {formatCurrency(intendedInvestments.get(signal.token_id))}
                      </p>
                      <p className="mt-1 text-[11px] text-emerald-400/80">
                        Baseado em confiança de {formatPercent(signal.confidence_score)} e multiplicador de{' '}
                        {signal.potential_multiplier?.toFixed(2)}x
                      </p>
                    </div>
                  )}

                  {signal.reasoning && (
                    <p className="mt-4 text-sm text-neutral-400 leading-relaxed">{signal.reasoning}</p>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-neutral-500">
                    {[
                      { label: 'Volume', value: signal.volume_score },
                      { label: 'Liquidez', value: signal.liquidity_score },
                      { label: 'Holders', value: signal.holders_score },
                      { label: 'Idade', value: signal.age_score },
                    ]
                      .filter((item) => item.value != null)
                      .map((item) => (
                        <span key={item.label} className="rounded-full border border-neutral-700/60 bg-neutral-800/40 px-3 py-1">
                          {item.label}: {formatPercent(item.value)}
                        </span>
                      ))}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2 text-[11px] items-center">
                    <Link
                      href={`https://dexscreener.com/solana/${signal.contract_address || signal.token_id}`}
                      className="rounded-full border border-purple-500/40 bg-purple-500/10 px-3 py-1 text-purple-200 hover:text-purple-100 transition-colors"
                      target="_blank"
                    >
                      Abrir no DexScreener
                    </Link>
                    <p className="text-[10px] text-neutral-600">
                      Emitido em {(() => {
                        const d = new Date(signal.created_at);
                        d.setHours(d.getHours() - 3); // Forçar fuso horário de Brasília (-3h)
                        return d.toLocaleString('pt-BR');
                      })()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="mt-10 surface-strong p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-neutral-100">Histórico recente</h2>
            <span className="text-xs uppercase tracking-[0.3em] text-neutral-500">
              {loading ? 'CARREGANDO...' : `${history.length} REGISTROS`}
            </span>
          </div>

          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full text-sm text-neutral-300">
              <thead className="text-xs uppercase tracking-[0.3em] text-neutral-500">
                <tr>
                  <th className="py-3 text-left">Token</th>
                  <th className="py-3 text-left">Sinal</th>
                  <th className="py-3 text-left">Score</th>
                  <th className="py-3 text-left">Confiança</th>
                  <th className="py-3 text-left">Multiplicador</th>
                  <th className="py-3 text-left">Emitido</th>
                  <th className="py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 50).map((signal) => (
                  <tr key={signal.id} className="border-t border-neutral-800">
                    <td className="py-3">
                      <div>
                        <p className="text-sm font-medium text-neutral-200">{signal.symbol}</p>
                        <p className="text-xs text-neutral-500">{signal.name}</p>
                      </div>
                    </td>
                    <td className="py-3">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          typeColors[signal.signal_type] ?? 'border-neutral-700 bg-neutral-800 text-neutral-300'
                        }`}
                      >
                        {signal.signal_type}
                      </span>
                    </td>
                    <td className="py-3">{formatPercent(signal.overall_score)}</td>
                    <td className="py-3">{formatPercent(signal.confidence_score)}</td>
                    <td className="py-3">
                      {signal.potential_multiplier ? `${signal.potential_multiplier.toFixed(2)}x` : '—'}
                    </td>
                    <td className="py-3">{(() => {
                      const d = new Date(signal.created_at);
                      d.setHours(d.getHours() - 3); // Forçar fuso horário de Brasília (-3h)
                      return d.toLocaleString('pt-BR');
                    })()}</td>
                    <td className="py-3">
                      {signal.is_active ? (
                        <span className="text-xs uppercase text-emerald-300">Ativo</span>
                      ) : (
                        <span className="text-xs uppercase text-neutral-500">Encerrado</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}

