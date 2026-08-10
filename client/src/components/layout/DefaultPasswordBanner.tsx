import { useState } from 'react'
import { KeyRound, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

export default function DefaultPasswordBanner() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const storageKey = `dcp-dp-banner-dismissed-${user?.id ?? 'anon'}`
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(storageKey) === '1')

  if (!user?.mustChangePassword || dismissed) return null

  function dismiss() {
    sessionStorage.setItem(storageKey, '1')
    setDismissed(true)
  }

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300 text-xs">
      <div className="flex items-center gap-2">
        <KeyRound size={14} className="shrink-0" />
        <span>You&apos;re using a temporary password. We recommend changing it.</span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={() => navigate('/change-password')}
          className="font-semibold underline hover:no-underline"
        >
          Change Password
        </button>
        <button type="button" onClick={dismiss} aria-label="Dismiss" className="hover:text-amber-950 dark:hover:text-amber-100">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
