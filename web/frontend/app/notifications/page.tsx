'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../contexts/AuthContext'

type Notification = {
  id: string
  notification_type: string
  severity: 'success' | 'info' | 'warning' | 'error'
  title: string
  message: string
  data?: any
  is_read: boolean
  created_at: string
}

const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

const severityStyles = {
  success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  info: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  error: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
}

const severityIcons = {
  success: '✅',
  info: 'ℹ️',
  warning: '⚠️',
  error: '❌',
}

export default function NotificationsPage() {
  const router = useRouter()
  const { token, isAuthenticated, isLoading } = useAuth()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    if (isLoading) {
      // Aguardar carregamento completo antes de fazer qualquer coisa
      return
    }
    
    if (!isAuthenticated || !token) {
      setLoading(false)
      router.push('/auth/login')
      return
    }

    // Função para fazer o fetch inicial (sem setar loading aqui, deixar fetchNotifications fazer isso)
    const doInitialFetch = async () => {
      if (token && isAuthenticated) {
        await Promise.all([
          fetchNotifications(),
          fetchUnreadCount()
        ])
      }
    }

    // Aguardar um pouco antes da primeira requisição
    const initialTimeout = setTimeout(() => {
      doInitialFetch()
    }, 500)

    // Atualizar a cada 30 segundos (aumentar intervalo para evitar rate limit)
    const interval = setInterval(() => {
      if (token && isAuthenticated && !loading) {
        fetchNotifications()
        fetchUnreadCount()
      }
    }, 30000) // 30 segundos

    return () => {
      clearTimeout(initialTimeout)
      clearInterval(interval)
    }
  }, [token, isAuthenticated, isLoading, router])

  const fetchNotifications = async () => {
    if (!token || !isAuthenticated) {
      setLoading(false)
      return
    }

    try {
      setError(null)
      setLoading(true) // Setar loading ANTES da requisição
      const response = await fetch(`${apiBase}/api/notifications?limit=100&unread_only=false`, {
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
      })

      if (response.status === 401) {
        // Token inválido - redirecionar para login
        setLoading(false)
        router.push('/auth/login')
        return
      }

      if (response.status === 429) {
        // Rate limit - aguardar antes de tentar novamente
        setLoading(false)
        setError('Muitas requisições. Aguardando um momento...')
        setTimeout(() => {
          if (token && isAuthenticated) {
            fetchNotifications()
          }
        }, 10000) // Aguardar 10 segundos
        return
      }

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Falha ao carregar notificações: ${response.status} ${errorText}`)
      }

      const json = await response.json()
      setNotifications(json.data || [])
      setError(null)
    } catch (err: any) {
      console.error('[Notifications] fetch error:', err)
      if (err.message?.includes('401')) {
        router.push('/auth/login')
      } else if (!err.message?.includes('429')) {
        // Não sobrescrever mensagem de rate limit
        setError(err.message || 'Não foi possível carregar as notificações')
      }
    } finally {
      setLoading(false) // SEMPRE resetar loading no finally
    }
  }

  const fetchUnreadCount = async () => {
    if (!token || !isAuthenticated) return

    try {
      const response = await fetch(`${apiBase}/api/notifications/unread-count`, {
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
      })

      if (response.ok) {
        const json = await response.json()
        setUnreadCount(json.data?.unread_count ?? 0)
      }
    } catch (err) {
      console.error('[Notifications] unread count error:', err)
    }
  }

  const markAsRead = async (notificationId: string) => {
    if (!token) return

    try {
      await fetch(`${apiBase}/api/notifications/${notificationId}/read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })

      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n))
      )
      setUnreadCount((prev) => Math.max(0, prev - 1))
    } catch (err) {
      console.error('[Notifications] mark read error:', err)
    }
  }

  const markAllAsRead = async () => {
    if (!token) return

    try {
      await fetch(`${apiBase}/api/notifications/mark-all-read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })

      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
      setUnreadCount(0)
    } catch (err) {
      console.error('[Notifications] mark all read error:', err)
    }
  }

  const unreadNotifications = notifications.filter((n) => !n.is_read)
  const readNotifications = notifications.filter((n) => n.is_read)

  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <header className="flex flex-wrap items-center justify-between gap-6 border-b border-neutral-900 pb-8">
          <div>
            <span className="section-title">Logs do Bot</span>
            <h1 className="mt-3 text-3xl font-semibold text-neutral-50">Notificações e atividades</h1>
            <p className="mt-2 text-sm text-neutral-500">
              Acompanhe tudo que o bot está fazendo em tempo real: validações, sinais, compras, vendas e muito mais!
            </p>
          </div>
          <div className="flex items-center gap-3">
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="btn-secondary px-4 py-2 text-sm"
              >
                Marcar todas como lidas ({unreadCount})
              </button>
            )}
            <button 
              onClick={() => {
                if (!loading) {
                  fetchNotifications()
                  fetchUnreadCount()
                }
              }} 
              disabled={loading}
              className="btn-secondary px-4 py-2 text-sm disabled:opacity-50"
            >
              {loading ? 'Atualizando...' : 'Atualizar'}
            </button>
          </div>
        </header>

        {error && (
          <div className="surface-strong mt-8 border border-rose-500/40 px-5 py-4 text-sm text-rose-200">
            {error}
          </div>
        )}

        {loading && notifications.length === 0 ? (
          <div className="mt-10 text-center text-neutral-500">Carregando notificações...</div>
        ) : notifications.length === 0 ? (
          <div className="mt-10 text-center text-neutral-600">
            <p className="text-lg">Nenhuma notificação ainda!</p>
            <p className="mt-2 text-sm">O bot começará a criar notificações quando você iniciar o trading.</p>
          </div>
        ) : (
          <div className="mt-10 space-y-6">
            {unreadNotifications.length > 0 && (
              <div>
                <h2 className="mb-4 text-lg font-semibold text-neutral-100">
                  Não lidas ({unreadNotifications.length})
                </h2>
                <div className="space-y-3">
                  {unreadNotifications.map((notification) => (
                    <NotificationCard
                      key={notification.id}
                      notification={notification}
                      onRead={() => markAsRead(notification.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {readNotifications.length > 0 && (
              <div>
                <h2 className="mb-4 text-lg font-semibold text-neutral-100">
                  Lidas ({readNotifications.length})
                </h2>
                <div className="space-y-3">
                  {readNotifications.map((notification) => (
                    <NotificationCard
                      key={notification.id}
                      notification={notification}
                      onRead={() => markAsRead(notification.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function NotificationCard({ notification, onRead }: { notification: Notification; onRead: () => void }) {
  const severity = notification.severity
  const style = severityStyles[severity]
  const icon = severityIcons[severity]

  return (
    <div
      className={`surface border p-5 transition-all ${
        !notification.is_read ? 'border-l-4 border-l-purple-400' : ''
      }`}
      onClick={() => !notification.is_read && onRead()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !notification.is_read) {
          e.preventDefault()
          onRead()
        }
      }}
    >
      <div className="flex items-start gap-4">
        <div className={`mt-1 text-2xl ${!notification.is_read ? 'animate-pulse' : ''}`}>{icon}</div>
        <div className="flex-1">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-neutral-100">{notification.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-300">{notification.message}</p>
              <p className="mt-3 text-xs text-neutral-500">
                {new Date(notification.created_at).toLocaleString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </p>
            </div>
            {!notification.is_read && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onRead()
                }}
                className="rounded-full bg-purple-500/20 px-3 py-1 text-xs text-purple-200 hover:bg-purple-500/30"
              >
                Marcar lida
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

