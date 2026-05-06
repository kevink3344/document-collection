import { createContext, useContext, useState, type ReactNode } from 'react'
import type { User } from '../types'

interface AuthContextValue {
  user: User | null
  token: string | null
  signIn: (user: User, token: string) => void
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

interface StoredSession {
  user: User | null
  token: string | null
}

function parseJwtExpiry(token: string): number | null {
  try {
    const [, payload] = token.split('.')
    if (!payload) return null

    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const decoded = JSON.parse(atob(padded)) as { exp?: unknown }

    return typeof decoded.exp === 'number' ? decoded.exp : null
  } catch {
    return null
  }
}

function loadStoredSession(): StoredSession {
  try {
    const rawUser = localStorage.getItem('dcp-user')
    const rawToken = localStorage.getItem('dcp-token')

    if (!rawUser || !rawToken) {
      localStorage.removeItem('dcp-user')
      localStorage.removeItem('dcp-token')
      return { user: null, token: null }
    }

    const expiresAt = parseJwtExpiry(rawToken)
    if (!expiresAt || expiresAt * 1000 <= Date.now()) {
      localStorage.removeItem('dcp-user')
      localStorage.removeItem('dcp-token')
      return { user: null, token: null }
    }

    return {
      user: JSON.parse(rawUser) as User,
      token: rawToken,
    }
  } catch {
    localStorage.removeItem('dcp-user')
    localStorage.removeItem('dcp-token')
    return { user: null, token: null }
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const initialSession = loadStoredSession()
  const [user, setUser] = useState<User | null>(initialSession.user)
  const [token, setToken] = useState<string | null>(initialSession.token)

  const signIn = (u: User, t: string) => {
    setUser(u)
    setToken(t)
    localStorage.setItem('dcp-user', JSON.stringify(u))
    localStorage.setItem('dcp-token', t)
  }

  const signOut = () => {
    setUser(null)
    setToken(null)
    localStorage.removeItem('dcp-user')
    localStorage.removeItem('dcp-token')
  }

  return (
    <AuthContext.Provider value={{ user, token, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
