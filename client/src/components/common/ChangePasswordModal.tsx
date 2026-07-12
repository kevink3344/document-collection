import { useState } from 'react'
import { KeyRound } from 'lucide-react'

const INPUT =
  'w-full border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#1E293B] ' +
  'text-[#1E293B] dark:text-[#F1F5F9] placeholder-[#94A3B8] px-3 py-2.5 text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded-[2px]'

interface Props {
  onSuccess: (user: import('../../types').User) => void
}

export default function ChangePasswordModal({ onSuccess }: Props) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

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
      const data = await res.json() as { message?: string; error?: string; user?: import('../../types').User }
      if (!res.ok) {
        setError(data.error ?? 'Failed to change password.')
        return
      }
      if (data.user) onSuccess(data.user)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white dark:bg-[#1E293B] rounded-[3px] shadow-2xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center shrink-0">
            <KeyRound size={18} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#1E293B] dark:text-[#F1F5F9]">
              Change Your Password
            </h2>
            <p className="text-sm text-[#64748B] dark:text-[#94A3B8]">
              You must set a new password before continuing.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2.5 border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 text-sm rounded-[2px]">
            {error}
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
