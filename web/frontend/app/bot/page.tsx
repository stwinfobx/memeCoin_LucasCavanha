'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '../contexts/AuthContext'

type BotStatus = {
  bot_enabled: boolean
  bot_intensity: number
  risk_profile: 'conservative' | 'moderate' | 'aggressive'
  max_loss_percent: number
  max_gain_percent: number
  max_open_trades: number
} | null

const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

export default function BotPage() {
  const router = useRouter()
  const { token, isAuthenticated, isLoading } = useAuth()
  const [botStatus, setBotStatus] = useState<BotStatus>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/auth/login')
    }
  }, [isAuthenticated, isLoading, router])

  useEffect(() => {
    if (!token) return

    fetchBotStatus()
  }, [token])

  const fetchBotStatus = async () => {
    if (!token) return

    try {
      setLoading(true)
      const response = await fetch(`${apiBase}/api/bot/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!response.ok) {
        throw new Error('Falha ao carregar status do bot')
      }

      const json = await response.json()
      setBotStatus(json.data)
    } catch (err: any) {
      console.error('[Bot] fetch error:', err)
      setError(err.message || 'Não foi possível carregar o status do bot')
    } finally {
      setLoading(false)
    }
  }

  const [updateTimeout, setUpdateTimeout] = useState<NodeJS.Timeout | null>(null)

  const updateConfig = async (updates: Partial<BotStatus>, immediate = false) => {
    if (!token || !botStatus) return

    // Debounce para evitar muitas requisições durante slider drag
    if (updateTimeout) {
      clearTimeout(updateTimeout)
    }

    // Atualizar estado local imediatamente para feedback visual
    setBotStatus((prev) => (prev ? { ...prev, ...updates } : null))

    const doUpdate = async () => {
      try {
        setSaving(true)
        const response = await fetch(`${apiBase}/api/bot/config`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...botStatus,
            ...updates,
          }),
        })

        if (!response.ok) {
          if (response.status === 429) {
            throw new Error('Muitas requisições. Aguarde um momento...')
          }
          throw new Error('Falha ao atualizar configurações')
        }

        const json = await response.json()
        setBotStatus(json.data)
        setError(null)
      } catch (err: any) {
        console.error('[Bot] update error:', err)
        setError(err.message || 'Erro ao atualizar configurações')
        // Reverter estado em caso de erro
        fetchBotStatus()
      } finally {
        setSaving(false)
      }
    }

    if (immediate) {
      doUpdate()
    } else {
      // Debounce de 500ms para sliders
      const timeout = setTimeout(doUpdate, 500)
      setUpdateTimeout(timeout)
    }
  }

  useEffect(() => {
    return () => {
      if (updateTimeout) {
        clearTimeout(updateTimeout)
      }
    }
  }, [updateTimeout])

  const toggleBot = async () => {
    if (!token || !botStatus) return

    try {
      setSaving(true)
      const endpoint = botStatus.bot_enabled ? 'stop' : 'start'
      const response = await fetch(`${apiBase}/api/bot/${endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!response.ok) {
        throw new Error('Falha ao alterar status do bot')
      }

      const json = await response.json()
      setBotStatus((prev) => (prev ? { ...prev, bot_enabled: json.data.bot_enabled } : null))
      setError(null)
    } catch (err: any) {
      console.error('[Bot] toggle error:', err)
      setError(err.message || 'Erro ao alterar status do bot')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950">
        <div className="mx-auto max-w-4xl px-6 py-10">
          <div className="text-center text-neutral-500">Carregando configurações do bot...</div>
        </div>
      </div>
    )
  }

  if (!botStatus) {
    return (
      <div className="min-h-screen bg-neutral-950">
        <div className="mx-auto max-w-4xl px-6 py-10">
          <div className="text-center text-neutral-600">Erro ao carregar status do bot</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <header className="flex flex-wrap items-center justify-between gap-6 border-b border-neutral-900 pb-8">
          <div>
            <span className="section-title">Configurações</span>
            <h1 className="mt-3 text-3xl font-semibold text-neutral-50">Status do bot</h1>
            <p className="mt-2 text-sm text-neutral-500">
              Configure o comportamento do bot: intensidade, perfil de risco e limites de operação.
            </p>
          </div>
          <Link href="/dashboard" className="btn-secondary px-4 py-2 text-sm">
            Voltar ao dashboard
          </Link>
        </header>

        {error && (
          <div className="surface-strong mt-8 border border-rose-500/40 px-5 py-4 text-sm text-rose-200">
            {error}
          </div>
        )}

        <div className="mt-10 space-y-8">
          {/* Status do Bot */}
          <div className="surface-strong p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-neutral-100">Status do bot</h2>
              <div className="flex items-center gap-2">
                <span
                  className={`h-3 w-3 rounded-full ${botStatus.bot_enabled ? 'bg-emerald-400' : 'bg-rose-400'}`}
                  aria-hidden="true"
                />
                <span className="text-sm text-neutral-300">
                  {botStatus.bot_enabled ? 'Ativo' : 'Inativo'}
                </span>
              </div>
            </div>
            <dl className="mt-6 space-y-3 text-sm text-neutral-300">
              <div className="flex justify-between">
                <dt>Modo</dt>
                <dd className="font-semibold">{botStatus.bot_enabled ? 'Ativo' : 'Inativo'}</dd>
              </div>
            </dl>
            <button
              className="btn-primary mt-6 w-full py-3 text-sm font-semibold disabled:opacity-60"
              onClick={toggleBot}
              disabled={saving}
            >
              {saving ? 'Atualizando...' : botStatus.bot_enabled ? 'Parar bot' : 'Iniciar bot'}
            </button>
          </div>

          {/* Intensidade */}
          <div className="surface-strong p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-neutral-100">Intensidade</h2>
                <p className="mt-1 text-sm text-neutral-500">
                  Controla quantas oportunidades o bot deve buscar por minuto (1 = conservador, 10 = agressivo)
                </p>
              </div>
              <div className="text-2xl font-bold text-purple-400">{botStatus.bot_intensity}/10</div>
            </div>
            <input
              type="range"
              min="1"
              max="10"
              value={botStatus.bot_intensity}
              onChange={(e) => updateConfig({ bot_intensity: Number(e.target.value) }, false)}
              className="mt-6 h-2 w-full cursor-pointer appearance-none rounded-lg bg-neutral-800 accent-purple-500"
            />
            <div className="mt-2 flex justify-between text-xs text-neutral-500">
              <span>Conservador (1)</span>
              <span>Agressivo (10)</span>
            </div>
          </div>

          {/* Perfil de Risco */}
          <div className="surface-strong p-6">
            <h2 className="text-lg font-semibold text-neutral-100">Perfil de risco</h2>
            <p className="mt-1 text-sm text-neutral-500">
              Define a quantidade de capital que o bot investe por trade
            </p>
            <div className="mt-6 grid grid-cols-3 gap-4">
              {(['conservative', 'moderate', 'aggressive'] as const).map((profile) => (
                <button
                  key={profile}
                  onClick={() => updateConfig({ risk_profile: profile }, true)}
                  className={`rounded-lg border-2 p-4 text-sm font-semibold transition-all ${
                    botStatus.risk_profile === profile
                      ? 'border-purple-500 bg-purple-500/20 text-purple-200'
                      : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-700'
                  }`}
                >
                  <div className="mb-2 text-lg font-bold capitalize">{profile}</div>
                  <div className="text-xs text-neutral-500">
                    {profile === 'conservative' && '1% por trade'}
                    {profile === 'moderate' && '3% por trade'}
                    {profile === 'aggressive' && '6% por trade'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Perda Máxima */}
          <div className="surface-strong p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-neutral-100">Perda máxima</h2>
                <p className="mt-1 text-sm text-neutral-500">
                  Stop-loss automático: vende automaticamente se a posição perder mais que este percentual
                </p>
              </div>
              <div className="text-2xl font-bold text-rose-400">{botStatus.max_loss_percent}%</div>
            </div>
            <input
              type="range"
              min="1"
              max="50"
              value={botStatus.max_loss_percent}
              onChange={(e) => updateConfig({ max_loss_percent: Number(e.target.value) }, false)}
              className="mt-6 h-2 w-full cursor-pointer appearance-none rounded-lg bg-neutral-800 accent-rose-500"
            />
            <div className="mt-2 flex justify-between text-xs text-neutral-500">
              <span>1%</span>
              <span>50%</span>
            </div>
          </div>

          {/* Ganho Máximo */}
          <div className="surface-strong p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-neutral-100">Ganho máximo</h2>
                <p className="mt-1 text-sm text-neutral-500">
                  Take-profit automático: vende automaticamente quando a posição ganha mais que este percentual
                </p>
              </div>
              <div className="text-2xl font-bold text-emerald-400">{botStatus.max_gain_percent}%</div>
            </div>
            <input
              type="range"
              min="5"
              max="500"
              value={botStatus.max_gain_percent}
              onChange={(e) => updateConfig({ max_gain_percent: Number(e.target.value) }, false)}
              className="mt-6 h-2 w-full cursor-pointer appearance-none rounded-lg bg-neutral-800 accent-emerald-500"
            />
            <div className="mt-2 flex justify-between text-xs text-neutral-500">
              <span>5%</span>
              <span>500%</span>
            </div>
          </div>

          {/* Trades Paralelos */}
          <div className="surface-strong p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-neutral-100">Trades paralelos</h2>
                <p className="mt-1 text-sm text-neutral-500">
                  Número máximo de posições abertas simultaneamente (o bot aguarda até uma posição fechar antes de abrir nova)
                </p>
              </div>
              <div className="text-2xl font-bold text-sky-400">{botStatus.max_open_trades}</div>
            </div>
            <input
              type="range"
              min="1"
              max="10"
              value={botStatus.max_open_trades}
              onChange={(e) => updateConfig({ max_open_trades: Number(e.target.value) }, false)}
              className="mt-6 h-2 w-full cursor-pointer appearance-none rounded-lg bg-neutral-800 accent-sky-500"
            />
            <div className="mt-2 flex justify-between text-xs text-neutral-500">
              <span>1 posição</span>
              <span>10 posições</span>
            </div>
          </div>

          {/* Link para Logs */}
          <div className="surface-strong p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-neutral-100">Logs e notificações</h2>
                <p className="mt-1 text-sm text-neutral-500">
                  Veja tudo que o bot está fazendo em tempo real: validações, sinais, compras, vendas...
                </p>
              </div>
              <Link href="/notifications" className="btn-primary px-4 py-2 text-sm">
                Ver logs do bot
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

