import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import type { User } from '../types'

const INPUT =
  'w-full border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#1E293B] ' +
  'text-[#1E293B] dark:text-[#F1F5F9] placeholder-[#94A3B8] px-3 py-2.5 text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded-[2px]'

export default function ChangePasswordPage() {
  const { updateUser } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    if (next.length < 8) {
      setError('New password must be at least 8 characters.')
      return
    }
    if (next !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      })
      const data = await res.json() as { message?: string; error?: string; user?: User }
      if (!res.ok) {
        setError(data.error ?? 'Failed to change password.')
        return
      }
      if (data.user) updateUser(data.user)
      setSuccess(true)
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6 max-w-md">
      <div className="rounded-lg border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#1E293B] p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/40 shrink-0">
            <KeyRound size={18} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Change Password</h1>
            <p className="text-sm text-[#64748B] dark:text-[#94A3B8]">Update the password for your account.</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2.5 border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 text-sm rounded-[2px]">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 px-3 py-2.5 border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/50 text-green-700 dark:text-green-300 text-sm rounded-[2px]">
            Password changed successfully.
          </div>
        )}

        <form onSubmit={e => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="block text-[10px] font-semibold tracking-[0.18em] text-[#64748B] dark:text-[#475569] uppercase mb-1.5">
              Current Password
            </label>
            <input
              type="password"
              value={current}
              onChange={e => setCurrent(e.target.value)}
              placeholder="Enter current password"
              className={INPUT}
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold tracking-[0.18em] text-[#64748B] dark:text-[#475569] uppercase mb-1.5">
              New Password
            </label>
            <input
              type="password"
              value={next}
              onChange={e => setNext(e.target.value)}
              placeholder="At least 8 characters"
              className={INPUT}
              required
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold tracking-[0.18em] text-[#64748B] dark:text-[#475569] uppercase mb-1.5">
              Confirm New Password
            </label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Repeat new password"
              className={INPUT}
              required
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full mt-2 bg-[#1E293B] dark:bg-[#F1F5F9] text-white dark:text-[#0F172A] font-semibold py-2.5 text-sm tracking-wide rounded-[2px] hover:bg-[#0F172A] dark:hover:bg-white transition-colors disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Set New Password'}
          </button>
        </form>
      </div>
    </div>
  )
}
