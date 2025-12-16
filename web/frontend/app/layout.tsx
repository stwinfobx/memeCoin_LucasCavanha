import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './providers'

export const metadata: Metadata = {
  title: 'TradingBot AI - Memecoins Trading',
  description: 'Sistema automatizado de trading de memecoins com IA',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR" className="dark">
      <body className="min-h-screen bg-neutral-950 text-neutral-100">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}


