'use client'

import { AuthProvider } from './contexts/AuthContext'
import { MetaMaskProvider } from './contexts/MetaMaskContext'
import { PhantomProvider } from './contexts/PhantomContext'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <MetaMaskProvider>
        <PhantomProvider>
          {children}
        </PhantomProvider>
      </MetaMaskProvider>
    </AuthProvider>
  )
}

