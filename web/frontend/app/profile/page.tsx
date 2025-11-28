'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '../contexts/AuthContext'

type ProfileData = {
  full_name?: string
  phone?: string
  bank_account_number?: string
  bank_name?: string
  bank_routing_number?: string
  wallet_address?: string
  risk_profile: 'conservative' | 'moderate' | 'aggressive'
  bot_enabled: boolean
  bot_intensity: number
  max_loss_percent: number
  max_gain_percent: number
  max_open_trades: number
}

const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

const defaultProfile: ProfileData = {
  full_name: '',
  phone: '',
  bank_account_number: '',
  bank_name: '',
  bank_routing_number: '',
  wallet_address: '',
  risk_profile: 'moderate',
  bot_enabled: false,
  bot_intensity: 5,
  max_loss_percent: 10,
  max_gain_percent: 25,
  max_open_trades: 3,
}

export default function ProfilePage() {
  const router = useRouter()
  const { token, isAuthenticated, isLoading, user } = useAuth()
  const [profile, setProfile] = useState<ProfileData>(defaultProfile)
  const [loading, setLoading] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingRisk, setSavingRisk] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const userFirstLetter = useMemo(() => user?.email?.[0]?.toUpperCase() ?? 'U', [user?.email])

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/auth/login')
    }
  }, [isAuthenticated, isLoading, router])

  useEffect(() => {
    if (!token) return

    const controller = new AbortController()

    async function fetchProfile() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`${apiBase}/api/profile`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })

        if (!response.ok) {
          const body = await response.json().catch(() => ({}))
          throw new Error(body?.error?.message || 'Falha ao carregar perfil.')
        }

        const json = await response.json()
        const profileData = json.data?.profile
        setProfile({
          ...defaultProfile,
          ...profileData,
        })
      } catch (err: any) {
        if (err.name === 'AbortError') return
        console.error('[Profile] fetch error:', err)
        setError(err.message || 'Não foi possível carregar as informações do perfil.')
      } finally {
        setLoading(false)
      }
    }

    fetchProfile()
    return () => controller.abort()
  }, [token])

  const handleProfileSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token) return
    setSavingProfile(true)
    setMessage(null)
    setError(null)

    try {
      const payload = {
        full_name: profile.full_name,
        phone: profile.phone,
        bank_account_number: profile.bank_account_number,
        bank_name: profile.bank_name,
        bank_routing_number: profile.bank_routing_number,
        wallet_address: profile.wallet_address,
      }

      const response = await fetch(`${apiBase}/api/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.error?.message || 'Erro ao salvar perfil.')
      }

      setMessage('Perfil atualizado com sucesso.')
    } catch (err: any) {
      console.error('[Profile] save error:', err)
      setError(err.message || 'Não foi possível salvar as alterações.')
    } finally {
      setSavingProfile(false)
    }
  }

  const handleRiskSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token) return
    setSavingRisk(true)
    setMessage(null)
    setError(null)

    try {
      const payload = {
        bot_enabled: profile.bot_enabled,
        bot_intensity: profile.bot_intensity,
        risk_profile: profile.risk_profile,
        max_loss_percent: profile.max_loss_percent,
        max_gain_percent: profile.max_gain_percent,
        max_open_trades: profile.max_open_trades,
      }

      const response = await fetch(`${apiBase}/api/bot/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.error?.message || 'Erro ao atualizar configurações de risco.')
      }

      setMessage('Configurações de risco atualizadas.')
    } catch (err: any) {
      console.error('[Profile] risk save error:', err)
      setError(err.message || 'Não foi possível atualizar as configurações.')
    } finally {
      setSavingRisk(false)
    }
  }

  const handleProfileChange = (field: keyof ProfileData, value: string | number | boolean) => {
    setProfile((prev) => ({
      ...prev,
      [field]: value,
    }))
  }

  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <header className="flex flex-wrap items-center justify-between gap-6 border-b border-neutral-900 pb-6">
          <div>
            <span className="section-title">Perfil</span>
            <h1 className="mt-3 text-3xl font-semibold text-neutral-50">Dados pessoais e estratégia</h1>
            <p className="mt-2 text-sm text-neutral-500">
              Ajuste informações cadastrais, credenciais de blockchain e parâmetros operacionais do bot.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="btn-secondary px-4 py-2 text-sm">
              Voltar ao dashboard
            </Link>
            <div className="badge">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-neutral-800 text-sm font-semibold text-neutral-200">
                {userFirstLetter}
              </span>
              <span>{user?.email}</span>
            </div>
          </div>
        </header>

        {message && (
          <div className="surface-strong mt-8 border border-emerald-500/40 px-5 py-4 text-sm text-emerald-200">
            {message}
          </div>
        )}
        {error && (
          <div className="surface-strong mt-8 border border-rose-500/40 px-5 py-4 text-sm text-rose-200">
            {error}
          </div>
        )}

        {loading ? (
          <div className="surface-strong mt-8 px-6 py-16 text-center text-sm text-neutral-500">
            Carregando informações do perfil...
          </div>
        ) : (
          <div className="mt-10 space-y-8">
            <form onSubmit={handleProfileSave} className="surface-strong p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-neutral-100">Informações gerais</h2>
                <span className="section-title">Identidade</span>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
                <div>
                  <label className="text-xs font-medium uppercase tracking-[0.3em] text-neutral-500">Nome completo</label>
                  <input
                    type="text"
                    className="input-field mt-2"
                    value={profile.full_name ?? ''}
                    onChange={(event) => handleProfileChange('full_name', event.target.value)}
                    placeholder="Seu nome completo"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium uppercase tracking-[0.3em] text-neutral-500">Telefone</label>
                  <input
                    type="tel"
                    className="input-field mt-2"
                    value={profile.phone ?? ''}
                    onChange={(event) => handleProfileChange('phone', event.target.value)}
                    placeholder="+55 (00) 00000-0000"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium uppercase tracking-[0.3em] text-neutral-500">Wallet BSC</label>
                  <input
                    type="text"
                    className="input-field mt-2"
                    value={profile.wallet_address ?? ''}
                    onChange={(event) => handleProfileChange('wallet_address', event.target.value)}
                    placeholder="0x..."
                  />
                </div>
              </div>

              <div className="mt-8">
                <h3 className="section-title">Dados bancários (opcional)</h3>
                <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-3">
                  <div>
                    <label className="text-xs font-medium uppercase tracking-[0.3em] text-neutral-500">Banco</label>
                    <input
                      type="text"
                      className="input-field mt-2"
                      value={profile.bank_name ?? ''}
                      onChange={(event) => handleProfileChange('bank_name', event.target.value)}
                      placeholder="Nome do banco"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium uppercase tracking-[0.3em] text-neutral-500">Conta</label>
                    <input
                      type="text"
                      className="input-field mt-2"
                      value={profile.bank_account_number ?? ''}
                      onChange={(event) => handleProfileChange('bank_account_number', event.target.value)}
                      placeholder="Número da conta"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium uppercase tracking-[0.3em] text-neutral-500">Agência</label>
                    <input
                      type="text"
                      className="input-field mt-2"
                      value={profile.bank_routing_number ?? ''}
                      onChange={(event) => handleProfileChange('bank_routing_number', event.target.value)}
                      placeholder="Código ou agência"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-8 flex justify-end">
                <button
                  type="submit"
                  className="btn-primary px-6 py-3 text-sm font-semibold disabled:opacity-60"
                  disabled={savingProfile}
                >
                  {savingProfile ? 'Salvando...' : 'Salvar informações'}
                </button>
              </div>
            </form>

            <form onSubmit={handleRiskSave} className="surface-strong p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-neutral-100">Configurações do bot</h2>
                <span className="section-title">Gestão de risco</span>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="surface p-5">
                  <label className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.3em] text-neutral-500">
                    <span>Bot automático</span>
                    <span className={`inline-flex h-2 w-2 rounded-full ${profile.bot_enabled ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                  </label>
                  <div className="mt-4 flex gap-3 text-sm">
                    <button
                      type="button"
                      onClick={() => handleProfileChange('bot_enabled', true)}
                      className={`flex-1 rounded-lg border px-4 py-3 transition ${
                        profile.bot_enabled
                          ? 'border-emerald-400 bg-emerald-500/10 text-emerald-200'
                          : 'border-neutral-700 text-neutral-400 hover:border-emerald-400/50 hover:text-emerald-200'
                      }`}
                    >
                      Ativo
                    </button>
                    <button
                      type="button"
                      onClick={() => handleProfileChange('bot_enabled', false)}
                      className={`flex-1 rounded-lg border px-4 py-3 transition ${
                        !profile.bot_enabled
                          ? 'border-rose-400 bg-rose-500/10 text-rose-200'
                          : 'border-neutral-700 text-neutral-400 hover:border-rose-400/50 hover:text-rose-200'
                      }`}
                    >
                      Inativo
                    </button>
                  </div>
                </div>

                <div className="surface p-5">
                  <label className="block text-xs font-medium uppercase tracking-[0.3em] text-neutral-500">
                    Intensidade do bot
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={profile.bot_intensity}
                    onChange={(event) => handleProfileChange('bot_intensity', Number(event.target.value))}
                    className="mt-4 w-full accent-purple-400"
                  />
                  <div className="mt-2 flex justify-between text-xs text-neutral-500">
                    <span>1</span>
                    <span className="text-neutral-300 font-semibold">{profile.bot_intensity}</span>
                    <span>10</span>
                  </div>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="surface p-5">
                  <label className="block text-xs font-medium uppercase tracking-[0.3em] text-neutral-500">
                    Perfil de risco
                  </label>
                  <div className="mt-4 flex gap-3 text-sm">
                    {(['conservative', 'moderate', 'aggressive'] as const).map((risk) => (
                      <button
                        key={risk}
                        type="button"
                        onClick={() => handleProfileChange('risk_profile', risk)}
                        className={`flex-1 rounded-lg border px-4 py-3 capitalize transition ${
                          profile.risk_profile === risk
                            ? 'border-purple-400 bg-purple-500/10 text-purple-200'
                            : 'border-neutral-700 text-neutral-400 hover:border-purple-400/50 hover:text-purple-200'
                        }`}
                      >
                        {risk}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="surface p-5">
                  <label className="block text-xs font-medium uppercase tracking-[0.3em] text-neutral-500">
                    Limites operacionais
                  </label>
                  <div className="mt-4 grid grid-cols-2 gap-4 text-sm text-neutral-400">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-neutral-500">Perda máxima</p>
                      <input
                        type="number"
                        className="input-field mt-2"
                        value={profile.max_loss_percent}
                        onChange={(event) => handleProfileChange('max_loss_percent', Number(event.target.value))}
                        min={1}
                        max={100}
                      />
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-neutral-500">Ganho máximo</p>
                      <input
                        type="number"
                        className="input-field mt-2"
                        value={profile.max_gain_percent}
                        onChange={(event) => handleProfileChange('max_gain_percent', Number(event.target.value))}
                        min={1}
                        max={300}
                      />
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-neutral-500">Trades paralelos</p>
                      <input
                        type="number"
                        className="input-field mt-2"
                        value={profile.max_open_trades}
                        onChange={(event) => handleProfileChange('max_open_trades', Number(event.target.value))}
                        min={1}
                        max={50}
                      />
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-neutral-500">Score mínimo</p>
                      <p className="mt-3 text-sm text-neutral-400">
                        Utilize os dados do Risk Engine (risk_score &amp; scam_probability) para definir políticas internas.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-8 flex justify-end">
                <button type="submit" className="btn-primary px-6 py-3 text-sm font-semibold disabled:opacity-60" disabled={savingRisk}>
                  {savingRisk ? 'Atualizando...' : 'Salvar configurações do bot'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}

