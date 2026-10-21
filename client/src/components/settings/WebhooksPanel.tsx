import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Save, Trash2, Webhook as WebhookIcon, Zap } from 'lucide-react'
import {
  deleteWebhook,
  listWebhookDeliveries,
  listWebhooks,
  saveWebhook,
  testWebhook,
} from '../../api/webhooks'
import type {
  Webhook,
  WebhookDelivery,
  WebhookKey,
  WebhookResponseShape,
  WebhookTestResult,
} from '../../types'

const INPUT =
  'w-full border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#0F172A] ' +
  'text-[#1E293B] dark:text-[#F1F5F9] placeholder-[#94A3B8] px-3 py-2 text-sm rounded ' +
  'focus:outline-none focus:ring-2 focus:ring-[#2563EB]'

const LABEL = 'text-sm font-medium text-[#475569] dark:text-[#CBD5E1]'

interface DraftState {
  name: string
  url: string
  secret: string
  enabled: boolean
  timeoutMs: number
  responseShape: WebhookResponseShape
  responseKey: string
}

const EMPTY_DRAFT: DraftState = {
  name: '',
  url: '',
  secret: '',
  enabled: true,
  timeoutMs: 5000,
  responseShape: 'json_boolean',
  responseKey: 'valid',
}

function draftFromWebhook(hook: Webhook | null): DraftState {
  if (!hook) return { ...EMPTY_DRAFT }
  return {
    name: hook.name ?? '',
    url: hook.url,
    secret: '',
    enabled: hook.enabled,
    timeoutMs: hook.timeoutMs,
    responseShape: hook.responseShape,
    responseKey: hook.responseKey,
  }
}

function shapePreview(shape: WebhookResponseShape, key: string): string {
  if (shape === 'plain_text') return 'true'
  if (shape === 'json_string') return `{ "${key || 'valid'}": "true" }`
  return `{ "${key || 'valid'}": true }`
}

