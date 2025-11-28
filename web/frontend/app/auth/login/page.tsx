'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '../../contexts/AuthContext'

export default function LoginPage() {
  const router = useRouter()
  const { login } = useAuth()
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error?.message || 'Erro ao fazer login')
      }

      if (data.success && data.data.access_token) {
        login(data.data.access_token, data.data.refresh_token, data.data.user)
        router.push('/dashboard')
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao fazer login')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="mb-10 text-center">
            <Link href="/" className="inline-flex items-center justify-center gap-3">
              <span className="text-sm font-semibold uppercase tracking-[0.3em] text-purple-300">TradingBot AI</span>
            </Link>
            <h1 className="mt-4 text-3xl font-semibold text-neutral-50">Acesse sua conta</h1>
            <p className="mt-2 text-sm text-neutral-500">Utilize suas credenciais para entrar no painel.</p>
          </div>

          <div className="surface-strong p-10">
            <h2 className="text-lg font-semibold text-neutral-100">Login</h2>
            <p className="mt-1 text-sm text-neutral-500">Informe seu e-mail corporativo e sua senha.</p>

            {error && (
              <div className="mt-6 rounded-lg border border-rose-500/50 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              <div>
                <label htmlFor="email" className="text-sm font-medium text-neutral-300">
                  Email
                </label>
                <input
                  type="email"
                  id="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="input-field mt-2"
                  placeholder="usuario@empresa.com"
                />
              </div>

              <div>
                <label htmlFor="password" className="text-sm font-medium text-neutral-300">
                  Senha
                </label>
                <input
                  type="password"
                  id="password"
                  required
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="input-field mt-2"
                  placeholder="••••••••"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-3 text-sm font-semibold disabled:opacity-60"
              >
                {loading ? 'Entrando...' : 'Entrar'}
              </button>
            </form>

            <div className="mt-8 flex items-center justify-between text-sm text-neutral-500">
              <span>Novo por aqui?</span>
              <Link href="/auth/register" className="text-purple-300 hover:text-purple-200">
                Criar conta
              </Link>
            </div>

            <div className="mt-10 border-t border-neutral-800 pt-6 text-sm text-neutral-500">
              <Link href="/" className="inline-flex items-center gap-2 text-neutral-400 hover:text-neutral-200">
                <span aria-hidden="true">←</span>
                Voltar para a página inicial
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

