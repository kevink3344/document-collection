import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CalendarCheck, X } from 'lucide-react'
import { getPublicSignupSheet, listPublicSlots, registerForSlot } from '../api/signupSlots'
import type { SignupSheetSummary, SignupSlot } from '../types'

function formatDate(isoDate: string): { primary: string; secondary: string } {
  if (!isoDate) return { primary: '', secondary: '' }
  const d = new Date(`${isoDate}T00:00:00`)
  const primary = d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
  const secondary = d.toLocaleDateString('en-US', { weekday: 'long' })
  return { primary, secondary }
}

function formatTime(t: string): string {
  if (!t) return ''
  const [hStr, mStr] = t.split(':')
  const h = parseInt(hStr, 10)
  const m = mStr ?? '00'
  const ampm = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m}${ampm}`
}

interface RegisterModalProps {
  slot: SignupSlot
  slug: string
  onClose: () => void
  onSuccess: (slot: SignupSlot) => void
}

function RegisterModal({ slot, slug, onClose, onSuccess }: RegisterModalProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await registerForSlot(slug, slot.id, {
        respondentName: name.trim(),
        respondentEmail: email.trim(),
        note: note.trim() || undefined,
      })
      onSuccess({ ...slot, filledCount: slot.filledCount + 1 })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const { primary: dateStr, secondary: dayStr } = formatDate(slot.slotDate)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label="Close"
      />
      <div className="relative w-full max-w-md rounded-xl border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#1E293B] shadow-xl p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="text-base font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Sign Up</h2>
            <p className="text-sm text-[#64748B] mt-0.5">
              {dateStr} &nbsp;·&nbsp; {formatTime(slot.startTime)}–{formatTime(slot.endTime)}
            </p>
            <p className="text-sm font-medium text-[#1E293B] dark:text-[#F1F5F9] mt-0.5">{slot.label}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[#94A3B8] hover:text-[#1E293B] dark:hover:text-[#F1F5F9]"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              className="w-full rounded border border-[#CBD5E1] dark:border-[#334155] bg-white dark:bg-[#0F172A] px-3 py-2 text-sm text-[#1E293B] dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded border border-[#CBD5E1] dark:border-[#334155] bg-white dark:bg-[#0F172A] px-3 py-2 text-sm text-[#1E293B] dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1">Note (optional)</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              className="w-full rounded border border-[#CBD5E1] dark:border-[#334155] bg-white dark:bg-[#0F172A] px-3 py-2 text-sm text-[#1E293B] dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#2563EB] resize-none"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-[#CBD5E1] dark:border-[#334155] px-4 py-2 text-xs text-[#64748B] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded bg-[#1E3A8A] text-white px-4 py-2 text-xs font-semibold hover:bg-[#1e40af] disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Signing up…' : 'Confirm Sign Up'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function SignupSheetFillPage() {
  const { slug: slugParam } = useParams<{ slug: string }>()
  const slug = slugParam ?? ''

  const [sheet, setSheet] = useState<SignupSheetSummary | null>(null)
  const [slots, setSlots] = useState<SignupSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeSlot, setActiveSlot] = useState<SignupSlot | null>(null)
  const [successSlotId, setSuccessSlotId] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [sheetData, slotsData] = await Promise.all([
          getPublicSignupSheet(slug),
          listPublicSlots(slug),
        ])
        if (!active) return
        setSheet(sheetData)
        setSlots(slotsData)
      } catch (err) {
        if (!active) return
        setError((err as Error).message)
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [slug])

  function handleSignupSuccess(updatedSlot: SignupSlot) {
    setSlots(prev => prev.map(s => (s.id === updatedSlot.id ? updatedSlot : s)))
    setSuccessSlotId(updatedSlot.id)
    setActiveSlot(null)
    setTimeout(() => setSuccessSlotId(null), 4000)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-[#64748B] text-sm">
        Loading…
      </div>
    )
  }

  if (error || !sheet) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-sm w-full rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-6 text-center">
          <p className="text-sm text-red-700 dark:text-red-400">{error ?? 'Sign-up sheet not found.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0F172A]">
      {/* Header */}
      <div className="bg-[#1E3A8A] dark:bg-[#1e293b] py-10 px-4">
        <div className="max-w-4xl mx-auto space-y-2">
          <div className="flex items-center gap-2 text-blue-200 text-sm">
            <CalendarCheck size={16} />
            <span>Sign-Up Sheet</span>
          </div>
          <h1 className="text-2xl font-bold text-white">{sheet.title}</h1>
          {sheet.description && (
            <p className="text-blue-100 text-sm max-w-2xl">{sheet.description}</p>
          )}
          {sheet.instructions && (
            <p className="text-blue-200 text-xs max-w-2xl">{sheet.instructions}</p>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        {slots.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#CBD5E1] dark:border-[#334155] p-12 text-center">
            <CalendarCheck size={34} className="mx-auto mb-3 text-[#CBD5E1]" />
            <p className="text-sm text-[#64748B]">No slots have been added yet.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-[#CBD5E1] dark:border-[#334155] bg-white dark:bg-[#1E293B] overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[160px_160px_1fr_140px] bg-[#1E3A8A] text-white text-sm font-semibold">
              <div className="px-4 py-3">Date</div>
              <div className="px-4 py-3">Time</div>
              <div className="px-4 py-3">Available Slot</div>
              <div className="px-4 py-3" />
            </div>

            {/* Rows */}
            {slots.map((slot, idx) => {
              const isFull = slot.filledCount >= slot.maxCapacity
              const isSuccess = successSlotId === slot.id
              const { primary: dateStr, secondary: dayStr } = formatDate(slot.slotDate)

              return (
                <div
                  key={slot.id}
                  className={[
                    'grid grid-cols-[160px_160px_1fr_140px] border-t border-[#E2E8F0] dark:border-[#334155]',
                    idx % 2 === 0 ? 'bg-white dark:bg-[#1E293B]' : 'bg-[#F8FAFC] dark:bg-[#0F172A]/40',
                  ].join(' ')}
                >
                  <div className="px-4 py-5 self-center">
                    <p className="font-bold text-sm text-[#1E3A8A] dark:text-[#93C5FD]">{dateStr}</p>
                    <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">{dayStr}</p>
                  </div>
                  <div className="px-4 py-5 self-center">
                    <p className="font-semibold text-sm text-[#1E3A8A] dark:text-[#93C5FD]">
                      {formatTime(slot.startTime)}-{formatTime(slot.endTime)}
                    </p>
                  </div>
                  <div className="px-4 py-5 self-center">
                    <p className="font-bold text-sm text-[#1E3A8A] dark:text-[#93C5FD]">{slot.label}</p>
                    <span className={[
                      'mt-1 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
                      isFull
                        ? 'bg-red-600 text-white'
                        : 'bg-[#1E3A8A] text-white',
                    ].join(' ')}>
                      {slot.filledCount} of {slot.maxCapacity} slot{slot.maxCapacity !== 1 ? 's' : ''} filled
                    </span>
                    {isSuccess && (
                      <p className="mt-1 text-xs text-green-600 dark:text-green-400 font-medium">✓ Signed up!</p>
                    )}
                  </div>
                  <div className="px-4 py-5 self-center flex justify-end">
                    <button
                      type="button"
                      onClick={() => setActiveSlot(slot)}
                      disabled={isFull}
                      className={[
                        'rounded px-4 py-2 text-sm font-semibold border transition-colors',
                        isFull
                          ? 'border-[#CBD5E1] text-[#CBD5E1] cursor-not-allowed dark:border-[#334155] dark:text-[#334155]'
                          : 'border-[#1E3A8A] bg-[#1E3A8A] text-white hover:bg-[#1e40af]',
                      ].join(' ')}
                    >
                      {isFull ? 'Full' : 'Sign Up'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      {activeSlot && (
        <RegisterModal
          slot={activeSlot}
          slug={slug}
          onClose={() => setActiveSlot(null)}
          onSuccess={handleSignupSuccess}
        />
      )}
    </div>
  )
}
