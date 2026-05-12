import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Save, GitBranch } from 'lucide-react'
import { getCollection, updateCollection } from '../api/collections'
import type { CollectionPayload } from '../api/collections'
import type { Collection, CollectionField, FieldBranchRule } from '../types'

const OTHER_OPTION_MARKER = '__DCP_OTHER_OPTION__'

function normalizePage(page: number | string | null | undefined): number {
  const value = typeof page === 'number' ? page : Number(page)
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1
}

function sortFields(fields: CollectionField[]): CollectionField[] {
  return [...fields].sort((left, right) => {
    const leftPage = normalizePage(left.page)
    const rightPage = normalizePage(right.page)
    if (leftPage !== rightPage) return leftPage - rightPage
    return left.sortOrder - right.sortOrder
  })
}

function sanitizeBranchRules(rules: FieldBranchRule[] | null | undefined): FieldBranchRule[] {
  return (rules ?? [])
    .map(rule => ({
      value: rule.value.trim(),
      targetFieldKey: rule.targetFieldKey?.trim() || null,
    }))
    .filter(rule => rule.value !== '')
}

function buildPayload(collection: Collection, fields: CollectionField[]): CollectionPayload {
  return {
    title: collection.title,
    status: collection.status,
    description: collection.description ?? undefined,
    category: collection.category ?? undefined,
    dateDue: collection.dateDue ?? undefined,
    coverPhotoUrl: collection.coverPhotoUrl ?? undefined,
    logoUrl: collection.logoUrl ?? undefined,
    instructions: collection.instructions ?? undefined,
    instructionsDocUrl: collection.instructionsDocUrl ?? undefined,
    anonymous: collection.anonymous,
    allowSubmissionEdits: collection.allowSubmissionEdits,
    submissionEditWindowHours: collection.submissionEditWindowHours ?? undefined,
    fields: fields.map(field => ({
      fieldKey: field.fieldKey,
      type: field.type,
      label: field.label,
      page: field.page,
      required: field.required,
      options: field.options ?? [],
      displayStyle: field.displayStyle,
      branchRules: sanitizeBranchRules(field.branchRules),
      sortOrder: field.sortOrder,
      tableColumns: (field.tableColumns ?? []).map(column => ({
        name: column.name,
        colType: column.colType,
        listOptions: column.listOptions ?? null,
        sortOrder: column.sortOrder,
      })),
    })),
  }
}

