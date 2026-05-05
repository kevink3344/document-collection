import { createContext, useContext, useState, type ReactNode } from 'react'
import type { User } from '../types'

interface AuthContextValue {
  user: User | null
  token: string | null
  signIn: (user: User, token: string) => void
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem('dcp-user')
      return stored ? (JSON.parse(stored) as User) : null
    } catch {
      return null
    }
  })

  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem('dcp-token')
  )

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
