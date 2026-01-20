'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

export default function VerifyEmailPage() {
    const params = useParams()
    const router = useRouter()
    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
    const [message, setMessage] = useState('Verificando seu e-mail...')

    useEffect(() => {
        const verifyEmail = async () => {
            try {
                const token = params.token
                if (!token) {
                    setStatus('error')
                    setMessage('Token de verificação ausente.')
                    return
                }

                const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/auth/verify-email/${token}`)
                const data = await response.json()

                if (response.ok && data.success) {
                    setStatus('success')
                    setMessage('E-mail verificado com sucesso! Você já pode acessar sua conta.')
                } else {
                    setStatus('error')
                    setMessage(data.error?.message || 'Falha ao verificar e-mail. O link pode ter expirado.')
                }
            } catch (err) {
                setStatus('error')
                setMessage('Erro de conexão com o servidor. Tente novamente mais tarde.')
            }
        }

        verifyEmail()
    }, [params.token])

    return (
        <div className="min-h-screen bg-neutral-950">
            <div className="mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-6 py-12">
                <div className="w-full max-w-md">
                    <div className="mb-10 text-center">
                        <Link href="/" className="inline-flex items-center justify-center gap-3">
                            <span className="text-sm font-semibold uppercase tracking-[0.3em] text-purple-300">TradingBot AI</span>
                        </Link>
                    </div>

                    <div className="surface-strong p-10 text-center">
                        <h2 className="text-xl font-semibold text-neutral-100">
                            {status === 'loading' && 'Verificando...'}
                            {status === 'success' && '✅ Sucesso!'}
                            {status === 'error' && '❌ Ops!'}
                        </h2>

                        <p className="mt-4 text-neutral-400">
                            {message}
                        </p>

                        {status !== 'loading' && (
                            <div className="mt-10">
                                <Link
                                    href="/auth/login"
                                    className="btn-primary inline-block w-full py-3 text-sm font-semibold"
                                >
                                    Ir para Login
                                </Link>
                            </div>
                        )}

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
