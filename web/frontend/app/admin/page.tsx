'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../contexts/AuthContext'
import Link from 'next/link'

type SystemSetting = {
  key: string
  value: string
  description: string
  is_secret: boolean
  updated_at: string
}

type UserPerformance = {
  user_id: string
  email: string
  total_deposits: number
  total_withdrawals: number
  total_profit: number
  total_loss: number
  total_trades: number
  completed_trades: number
}

type ServiceHealth = {
  service_name: string
  status: 'online' | 'error' | 'rate_limited'
  last_error: string | null
  updated_at: string
}

const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

export default function AdminPage() {
  const router = useRouter()
  const { token, user, isAuthenticated, isLoading } = useAuth()
  const [settings, setSettings] = useState<SystemSetting[]>([])
  const [users, setUsers] = useState<UserPerformance[]>([])
  const [health, setHealth] = useState<ServiceHealth[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'engine' | 'apis' | 'users'>('engine')
  
  // States para modal de edição (Settings)
  const [editingSetting, setEditingSetting] = useState<SystemSetting | null>(null)
  const [newValue, setNewValue] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // States para modal de detalhes de usuário
  const [viewUser, setViewUser] = useState<UserPerformance | null>(null)

  const isAdmin = user?.email === 'mulack.zuguenberg@gmail.com'

  useEffect(() => {
    if (!isLoading && (!isAuthenticated || !isAdmin)) {
      router.push('/dashboard')
    }
  }, [isAuthenticated, isAdmin, isLoading, router])

  const fetchData = async () => {
    if (!token) return
    setLoading(true)
    try {
      const [settingsRes, usersRes, healthRes] = await Promise.all([
        fetch(`${apiBase}/api/admin/settings`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(`${apiBase}/api/admin/users`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(`${apiBase}/api/admin/health`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ])

      if (settingsRes.ok) {
        const s = await settingsRes.json()
        setSettings(s.data)
      }
      if (usersRes.ok) {
        const u = await usersRes.json()
        setUsers(u.data)
      }
      if (healthRes) {
         if (healthRes.ok) {
           const h = await healthRes.json()
           setHealth(h.data)
         }
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthenticated && isAdmin && token) {
      fetchData()
    }
  }, [isAuthenticated, isAdmin, token])

  const handleUpdateSetting = async (key: string, value: string) => {
    if (!token) return
    setIsSaving(true)
    try {
      const res = await fetch(`${apiBase}/api/admin/settings/${key}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ value })
      })

      if (res.ok) {
        setEditingSetting(null)
        fetchData()
      } else {
        const errorData = await res.json()
        alert(`Erro: ${errorData.message}`)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsSaving(false)
    }
  }

  const toggleEngine = async (currentStatus: string) => {
    const nextStatus = currentStatus === 'true' ? 'false' : 'true'
    await handleUpdateSetting('VALIDATOR_ENGINE_ACTIVE', nextStatus)
  }

  if (isLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950">
        <div className="text-purple-500 animate-pulse text-xl font-mono">Carregando painel admin...</div>
      </div>
    )
  }

  const engineStatus = settings.find(s => s.key === 'VALIDATOR_ENGINE_ACTIVE')?.value === 'true'

  const getHealthForSetting = (key: string) => {
    if (key.includes('HELIUS')) return health.find(h => h.service_name === 'HELIUS')
    if (key.includes('GOPLUS')) return health.find(h => h.service_name === 'GOPLUS')
    if (key.includes('SOLSCAN') || key.includes('SOLANA')) return health.find(h => h.service_name === 'SOLSCAN')
    return undefined // null implies we don't track it
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 p-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-10 flex items-center justify-between border-b border-neutral-800 pb-6">
          <div>
            <h1 className="text-3xl font-bold text-neutral-50 flex items-center gap-3">
              <span className="text-purple-500">🛡️</span> Painel Administrativo
            </h1>
            <p className="mt-2 text-neutral-500">Gestão de infraestrutura, usuários e provedores de dados.</p>
          </div>
          <Link href="/dashboard" className="px-4 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-sm hover:bg-neutral-800 transition-all text-neutral-300">
            ← Voltar para Dashboard
          </Link>
        </header>

        {/* Tabs */}
        <div className="flex gap-4 mb-8">
          {[
            { id: 'engine', label: 'Motor do Bot', icon: '⚡' },
            { id: 'apis', label: 'Chaves de API', icon: '🔑' },
            { id: 'users', label: 'Gestão de Usuários', icon: '👥' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-6 py-3 rounded-xl border flex items-center gap-2 transition-all ${
                activeTab === tab.id 
                ? 'bg-purple-600/10 border-purple-500 text-purple-200' 
                : 'bg-neutral-900 border-neutral-800 text-neutral-500 hover:border-neutral-700'
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'engine' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className={`p-8 rounded-3xl border ${engineStatus ? 'bg-emerald-500/5 border-emerald-500/30' : 'bg-rose-500/5 border-rose-500/30'} flex flex-col items-center justify-center text-center`}>
              <div className={`w-20 h-20 rounded-full flex items-center justify-center text-4xl mb-4 ${engineStatus ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                {engineStatus ? '🟢' : '🔴'}
              </div>
              <h2 className="text-2xl font-bold mb-2">Motor de Busca & Validação</h2>
              <p className="text-neutral-500 mb-8 max-w-sm">
                {engineStatus 
                  ? 'O sistema está capturando e validando novas moedas em tempo real consumindo créditos das APIs.' 
                  : 'A busca de moedas está pausada. Nenhuma API Key será consumida agora.'
                }
              </p>
              <button
                onClick={() => toggleEngine(engineStatus ? 'true' : 'false')}
                disabled={isSaving}
                className={`px-10 py-4 rounded-2xl font-bold text-lg transition-all ${
                  engineStatus 
                  ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/20' 
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20'
                }`}
              >
                {isSaving ? 'Processando...' : engineStatus ? 'DESLIGAR MOTOR' : 'LIGAR MOTOR'}
              </button>
            </div>

            <div className="bg-neutral-900/50 border border-neutral-800 p-8 rounded-3xl">
              <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                <span className="text-neutral-500">📋</span> Status do Validador
              </h3>
              <div className="space-y-4">
                 {health.length === 0 ? (
                   <p className="text-neutral-500 italic text-sm">Carregando status (ou nenhum serviço monitorado ainda)...</p>
                 ) : (
                   health.map(h => (
                     <div key={h.service_name} className={`flex flex-col p-4 bg-black/20 rounded-2xl border ${h.status === 'online' ? 'border-emerald-900/30' : 'border-rose-900/50'}`}>
                        <div className="flex justify-between items-center w-full">
                          <span className="text-neutral-400 font-medium">{h.service_name}</span>
                          <span className={`font-mono font-bold text-sm ${h.status === 'online' ? 'text-emerald-400' : h.status === 'rate_limited' ? 'text-orange-400' : 'text-rose-400'}`}>
                            {h.status.toUpperCase()}
                          </span>
                        </div>
                        {h.status !== 'online' && h.last_error && (
                          <div className="mt-2 text-xs text-rose-300 bg-rose-500/10 p-2 rounded border border-rose-500/20">
                            {h.last_error}
                          </div>
                        )}
                        <span className="text-[10px] text-neutral-600 mt-2">
                          Atualizado: {new Date(h.updated_at).toLocaleString()}
                        </span>
                     </div>
                   ))
                 )}
              </div>
              <div className="mt-8 p-4 bg-purple-500/10 border border-purple-500/20 rounded-2xl text-xs text-purple-300 flex gap-3">
                <span className="text-lg">💡</span>
                <p>Desligar o motor é a forma mais rápida de preservar seus tokens quando o sistema não está sendo operado.</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'apis' && (
          <div className="bg-neutral-900/50 border border-neutral-800 rounded-3xl overflow-hidden animate-in fade-in duration-500">
            <table className="w-full text-left">
              <thead className="bg-black/40 text-neutral-500 text-sm uppercase tracking-wider">
                <tr>
                  <th className="px-8 py-5">Provedor / Configuração</th>
                  <th className="px-8 py-5">Valor (Censurado)</th>
                  <th className="px-8 py-5">Status</th>
                  <th className="px-8 py-5">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {settings.filter(s => s.key !== 'VALIDATOR_ENGINE_ACTIVE').map(setting => (
                  <tr key={setting.key} className="hover:bg-neutral-800/30 transition-colors">
                    <td className="px-8 py-6">
                      <p className="font-semibold text-neutral-100">{setting.key.replace(/_/g, ' ')}</p>
                      <p className="text-xs text-neutral-500 mt-1">{setting.description}</p>
                    </td>
                    <td className="px-8 py-6">
                      <code className="text-purple-400 font-mono bg-purple-400/5 px-2 py-1 rounded">
                        {setting.value || 'vazio'}
                      </code>
                    </td>
                    <td className="px-8 py-6">
                      {(() => {
                        const h = getHealthForSetting(setting.key)
                        if (!h) {
                          return (
                            <span className="flex items-center gap-2 text-emerald-400 text-sm">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                              Ativo
                            </span>
                          )
                        }
                        if (h.status === 'online') {
                          return (
                            <span className="flex items-center gap-2 text-emerald-400 text-sm">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                              Conectado
                            </span>
                          )
                        }
                        if (h.status === 'rate_limited') {
                          return (
                            <span className="flex items-center gap-2 text-orange-400 text-sm">
                              <span className="w-1.5 h-1.5 rounded-full bg-orange-400"></span>
                              Limite Atingido
                            </span>
                          )
                        }
                        return (
                          <span className="flex items-center gap-2 text-rose-400 text-sm">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                            Erro: {h.last_error?.substring(0, 15)}...
                          </span>
                        )
                      })()}
                    </td>
                    <td className="px-8 py-6">
                      <button 
                        onClick={() => {
                          setEditingSetting(setting)
                          setNewValue('')
                        }}
                        className="text-xs bg-neutral-800 border border-neutral-700 px-3 py-1.5 rounded-lg hover:border-purple-500 hover:text-purple-300 transition-all font-medium"
                      >
                        EDITAR
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="bg-neutral-900/50 border border-neutral-800 rounded-3xl overflow-hidden animate-in fade-in duration-500">
            <table className="w-full text-left">
              <thead className="bg-black/40 text-neutral-500 text-sm uppercase tracking-wider">
                <tr>
                  <th className="px-8 py-5">Usuário</th>
                  <th className="px-8 py-5 text-right">Saldo Atual</th>
                  <th className="px-8 py-5 text-right">Lucro/Prejuízo</th>
                  <th className="px-8 py-5 text-right">Trades</th>
                  <th className="px-8 py-5 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {users.map(u => (
                  <tr key={u.user_id} className="hover:bg-neutral-800/30">
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-neutral-800 flex items-center justify-center text-xs font-bold text-neutral-400">
                          {u.email[0].toUpperCase()}
                        </div>
                        <span className="font-medium">{u.email}</span>
                      </div>
                    </td>
                    <td className="px-8 py-6 text-right font-mono text-neutral-300">
                      US$ {(u.total_deposits - u.total_withdrawals).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className={`px-8 py-6 text-right font-mono font-bold ${u.total_profit - u.total_loss >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {u.total_profit - u.total_loss >= 0 ? '+' : ''}(US$ {Math.abs(u.total_profit - u.total_loss).toLocaleString('pt-BR', { minimumFractionDigits: 2 })})
                    </td>
                    <td className="px-8 py-6 text-right text-neutral-400">
                      {u.completed_trades} / {u.total_trades}
                    </td>
                    <td className="px-8 py-6 text-center">
                      <button 
                        onClick={() => setViewUser(u)}
                        className="text-xs bg-neutral-800 border border-neutral-700 px-3 py-1.5 rounded-lg hover:border-purple-500 hover:text-purple-300 transition-all font-medium"
                      >
                        DETALHES
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Modal de Edição */}
        {editingSetting && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-neutral-900 border border-neutral-800 p-8 rounded-3xl w-full max-w-md shadow-2xl">
              <h3 className="text-xl font-bold mb-2">Editar Configuração</h3>
              <p className="text-purple-400 text-sm font-mono mb-6">{editingSetting.key}</p>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-neutral-500 uppercase mb-2">Novo Valor</label>
                  <input 
                    type="password"
                    placeholder="Cole a nova chave aqui..."
                    className="w-full bg-black border border-neutral-800 rounded-xl px-4 py-3 focus:border-purple-500 focus:outline-none transition-all"
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                  />
                  <p className="mt-2 text-[10px] text-neutral-600">
                    Por segurança, o valor atual não é exibido. Insira a nova chave completa.
                  </p>
                </div>
              </div>

              <div className="mt-8 flex gap-3">
                <button 
                  onClick={() => handleUpdateSetting(editingSetting.key, newValue)}
                  disabled={!newValue || isSaving}
                  className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 py-3 rounded-xl font-bold transition-all"
                >
                  {isSaving ? 'Salvando...' : 'SALVAR ALTERAÇÃO'}
                </button>
                <button 
                  onClick={() => setEditingSetting(null)}
                  className="flex-1 bg-neutral-800 hover:bg-neutral-700 py-3 rounded-xl font-bold transition-all"
                >
                  CANCELAR
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal de Detalhes de Usuário */}
        {viewUser && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-neutral-900 border border-neutral-800 p-8 rounded-3xl w-full max-w-md shadow-2xl">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-xl font-bold">Gestão do Usuário</h3>
                  <p className="text-purple-400 text-sm font-mono mt-1">{viewUser.email}</p>
                </div>
                <button onClick={() => setViewUser(null)} className="text-neutral-500 hover:text-white">✕</button>
              </div>
              
              <div className="space-y-4 text-sm text-neutral-300">
                <div className="bg-black/30 p-4 rounded-xl border border-neutral-800/50">
                   <p className="flex justify-between mb-2"><span className="text-neutral-500">Saldo Operacional:</span> <span className="font-mono">US$ {(viewUser.total_deposits - viewUser.total_withdrawals + viewUser.total_profit - viewUser.total_loss).toFixed(2)}</span></p>
                   <p className="flex justify-between mb-2"><span className="text-neutral-500">Tamanho Payout (Nível):</span> <span className="font-mono text-emerald-400">92%</span></p>
                   <p className="flex justify-between"><span className="text-neutral-500">ID na Base:</span> <span className="font-mono text-xs max-w-[120px] truncate">{viewUser.user_id}</span></p>
                </div>
              </div>

              <div className="mt-8 space-y-3">
                <button 
                  onClick={() => alert(`Acesso de ${viewUser.email} bloqueado visualmente (Simulação). Crie a API para Persistir.`)}
                  className="w-full bg-orange-500/10 border border-orange-500/20 hover:bg-orange-500/20 text-orange-400 py-3 rounded-xl font-bold transition-all text-sm"
                >
                  BLOQUEAR ACESSO
                </button>
                <button 
                  onClick={() => alert(`Aviso de exclusão permanente para ${viewUser.email} (Simulação). Crie a API para Persistir.`)}
                  className="w-full bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20 text-rose-400 py-3 rounded-xl font-bold transition-all text-sm"
                >
                  EXCLUIR CONTA
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
