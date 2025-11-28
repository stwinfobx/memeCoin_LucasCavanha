'use client'

import Link from 'next/link'

export default function Home() {
  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-12">
        <header className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold uppercase tracking-[0.3em] text-purple-300">TradingBot AI</span>
            <span className="h-4 w-px bg-neutral-800" aria-hidden="true" />
            <span className="text-sm text-neutral-400">Memecoin Intelligence &amp; Risk Engine</span>
          </div>
          <div className="flex gap-3">
            <Link href="/auth/login" className="btn-secondary px-5 py-2 text-sm font-medium">
              Login
            </Link>
            <Link href="/auth/register" className="btn-primary px-5 py-2 text-sm font-semibold">
              Criar conta
            </Link>
          </div>
        </header>

        <main className="mt-24 grid flex-1 gap-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <section className="flex flex-col justify-center gap-10">
            <div>
              <span className="section-title">Inteligência aplicada a memecoins</span>
              <h1 className="mt-4 text-4xl font-semibold text-neutral-50 sm:text-5xl md:text-6xl">
                Valide, mensure riscos e monitore memecoins com precisão institucional.
              </h1>
              <p className="mt-6 max-w-xl text-base text-neutral-400">
                O TradingBot AI combina ingestão em tempo real, heurísticas anti-golpe e probabilidades de risco
                para identificar oportunidades confiáveis em mercados altamente voláteis. Um backend projetado para
                operar 24/7 com transparência e segurança.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <Link href="/auth/register" className="btn-primary px-6 py-3 text-base font-semibold">
                Começar agora
              </Link>
              <Link href="/auth/login" className="btn-secondary px-6 py-3 text-base font-semibold">
                Acessar painel
              </Link>
            </div>

            <dl className="grid gap-6 sm:grid-cols-3">
              {[
                {
                  title: 'Ingestão contínua',
                  description: 'GeckoTerminal + explorers para detectar memecoins recém-lançadas com filtros específicos.',
                },
                {
                  title: 'Risco quantificado',
                  description: 'Probabilidade de scam, liquidez, concentração de holders e score de segurança em tempo real.',
                },
                {
                  title: 'Pipeline pronto',
                  description: 'Integração direta com Signal e Executor Services para automatizar decisões futuras.',
                },
              ].map((item) => (
                <div key={item.title} className="surface p-6">
                  <h3 className="text-sm font-semibold text-neutral-200">{item.title}</h3>
                  <p className="mt-3 text-sm text-neutral-400 leading-relaxed">{item.description}</p>
                </div>
              ))}
            </dl>
          </section>

          <section className="surface-strong flex flex-col justify-between p-10">
            <div className="space-y-8">
              <div>
                <span className="section-title">Pipeline de validação</span>
                <h2 className="mt-3 text-2xl font-semibold text-neutral-50">Arquitetura escalável para análise de memecoins</h2>
                <p className="mt-4 text-sm text-neutral-400">
                  Cada token passa por ingestão, análise on-chain, avaliação de liquidez e cálculo probabilístico
                  antes de ser classificado como oportunidade ou risco.
                </p>
              </div>

              <ol className="space-y-4 text-sm text-neutral-300">
                {[
                  'Ingestão GeckoTerminal com filtro de memecoins e fresh listings.',
                  'Verificação on-chain via BscScan/Etherscan: honeypot, criação e concentração.',
                  'Cálculo de memecoin score, risk score e scam probability (0-100).',
                  'Exposição via API Gateway para dashboards e automações.',
                ].map((step, index) => (
                  <li key={step} className="flex gap-3">
                    <span className="mt-[2px] inline-flex h-6 w-6 items-center justify-center rounded-full border border-neutral-700 text-xs font-semibold text-neutral-300">
                      {index + 1}
                    </span>
                    <span className="leading-relaxed text-neutral-400">{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              <div className="surface p-5">
                <p className="text-sm font-semibold text-neutral-200">Risk Engine 24/7</p>
                <p className="mt-2 text-2xl font-semibold text-purple-300">Atualização contínua</p>
                <p className="mt-3 text-xs text-neutral-500">Scores recalculados a cada ciclo de ingestão com histórico auditável.</p>
              </div>
              <div className="surface p-5">
                <p className="text-sm font-semibold text-neutral-200">Integração pronta</p>
                <p className="mt-2 text-2xl font-semibold text-purple-300">API unificada</p>
                <p className="mt-3 text-xs text-neutral-500">Consuma sinais e riscos no API Gateway para qualquer aplicação.</p>
              </div>
            </div>
          </section>
        </main>

        <footer className="mt-24 flex flex-col gap-4 border-t border-neutral-900 py-8 text-sm text-neutral-500 md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} TradingBot AI. Todos os direitos reservados.</p>
          <div className="flex gap-6">
            <span>Backend focado em segurança e rastreabilidade.</span>
            <span>Frontend otimizado para monitoramento em tempo real.</span>
          </div>
        </footer>
      </div>
    </div>
  )
}