function WebhookCard({
  webhookKey,
  title,
  description,
  isValidation,
}: {
  webhookKey: WebhookKey
  title: string
  description: string
  isValidation: boolean
}) {
  const [hook, setHook] = useState<Webhook | null>(null)
  const [draft, setDraft] = useState<DraftState>({ ...EMPTY_DRAFT })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedOk, setSavedOk] = useState(false)
  const [testResult, setTestResult] = useState<WebhookTestResult | null>(null)
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([])
  const [showDeliveries, setShowDeliveries] = useState(false)
  const [clearSecret, setClearSecret] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const all = await listWebhooks()
      const found = all.find(item => item.key === webhookKey) ?? null
      setHook(found)
      setDraft(draftFromWebhook(found))
      setClearSecret(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [webhookKey])

  useEffect(() => {
    void load()
  }, [load])

  const loadDeliveries = useCallback(async () => {
    try {
      setDeliveries(await listWebhookDeliveries(webhookKey))
    } catch (err) {
      setError((err as Error).message)
    }
  }, [webhookKey])

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSavedOk(false)
    try {
      const payload: Parameters<typeof saveWebhook>[1] = {
        name: draft.name.trim() || null,
        url: draft.url.trim(),
        enabled: draft.enabled,
        timeoutMs: draft.timeoutMs,
      }
      if (isValidation) {
        payload.responseShape = draft.responseShape
        payload.responseKey = draft.responseKey.trim() || 'valid'
      }
      if (clearSecret) {
        payload.secret = ''
      } else if (draft.secret.trim()) {
        payload.secret = draft.secret
      }
      const saved = await saveWebhook(webhookKey, payload)
      setHook(saved)
      setDraft(draftFromWebhook(saved))
      setClearSecret(false)
      setSavedOk(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setError(null)
    setTestResult(null)
    try {
      setTestResult(await testWebhook(webhookKey))
      if (showDeliveries) await loadDeliveries()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setTesting(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete ${title}? This cannot be undone.`)) return
    setSaving(true)
    setError(null)
    try {
      await deleteWebhook(webhookKey)
      setHook(null)
      setDraft({ ...EMPTY_DRAFT })
      setTestResult(null)
      setDeliveries([])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function toggleDeliveries() {
    const next = !showDeliveries
    setShowDeliveries(next)
    if (next) await loadDeliveries()
  }

  return (
    <section className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden">
      <div className="flex items-start gap-3 px-5 py-4 border-b border-[#E2E8F0] dark:border-[#334155]">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EFF6FF] text-[#2563EB] dark:bg-blue-900/30 dark:text-blue-300">
          <WebhookIcon size={18} />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-[#1E293B] dark:text-[#F1F5F9]">{title}</h3>
          <p className="text-sm text-[#64748B] mt-1">{description}</p>
        </div>
        <span
          className={[
            'ml-auto shrink-0 rounded-full px-2.5 py-1 text-xs font-medium',
            hook
              ? hook.enabled
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
              : 'bg-[#F1F5F9] text-[#64748B] dark:bg-[#0F172A] dark:text-[#94A3B8]',
          ].join(' ')}
        >
          {hook ? (hook.enabled ? 'Enabled' : 'Disabled') : 'Not configured'}
        </span>
      </div>

      <div className="p-5 space-y-4">
        {loading ? (
          <p className="text-sm text-[#64748B]">Loading…</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2 flex flex-col gap-1.5">
                <label className={LABEL}>URL</label>
                <input
                  type="url"
                  value={draft.url}
                  onChange={e => { setDraft(d => ({ ...d, url: e.target.value })); setSavedOk(false) }}
                  placeholder="https://prod-00.westus.logic.azure.com/workflows/..."
                  className={INPUT}
                />
                <p className="text-xs text-[#94A3B8]">
                  Paste the full URL including any query string (Power Automate URLs contain a <code>sig=</code> parameter).
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className={LABEL}>Name <span className="font-normal text-[#94A3B8]">(optional)</span></label>
                <input
                  type="text"
                  value={draft.name}
                  onChange={e => { setDraft(d => ({ ...d, name: e.target.value })); setSavedOk(false) }}
                  placeholder="Student records system"
                  className={INPUT}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className={LABEL}>Timeout (ms)</label>
                <input
                  type="number"
                  min={500}
                  max={30000}
                  step={500}
                  value={draft.timeoutMs}
                  onChange={e => { setDraft(d => ({ ...d, timeoutMs: Number(e.target.value) || 5000 })); setSavedOk(false) }}
                  className={INPUT}
                />
              </div>

              <div className="sm:col-span-2 flex flex-col gap-1.5">
                <label className={LABEL}>
                  Secret <span className="font-normal text-[#94A3B8]">(optional)</span>
                </label>
                <input
                  type="password"
                  value={draft.secret}
                  onChange={e => { setDraft(d => ({ ...d, secret: e.target.value })); setClearSecret(false); setSavedOk(false) }}
                  placeholder={hook?.hasSecret ? '•••• (saved)' : 'Leave blank for Power Automate / unsigned endpoints'}
                  className={INPUT}
                  autoComplete="new-password"
                />
                <p className="text-xs text-[#94A3B8]">
                  Sent as the <code>X-Webhook-Secret</code> header. Leave blank to send no auth header.
                </p>
                {hook?.hasSecret && (
                  <label className="flex items-center gap-2 text-xs text-[#64748B] dark:text-[#94A3B8]">
                    <input
                      type="checkbox"
                      checked={clearSecret}
                      onChange={e => { setClearSecret(e.target.checked); setSavedOk(false) }}
                      className="h-3.5 w-3.5 accent-[#2563EB]"
                    />
                    Clear the saved secret
                  </label>
                )}
              </div>
            </div>

            {isValidation && (
              <div className="rounded-lg border border-[#E2E8F0] dark:border-[#334155] p-4 space-y-3">
                <div>
                  <p className="text-sm font-medium text-[#1E293B] dark:text-[#F1F5F9]">Response shape</p>
                  <p className="text-xs text-[#64748B] mt-1">
                    How to read the result. Change this without a redeploy if the endpoint&apos;s contract changes.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className={LABEL}>Shape</label>
                    <select
                      value={draft.responseShape}
                      onChange={e => { setDraft(d => ({ ...d, responseShape: e.target.value as WebhookResponseShape })); setSavedOk(false) }}
                      className={INPUT}
                    >
                      <option value="json_boolean">JSON boolean</option>
                      <option value="json_string">JSON string</option>
                      <option value="plain_text">Plain text</option>
                    </select>
                  </div>
                  {draft.responseShape !== 'plain_text' && (
                    <div className="flex flex-col gap-1.5">
                      <label className={LABEL}>Key</label>
                      <input
                        type="text"
                        value={draft.responseKey}
                        onChange={e => { setDraft(d => ({ ...d, responseKey: e.target.value })); setSavedOk(false) }}
                        placeholder="valid"
                        className={INPUT}
                      />
                    </div>
                  )}
                </div>
                <p className="text-xs text-[#64748B]">
                  Expecting: <code className="rounded bg-[#F1F5F9] px-1.5 py-0.5 dark:bg-[#0F172A]">{shapePreview(draft.responseShape, draft.responseKey)}</code>
                </p>
              </div>
            )}

            <label className="flex items-center justify-between gap-4 rounded-lg border border-[#E2E8F0] dark:border-[#334155] px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[#1E293B] dark:text-[#F1F5F9]">Enabled</p>
                <p className="text-xs text-[#64748B] mt-1">
                  {isValidation
                    ? 'When disabled, Student ID fields are treated as always valid.'
                    : 'When disabled, submissions are not forwarded.'}
                </p>
              </div>
              <input
                type="checkbox"
                role="switch"
                aria-label="Enabled"
                aria-checked={draft.enabled}
                checked={draft.enabled}
                onChange={e => { setDraft(d => ({ ...d, enabled: e.target.checked })); setSavedOk(false) }}
                className="relative h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full bg-[#CBD5E1] outline-none transition-colors duration-200 before:absolute before:left-0.5 before:top-0.5 before:h-5 before:w-5 before:rounded-full before:bg-white before:shadow before:transition-transform before:duration-200 before:content-[''] checked:bg-[#2563EB] checked:before:translate-x-5 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2 dark:bg-[#475569]"
              />
            </label>

            {error && <p className="text-sm text-red-500">{error}</p>}
            {savedOk && <p className="text-sm text-green-600 dark:text-green-400">Saved!</p>}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !draft.url.trim()}
                className="inline-flex items-center gap-1.5 bg-[#2563EB] hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
              >
                <Save size={14} />
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={handleTest}
                disabled={testing || !hook}
                title={hook ? 'Send a sample payload' : 'Save the webhook first'}
                className="inline-flex items-center gap-1.5 border border-[#CBD5E1] dark:border-[#334155] text-[#1E293B] dark:text-[#F1F5F9] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] disabled:opacity-50 text-sm font-medium px-4 py-2 rounded transition-colors"
              >
                <Zap size={14} />
                {testing ? 'Testing…' : 'Test'}
              </button>
              {hook && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 text-red-600 hover:text-red-700 disabled:opacity-50 text-sm font-medium px-3 py-2 rounded transition-colors"
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              )}
            </div>

            {testResult && (
              <div
                className={[
                  'rounded border px-3 py-2 text-xs space-y-1',
                  testResult.ok
                    ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-900/40 dark:bg-green-900/10 dark:text-green-300'
                    : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-300',
                ].join(' ')}
              >
                <p className="font-medium">
                  {testResult.ok ? 'Success' : 'Failed'} · HTTP {testResult.httpStatus ?? '—'} · {testResult.durationMs}ms
                  {isValidation && testResult.parsed !== undefined && testResult.parsed !== null && (
                    <> · Parsed: {String(testResult.parsed)}</>
                  )}
                </p>
                {testResult.error && <p>{testResult.error}</p>}
                {testResult.rawBody && (
                  <pre className="whitespace-pre-wrap break-all font-mono text-[11px] opacity-80">{testResult.rawBody}</pre>
                )}
              </div>
            )}

            {hook && (
              <div className="border-t border-[#E2E8F0] dark:border-[#334155] pt-3">
                <button
                  type="button"
                  onClick={toggleDeliveries}
                  className="flex items-center gap-1.5 text-sm font-medium text-[#2563EB] hover:text-blue-700"
                >
                  {showDeliveries ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  Recent deliveries
                </button>
                {showDeliveries && (
                  <div className="mt-3 space-y-2">
                    {deliveries.length === 0 ? (
                      <p className="text-xs text-[#94A3B8]">No deliveries recorded yet.</p>
                    ) : (
                      deliveries.map(delivery => (
                        <div
                          key={delivery.id}
                          className="rounded border border-[#E2E8F0] dark:border-[#334155] px-3 py-2 text-xs space-y-1"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={[
                                'rounded-full px-2 py-0.5 font-medium',
                                delivery.status === 'success'
                                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                                  : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
                              ].join(' ')}
                            >
                              {delivery.status}
                            </span>
                            <span className="text-[#64748B]">{delivery.direction}</span>
                            <span className="text-[#64748B]">HTTP {delivery.httpStatus ?? '—'}</span>
                            <span className="text-[#64748B]">{delivery.durationMs ?? '—'}ms</span>
                            <span className="ml-auto text-[#94A3B8]">{delivery.createdAt}</span>
                          </div>
                          {delivery.error && <p className="text-red-600 dark:text-red-400">{delivery.error}</p>}
                          {delivery.responseBody && (
                            <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-[#64748B]">{delivery.responseBody}</pre>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

export default function WebhooksPanel() {
  return (
    <div className="space-y-4">
      <WebhookCard
        webhookKey="webhook-1"
        title="Webhook 1 — Field Validation"
        description="Called when a Student ID field loses focus. Must return a truthy result for the form to submit."
        isValidation
      />
      <WebhookCard
        webhookKey="webhook-2"
        title="Webhook 2 — Submission Forwarding"
        description="Called after a form is submitted. Receives the full submission as JSON. Failures never block the respondent."
        isValidation={false}
      />
    </div>
  )
}