export default function CollectionBranchingPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [collection, setCollection] = useState<Collection | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    getCollection(parseInt(id, 10))
      .then(result => {
        setCollection(result)
        const firstSingleChoice = sortFields(result.fields).find(field => field.type === 'single_choice')
        setSelectedFieldKey(firstSingleChoice?.fieldKey ?? null)
      })
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false))
  }, [id])

  const orderedFields = useMemo(() => sortFields(collection?.fields ?? []), [collection])
  const singleChoiceFields = useMemo(
    () => orderedFields.filter(field => field.type === 'single_choice' && field.fieldKey),
    [orderedFields]
  )

  const selectedField = useMemo(
    () => singleChoiceFields.find(field => field.fieldKey === selectedFieldKey) ?? singleChoiceFields[0] ?? null,
    [selectedFieldKey, singleChoiceFields]
  )

  const orderedFieldKeys = useMemo(
    () => new Map(orderedFields.map((field, index) => [field.fieldKey ?? `field-${field.id ?? index}`, index])),
    [orderedFields]
  )

  const selectedFieldOptions = useMemo(
    () => (selectedField?.options ?? []).filter(option => option !== OTHER_OPTION_MARKER),
    [selectedField]
  )

  const availableTargets = useMemo(() => {
    if (!selectedField?.fieldKey) return [] as CollectionField[]
    const selectedIndex = orderedFieldKeys.get(selectedField.fieldKey)
    if (selectedIndex === undefined) return [] as CollectionField[]
    return orderedFields.filter((field, index) => {
      if (!field.fieldKey) return false
      return index > selectedIndex
    })
  }, [orderedFieldKeys, orderedFields, selectedField])

  function updateRules(nextRules: FieldBranchRule[]) {
    if (!selectedField?.fieldKey) return
    setCollection(prev => {
      if (!prev) return prev
      return {
        ...prev,
        fields: prev.fields.map(field =>
          field.fieldKey === selectedField.fieldKey
            ? { ...field, branchRules: sanitizeBranchRules(nextRules) }
            : field
        ),
      }
    })
  }

  function updateOptionTarget(option: string, targetFieldKey: string | null) {
    if (!selectedField) return
    const currentRules = sanitizeBranchRules(selectedField.branchRules)
    const nextRules = currentRules.filter(rule => rule.value !== option)
    if (targetFieldKey) {
      nextRules.push({ value: option, targetFieldKey })
    }
    updateRules(nextRules)
  }

  async function handleSave() {
    if (!collection || !id) return
    setSaving(true)
    setSaveError(null)
    try {
      const saved = await updateCollection(parseInt(id, 10), buildPayload(collection, collection.fields))
      setCollection(saved)
    } catch (err) {
      setSaveError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-40 text-[#64748B]">Loading branching…</div>
  }

  if (error || !collection) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => navigate('/collections')}
          className="flex items-center gap-1.5 text-sm text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9] transition-colors"
        >
          <ArrowLeft size={14} />
          Back to Collections
        </button>
        <div className="rounded border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-4 text-sm text-red-700 dark:text-red-400">
          {error ?? 'Unable to load branching editor.'}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => navigate(`/collections/${collection.id}/edit`)}
            className="flex items-center gap-1.5 text-sm text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9] transition-colors"
          >
            <ArrowLeft size={14} />
            Back to Builder
          </button>
          <h1 className="text-2xl font-semibold text-[#0F172A] dark:text-[#F8FAFC] flex items-center gap-2">
            <GitBranch size={20} className="text-[#0F766E]" />
            Branching
          </h1>
          <p className="text-sm text-[#64748B]">
            Configure where each single-choice answer should jump next for {collection.title}.
          </p>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Save size={15} />
          Save branching
        </button>
      </div>

      {saveError && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {saveError}
        </div>
      )}

      {singleChoiceFields.length === 0 ? (
        <div className="rounded-lg border border-[#E2E8F0] bg-white p-6 text-sm text-[#64748B] dark:border-[#334155] dark:bg-[#1E293B]">
          Add at least one single-choice question before configuring branching.
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="rounded-lg border border-[#E2E8F0] bg-white p-3 dark:border-[#334155] dark:bg-[#1E293B]">
            <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-[#64748B]">
              Branch Sources
            </p>
            <div className="space-y-2">
              {singleChoiceFields.map(field => {
                const rulesCount = sanitizeBranchRules(field.branchRules).filter(rule => rule.targetFieldKey).length
                const selected = field.fieldKey === selectedField?.fieldKey
                return (
                  <button
                    key={field.fieldKey}
                    type="button"
                    onClick={() => setSelectedFieldKey(field.fieldKey ?? null)}
                    className={[
                      'w-full rounded-[6px] border px-3 py-2 text-left transition-colors',
                      selected
                        ? 'border-[#0F766E] bg-emerald-50 text-[#0F172A] dark:border-emerald-500 dark:bg-emerald-900/20 dark:text-[#F8FAFC]'
                        : 'border-[#E2E8F0] bg-[#F8FAFC] hover:border-[#94A3B8] dark:border-[#334155] dark:bg-[#0F172A] dark:hover:border-[#475569]',
                    ].join(' ')}
                  >
                    <div className="text-xs text-[#64748B]">Page {normalizePage(field.page)}</div>
                    <div className="mt-1 text-sm font-medium">{field.label || 'Untitled question'}</div>
                    <div className="mt-1 text-xs text-[#0F766E] dark:text-emerald-300">
                      {rulesCount} route{rulesCount === 1 ? '' : 's'} configured
                    </div>
                  </button>
                )
              })}
            </div>
          </aside>

          <section className="rounded-lg border border-[#E2E8F0] bg-white p-5 dark:border-[#334155] dark:bg-[#1E293B]">
            {selectedField ? (
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">Selected question</p>
                  <h2 className="mt-1 text-lg font-semibold text-[#0F172A] dark:text-[#F8FAFC]">{selectedField.label}</h2>
                  <p className="mt-1 text-sm text-[#64748B]">
                    Choose the first question respondents should see next for each answer. Leaving a route empty keeps the normal order.
                  </p>
                </div>

                {selectedFieldOptions.length === 0 ? (
                  <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                    This question needs answer options before it can drive branching.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selectedFieldOptions.map(option => {
                      const currentRule = sanitizeBranchRules(selectedField.branchRules).find(rule => rule.value === option)
                      return (
                        <div
                          key={option}
                          className="grid gap-3 rounded-[8px] border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 dark:border-[#334155] dark:bg-[#0F172A] md:grid-cols-[180px_minmax(0,1fr)] md:items-center"
                        >
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">Answer</div>
                            <div className="mt-1 text-sm font-medium text-[#0F172A] dark:text-[#F8FAFC]">{option}</div>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-[#64748B] mb-1">
                              Next question
                            </label>
                            <select
                              value={currentRule?.targetFieldKey ?? ''}
                              onChange={event => updateOptionTarget(option, event.target.value || null)}
                              className="w-full rounded border border-[#E2E8F0] bg-white px-3 py-2 text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#2563EB] dark:border-[#334155] dark:bg-[#0F172A] dark:text-[#F8FAFC]"
                            >
                              <option value="">Continue normally</option>
                              {availableTargets.map(target => (
                                <option key={target.fieldKey} value={target.fieldKey}>
                                  Page {normalizePage(target.page)} - {target.label || 'Untitled question'}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ) : null}
          </section>
        </div>
      )}
    </div>
  )
}