import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Folder } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getPublicSetting } from '../api/settings'
import { getPublicSummaryStats, type PublicSummaryStats } from '../api/stats'
import type { User, UserRole } from '../types'

// Pre-seeded users matching server seed data
const EXISTING_USERS: User[] = [
  {
    id: 1,
    name: 'Jon Rivera',
    email: 'jon@datacollectionpro.com',
    role: 'administrator',
    createdAt: '',
  },
  {
    id: 2,
    name: 'Sarah Chen',
    email: 'sarah@datacollectionpro.com',
    role: 'team_manager',
    createdAt: '',
  },
  {
    id: 3,
    name: 'Mike Torres',
    email: 'mike@datacollectionpro.com',
    role: 'user',
    createdAt: '',
  },
]

const ROLE_LABELS: Record<UserRole, string> = {
  administrator: 'ADMINISTRATOR',
  team_manager: 'TEAM MANAGER',
  user: 'USER',
}

const DEFAULT_PUBLIC_STATS: PublicSummaryStats = {
  categoryCount: 0,
  collectionCount: 0,
  submissionCount: 0,
}

const INPUT_CLASS =
  'w-full border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#1E293B] ' +
  'text-[#1E293B] dark:text-[#F1F5F9] placeholder-[#94A3B8] dark:placeholder-[#475569] ' +
  'px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-0 ' +
  'rounded-[2px]'

export default function LoginPage() {
  const navigate = useNavigate()
  const { signIn } = useAuth()

  const [selectedUserId, setSelectedUserId] = useState<string>(
    String(EXISTING_USERS[0].id)
  )
  const [signingIn, setSigningIn] = useState(false)
  const [loginMessage, setLoginMessage] = useState(
    'Choose an existing user profile or register a new account to enter the data workspace.'
  )
  const [loginSubtitle, setLoginSubtitle] = useState('Enterprise Staff Support')
  const [publicStats, setPublicStats] = useState<PublicSummaryStats>(DEFAULT_PUBLIC_STATS)

  useEffect(() => {
    getPublicSetting('login_message')
      .then(setLoginMessage)
      .catch(() => { /* keep default */ })
    getPublicSetting('login_subtitle')
      .then(setLoginSubtitle)
      .catch(() => { /* keep default */ })
    getPublicSummaryStats()
      .then(setPublicStats)
      .catch(() => { /* keep default counts */ })
  }, [])

  const [regName, setRegName] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSelectSignIn = async () => {
    setSigningIn(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: Number(selectedUserId) }),
      })
      const data = await res.json() as { token: string; user: User; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Login failed')
      signIn(data.user, data.token)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setSigningIn(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* ── Left panel ─────────────────────────────────────── */}
      <div className="flex flex-col justify-between bg-[#0F2942] text-white p-8 md:p-12 md:w-[44%] md:min-h-screen">
        {/* Brand header */}
        <div>
          <div className="flex items-center gap-3 mb-10">
            <Folder size={22} strokeWidth={2} className="text-white shrink-0" />
            <span className="text-[10px] font-semibold tracking-[0.25em] text-white/50 uppercase">
              Data Collection Pro
            </span>
          </div>

          <span className="inline-flex items-center px-2.5 py-0.5 border border-white/40 text-[10px] font-semibold tracking-[0.2em] text-white/80 uppercase rounded-[2px] mb-4">
            {loginSubtitle}
          </span>
          <h1 className="text-3xl md:text-[2.5rem] font-bold leading-tight mb-5">
            Sign in to Data Collection Pro
          </h1>
          <p className="text-white/70 text-sm leading-relaxed">
            {loginMessage}
          </p>
        </div>

        {/* Stats */}
        <div className="flex gap-3 mt-10 md:mt-0">
          {[
            { value: publicStats.categoryCount, label: 'CATEGORIES' },
            { value: publicStats.collectionCount, label: 'COLLECTIONS' },
            { value: publicStats.submissionCount, label: 'SUBMISSIONS' },
          ].map(stat => (
            <div
              key={stat.label}
              className="flex-1 border border-[#1E3A5F] p-3"
            >
              <div className="font-mono text-xl font-medium text-white">{stat.value}</div>
              <div className="text-[9px] tracking-[0.2em] text-white/50 uppercase mt-1">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right panel ────────────────────────────────────── */}
      <div className="flex-1 flex flex-col justify-center bg-white dark:bg-[#0F172A] p-8 md:p-12 lg:p-16">
        <div className="w-full max-w-md mx-auto">

          {/* Error banner */}
          {error && (
            <div className="mb-6 px-3 py-2.5 border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 text-sm">
              {error}
            </div>
          )}

          {/* ── Select existing user ──────────────────── */}
          <p className="text-[10px] font-semibold tracking-[0.2em] text-[#64748B] dark:text-[#475569] uppercase mb-3">
            Authentication
          </p>
          <h2 className="text-2xl font-bold text-[#1E293B] dark:text-[#F1F5F9] mb-1">
            Select Existing User
          </h2>
          <p className="text-sm text-[#64748B] dark:text-[#94A3B8] mb-5">
            Pick a profile to continue, or create a new user account below.
          </p>

          <select
            value={selectedUserId}
            onChange={e => setSelectedUserId(e.target.value)}
            className={INPUT_CLASS + ' mb-3 appearance-none cursor-pointer'}
            style={{ backgroundImage: 'none' }}
          >
            {EXISTING_USERS.map(u => (
              <option key={u.id} value={String(u.id)}>
                {u.name} ({ROLE_LABELS[u.role]})
              </option>
            ))}
          </select>

          <button
            onClick={handleSelectSignIn}
            disabled={signingIn}
            className="w-full bg-[#1E293B] dark:bg-[#F1F5F9] text-white dark:text-[#0F172A] font-semibold py-2.5 text-sm tracking-wide rounded-[2px] hover:bg-[#0F172A] dark:hover:bg-white transition-colors disabled:opacity-50 mb-8"
          >
            {signingIn ? 'Signing in…' : 'Sign In as Selected User'}
          </button>

          {/* Divider */}
          <div className="border-t border-[#E2E8F0] dark:border-[#1E293B] mb-8" />

          {/* ── Register new account ──────────────────── */}
          <p className="text-[10px] font-semibold tracking-[0.2em] text-[#64748B] dark:text-[#475569] uppercase mb-4">
            Register New Account
          </p>

          <div className="space-y-3">
            <input
              type="text"
              placeholder="Full name"
              value={regName}
              onChange={e => setRegName(e.target.value)}
              className={INPUT_CLASS}
            />
            <input
              type="email"
              placeholder="Work email"
              value={regEmail}
              onChange={e => setRegEmail(e.target.value)}
              className={INPUT_CLASS}
            />
            <button
              type="button"
              disabled
              className="w-full bg-[#2563EB] text-white font-semibold py-2.5 text-sm tracking-wide rounded-[2px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Register & Sign In
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
