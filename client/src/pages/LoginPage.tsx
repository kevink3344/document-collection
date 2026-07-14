import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Layers } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getPublicSetting } from '../api/settings'
import { getPublicSummaryStats, type PublicSummaryStats } from '../api/stats'
import type { User, UserRole } from '../types'
import { sanitizeRichText } from '../utils/richText'

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'SUPER ADMIN',
  administrator: 'ADMINISTRATOR',
  team_manager: 'TEAM MANAGER',
  reviewer: 'REVIEWER',
  user: 'USER',
}

const DEFAULT_PUBLIC_STATS: PublicSummaryStats = {
  categoryCount: 0,
  organizationCount: 0,
  collectionCount: 0,
  submissionCount: 0,
}

const INPUT_CLASS =
  'w-full border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#1E293B] ' +
  'text-[#1E293B] dark:text-[#F1F5F9] placeholder-[#94A3B8] dark:placeholder-[#475569] ' +
  'px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-0 ' +
  'rounded-[2px]'

interface LoginOrg {
  id: number
  name: string
  description: string | null
}

function formatOrgLabel(org: LoginOrg): string {
  if (org.description?.trim()) {
    return `${org.description.trim()} (${org.name})`
  }
  return org.name
}

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { signIn } = useAuth()
  const redirectTo = typeof (location.state as { redirectTo?: unknown } | null)?.redirectTo === 'string'
    ? (location.state as { redirectTo: string }).redirectTo
    : '/'
  // Super admin backdoor: /login?admin=1 bypasses maintenance mode
  const adminOverride = searchParams.get('admin') === '1'

  const [organizations, setOrganizations] = useState<LoginOrg[]>([])
  const [loadingOrgs, setLoadingOrgs] = useState(true)
  const [serverStarting, setServerStarting] = useState(false)
  const [selectedOrgId, setSelectedOrgId] = useState<string>('')

  const [existingUsers, setExistingUsers] = useState<User[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [userLoadError, setUserLoadError] = useState<string | null>(null)

  const sortedUsers = useMemo(
    () => [...existingUsers].sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email)),
    [existingUsers]
  )

  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [rememberMe, setRememberMe] = useState(() => {
    try { return localStorage.getItem('dcp-remember-me') === 'true' } catch { return false }
  })
  const [signingIn, setSigningIn] = useState(false)
  const [loginMessage, setLoginMessage] = useState(
    'Choose an existing user profile or register a new account to enter the data workspace.'
  )
  const [loginSubtitle, setLoginSubtitle] = useState('Enterprise Staff Support')
  const [publicStats, setPublicStats] = useState<PublicSummaryStats>(DEFAULT_PUBLIC_STATS)
  const [loginMode, setLoginMode] = useState<'select' | 'password' | 'maintenance' | null>(null)
  const [maintenanceMessage, setMaintenanceMessage] = useState('System is currently undergoing maintenance. Please check back later.')
  const [appInfo, setAppInfo] = useState<{ version: string; dbMode: string; loginScreenColor?: string | null } | null>(null)

  // Fetch global stats once on mount (not scoped to selected org)
  useEffect(() => {
    getPublicSummaryStats()
      .then(setPublicStats)
      .catch(() => { /* keep default counts */ })
    fetch('/api/info')
      .then(r => r.json() as Promise<{ version: string; dbMode: string }>)
      .then(setAppInfo)
      .catch(() => { /* keep null */ })
  }, [])

  const loadUsers = async (orgId: string) => {
    setLoadingUsers(true)
    setUserLoadError(null)
    setExistingUsers([])
    setSelectedUserId('')

    try {
      const res = await fetch(`/api/auth/users?organizationId=${orgId}`)
      const data = await res.json() as User[] | { error?: string }
      if (!res.ok || !Array.isArray(data)) {
        throw new Error('Unable to load users')
      }

      setExistingUsers(data)
      const savedUserId = localStorage.getItem('dcp-saved-user-id')
      const defaultUserId = (rememberMe && savedUserId && data.some(u => String(u.id) === savedUserId))
        ? savedUserId
        : data.length > 0 ? String(data[0].id) : ''
      setSelectedUserId(defaultUserId)
    } catch (err) {
      console.error('[LoginPage] Failed to load users:', err)
      setExistingUsers([])
      setSelectedUserId('')
      setUserLoadError('Unable to load user profiles. Please refresh once the backend is available.')
    } finally {
      setLoadingUsers(false)
    }
  }

  useEffect(() => {
    getPublicSetting('login_message')
      .then(setLoginMessage)
      .catch(() => { /* keep default */ })
    getPublicSetting('login_subtitle')
      .then(setLoginSubtitle)
      .catch(() => { /* keep default */ })
    getPublicSetting('login_mode')
      .then(val => setLoginMode(val === 'password' ? 'password' : val === 'maintenance' ? 'maintenance' : 'select'))
      .catch(() => setLoginMode('select'))
    getPublicSetting('maintenance_message')
      .then(val => { if (val) setMaintenanceMessage(val) })
      .catch(() => {})

    // Load organizations for the picker — retry every 5 s while the server
    // is warming up (Azure spins down idle App Service instances).
    setLoadingOrgs(true)
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const fetchOrgs = () => {
      fetch('/api/auth/organizations')
        .then(r => r.json() as Promise<LoginOrg[]>)
        .then(orgs => {
          if (!Array.isArray(orgs)) return
          if (orgs.length === 0) {
            // Server may still be warming up — show banner and retry
            setServerStarting(true)
            retryTimer = setTimeout(fetchOrgs, 5000)
            return
          }
          setServerStarting(false)
          setOrganizations(orgs)
          setLoadingOrgs(false)
          const savedOrgId = localStorage.getItem('dcp-saved-org-id')
          const firstOrgId = (rememberMe && savedOrgId && orgs.some(o => String(o.id) === savedOrgId))
            ? savedOrgId
            : String(orgs[0].id)
          setSelectedOrgId(firstOrgId)
          void loadUsers(firstOrgId)
        })
        .catch(() => {
          // Network error — server not up yet
          setServerStarting(true)
          retryTimer = setTimeout(fetchOrgs, 5000)
        })
    }

    fetchOrgs()

    return () => {
      if (retryTimer !== null) clearTimeout(retryTimer)
    }
  }, [])

  const [error, setError] = useState<string | null>(null)

  // Email + password login (for invited users)
  const [pwEmail, setPwEmail] = useState('')
  const [pwPassword, setPwPassword] = useState('')
  const [pwSigningIn, setPwSigningIn] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)

  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwSigningIn(true)
    setPwError(null)
    try {
      const res = await fetch('/api/auth/login-with-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pwEmail, password: pwPassword }),
      })
      const data = await res.json() as { token: string; user: User; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Login failed')
      signIn(data.user, data.token)
      navigate(redirectTo)
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setPwSigningIn(false)
    }
  }

  const handleSelectSignIn = async () => {
    setSigningIn(true)
    setError(null)
    try {
      if (!selectedUserId) {
        throw new Error('No user available to sign in')
      }

      if (rememberMe) {
        localStorage.setItem('dcp-remember-me', 'true')
        localStorage.setItem('dcp-saved-org-id', selectedOrgId)
        localStorage.setItem('dcp-saved-user-id', selectedUserId)
      } else {
        localStorage.removeItem('dcp-remember-me')
        localStorage.removeItem('dcp-saved-org-id')
        localStorage.removeItem('dcp-saved-user-id')
      }

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: Number(selectedUserId) }),
      })
      const data = await res.json() as { token: string; user: User; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Login failed')
      signIn(data.user, data.token)
      navigate(redirectTo)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setSigningIn(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row overflow-x-hidden">
      {/* ── Left panel ─────────────────────────────────────── */}
      <div
        className="flex flex-col justify-between bg-[#0F2942] text-white p-8 md:p-12 md:w-[44%] md:min-h-screen"
        style={appInfo?.loginScreenColor ? { backgroundColor: appInfo.loginScreenColor } : undefined}
      >
        {/* Brand header */}
        <div>
          <div className="flex items-center gap-3 mb-10">
            <Layers size={22} strokeWidth={2} className="text-white shrink-0" />
            <span className="text-[10px] font-semibold tracking-[0.25em] text-white/50 uppercase">
              Data Collection Pro
            </span>
          </div>

          <span className="inline-flex items-center px-2.5 py-0.5 border border-white/40 text-[10px] font-semibold tracking-[0.2em] text-white/80 uppercase rounded-[2px] mb-4">
            {appInfo ? `${appInfo.version} - ${appInfo.dbMode}` : loginSubtitle}
          </span>
          <h1 className="text-3xl md:text-[2.5rem] font-bold leading-tight mb-5">
            Sign in to Data Collection Pro
          </h1>
          <div
            className="text-white/70 text-sm leading-relaxed [&_p]:mb-3 [&_strong]:font-semibold [&_em]:italic [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
            dangerouslySetInnerHTML={{ __html: sanitizeRichText(loginMessage) }}
          />
        </div>

        {/* Stats */}
        <div className="flex gap-3 mt-10 md:mt-0">
          {[
            { value: publicStats.organizationCount, label: 'ORGANIZATIONS' },
            { value: publicStats.collectionCount, label: 'COLLECTIONS' },
            { value: publicStats.submissionCount, label: 'SUBMISSIONS' },
          ].map(stat => (
            <div
              key={stat.label}
              className="flex-1 border border-white/40 p-3"
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

          {/* Server starting banner */}
          {serverStarting && (
            <div className="mb-6 flex items-center gap-3 px-4 py-3 border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 text-sm rounded-[2px]">
              <svg className="shrink-0 animate-spin" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
              <span>Server is starting up. Please wait…</span>
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="mb-6 px-3 py-2.5 border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 text-sm">
              {error}
            </div>
          )}

          {/* ── System Maintenance ────────────────────── */}
          {loginMode === 'maintenance' && !adminOverride && (
            <div className="flex flex-col items-center text-center gap-5 py-8">
              <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </div>
              <div>
                <h2 className="text-xl font-bold text-[#1E293B] dark:text-[#F1F5F9] mb-2">System Maintenance</h2>
                <p className="text-sm text-[#64748B] dark:text-[#94A3B8] leading-relaxed max-w-sm">{maintenanceMessage}</p>
              </div>
            </div>
          )}

          {/* ── Select existing user ──────────────────── */}
          {(loginMode === 'select' || loginMode === null) && (
            <>
          <p className="text-[10px] font-semibold tracking-[0.2em] text-[#64748B] dark:text-[#475569] uppercase mb-3">
            Authentication
          </p>
          <h2 className="text-2xl font-bold text-[#1E293B] dark:text-[#F1F5F9] mb-1">
            Select Existing User
          </h2>
          <p className="text-sm text-[#64748B] dark:text-[#94A3B8] mb-5">
            {loadingOrgs ? 'Loading organizations…' : 'Select your organization, then pick a profile.'}
          </p>

          {/* Organization dropdown */}
          <label className="block text-[10px] font-semibold tracking-[0.18em] text-[#64748B] dark:text-[#475569] uppercase mb-1.5">
            Organization
          </label>
          <select
            value={selectedOrgId}
            onChange={e => {
              const orgId = e.target.value
              setSelectedOrgId(orgId)
              if (orgId) void loadUsers(orgId)
            }}
            disabled={loadingOrgs || organizations.length === 0}
            className={INPUT_CLASS + ' mb-4 appearance-none cursor-pointer'}
            style={{ backgroundImage: 'none' }}
          >
            {loadingOrgs && <option value="">Loading organizations…</option>}
            {!loadingOrgs && organizations.length === 0 && <option value="">No organizations available</option>}
            {organizations.map(org => (
              <option key={org.id} value={String(org.id)}>{formatOrgLabel(org)}</option>
            ))}
          </select>

          {/* User dropdown */}
          <label className="block text-[10px] font-semibold tracking-[0.18em] text-[#64748B] dark:text-[#475569] uppercase mb-1.5">
            User
          </label>
          <select
            value={selectedUserId}
            onChange={e => setSelectedUserId(e.target.value)}
            disabled={loadingUsers || !selectedOrgId || sortedUsers.length === 0}
            className={INPUT_CLASS + ' mb-3 appearance-none cursor-pointer'}
            style={{ backgroundImage: 'none' }}
          >
            {!selectedOrgId && <option value="">Select an organization first</option>}
            {selectedOrgId && loadingUsers && <option value="">Loading users…</option>}
            {selectedOrgId && !loadingUsers && sortedUsers.length === 0 && <option value="">No users available</option>}
            {sortedUsers.map(u => (
              <option key={u.id} value={String(u.id)}>
                {u.name} · {ROLE_LABELS[u.role]}
              </option>
            ))}
          </select>

          {userLoadError && (
            <div className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {userLoadError}
              <button
                type="button"
                onClick={() => selectedOrgId && void loadUsers(selectedOrgId)}
                disabled={loadingUsers}
                className="ml-2 underline"
              >
                Retry
              </button>
            </div>
          )}

          <button
            onClick={handleSelectSignIn}
            disabled={loadingUsers || signingIn || !selectedUserId}
            className="w-full bg-[#1E293B] dark:bg-[#F1F5F9] text-white dark:text-[#0F172A] font-semibold py-2.5 text-sm tracking-wide rounded-[2px] hover:bg-[#0F172A] dark:hover:bg-white transition-colors disabled:opacity-50 mb-3"
          >
            {signingIn ? 'Signing in…' : 'Sign In as Selected User'}
          </button>

          <label className="flex items-center gap-2 mb-8 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={e => setRememberMe(e.target.checked)}
              className="w-4 h-4 rounded accent-[#2563EB]"
            />
            <span className="text-xs text-[#64748B] dark:text-[#94A3B8]">Remember my selection next time</span>
          </label>
            </>
          )}

          {/* ── Email + Password login ────────────────── */}
          {(loginMode === 'password' || loginMode === null || (loginMode === 'maintenance' && adminOverride)) && (
          <form onSubmit={e => void handlePasswordSignIn(e)} className="space-y-3 mb-8">
            <p className="text-[10px] font-semibold tracking-[0.2em] text-[#64748B] dark:text-[#475569] uppercase mb-4">
              Sign In with Password
            </p>
            {pwError && (
              <div className="px-3 py-2.5 border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 text-sm">
                {pwError}
              </div>
            )}
            <input
              type="email"
              placeholder="Email address"
              value={pwEmail}
              onChange={e => setPwEmail(e.target.value)}
              autoComplete="email"
              required
              className={INPUT_CLASS}
            />
            <input
              type="password"
              placeholder="Password"
              value={pwPassword}
              onChange={e => setPwPassword(e.target.value)}
              autoComplete="current-password"
              required
              className={INPUT_CLASS}
            />
            <button
              type="submit"
              disabled={pwSigningIn || !pwEmail || !pwPassword}
              className="w-full bg-[#2563EB] text-white font-semibold py-2.5 text-sm tracking-wide rounded-[2px] hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {pwSigningIn ? 'Signing in…' : 'Sign In'}
            </button>
            <p className="text-center text-sm text-[#64748B] dark:text-[#94A3B8]">
              <span className="text-[#94A3B8] dark:text-[#475569] text-sm">Forgot your password? Contact your organization administrator.</span>
            </p>
          </form>
          )}


        </div>
      </div>
    </div>
  )
}
