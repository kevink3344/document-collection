import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, GitBranch } from 'lucide-react'
import { getCollection, createCollectionVersion, listCollectionVersions } from '../api/collections'
import { useToast } from '../contexts/ToastContext'
import type { Collection } from '../types'

const INPUT =
  'w-full border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#0F172A] ' +
  'text-[#1E293B] dark:text-[#F1F5F9] placeholder-[#94A3B8] px-3 py-2 text-sm rounded ' +
  'focus:outline-none focus:ring-2 focus:ring-[#2563EB]'

const LABEL = 'block text-xs font-medium text-[#64748B] mb-1'

export default function CollectionNewVersionPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { showToast } = useToast()

  const [collection, setCollection] = useState<Collection | null>(null)
  const [nextVersionNumber, setNextVersionNumber] = useState<number>(2)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [versionTitle, setVersionTitle] = useState('')
  const [versionReason, setVersionReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const collectionId = id ? parseInt(id, 10) : NaN

  useEffect(() => {
    if (isNaN(collectionId)) {
      setLoadError('Invalid collection ID')
      setLoading(false)
      return
    }
    Promise.all([
      getCollection(collectionId),
      listCollectionVersions(collectionId),
    ])
      .then(([col, versions]) => {
        setCollection(col)
        const maxVersion = versions.reduce((max, v) => Math.max(max, v.versionNumber), 0)
        setNextVersionNumber(maxVersion + 1)
      })
      .catch(err => setLoadError((err as Error).message))
      .finally(() => setLoading(false))
  }, [collectionId])

  async function handleCreate() {
    if (!collection || isNaN(collectionId)) return
    if (!versionTitle.trim()) {
      setSaveError('Version Title is required.')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      // Build a minimal payload mirroring the current collection's fields
      const created = await createCollectionVersion(collectionId, {
        title: collection.title,
        status: 'draft',
        description: collection.description ?? undefined,
        category: collection.category ?? undefined,
        dateDue: collection.dateDue ?? undefined,
        coverPhotoUrl: collection.coverPhotoUrl ?? undefined,
        coverPhotoAssetId: collection.coverPhotoAssetId ?? null,
        logoUrl: collection.logoUrl ?? undefined,
        instructions: collection.instructions ?? undefined,
        instructionsDocUrl: collection.instructionsDocUrl ?? undefined,
        workflowDefinition: collection.workflowDefinition ?? null,
        anonymous: collection.anonymous,
        allowSubmissionEdits: collection.allowSubmissionEdits,
        submissionEditWindowHours: collection.submissionEditWindowHours ?? undefined,
        fields: collection.fields.map((f, i) => ({
          fieldKey: f.fieldKey,
          type: f.type,
          label: f.label,
          subtitle: f.subtitle ?? undefined,
          page: f.page ?? 1,
          required: f.required,
          options: f.options ?? [],
          displayStyle: f.displayStyle,
          branchRules: f.branchRules ?? [],
          tableColumns: (f.tableColumns ?? []).map((c, ci) => ({
            name: c.name,
            colType: c.colType,
            listOptions: c.colType === 'list' ? (c.listOptions ?? []) : null,
            sortOrder: c.sortOrder ?? ci,
          })),
          sortOrder: i,
          staffOnly: f.staffOnly ?? false,
          locationFilterEnabled: f.locationFilterEnabled ?? false,
        })),
        versionTitle: versionTitle.trim(),
        versionReason: versionReason.trim() || undefined,
      })
      showToast(`Draft v${created.currentVersionNumber} created`, 'success')
      navigate(`/collections/${collectionId}/edit`)
    } catch (err) {
      setSaveError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-[#64748B] text-sm">
        Loading…
      </div>
    )
  }

  if (loadError || !collection) {
    return (
      <div className="rounded border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-4 text-red-700 dark:text-red-400 text-sm">
        {loadError ?? 'Collection not found.'}
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(`/collections/${collectionId}/edit`)}
          className="text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9] transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-lg font-semibold text-[#1E293B] dark:text-[#F1F5F9]">
          New Collection Version
        </h1>
      </div>

      {/* Form card */}
      <div className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg p-6 space-y-5">
        <div className="flex items-center gap-2 text-sm text-[#64748B]">
          <GitBranch size={15} />
          <span>
            Creating a new version for <span className="font-medium text-[#1E293B] dark:text-[#F1F5F9]">{collection.title}</span>
          </span>
        </div>

        {/* Next version number — read-only */}
        <div>
          <label className={LABEL}>Next Version</label>
          <input
            type="text"
            readOnly
            value={`v${nextVersionNumber}`}
            className={`${INPUT} bg-[#F8FAFC] dark:bg-[#0B1220] cursor-default select-none`}
          />
          <p className="mt-1 text-xs text-[#94A3B8]">Assigned automatically and cannot be changed.</p>
        </div>

        {/* Version Title — required */}
        <div>
          <label className={LABEL}>
            Version Title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            placeholder="e.g. Spring 2027 intake"
            value={versionTitle}
            onChange={e => setVersionTitle(e.target.value)}
            className={INPUT}
            autoFocus
          />
        </div>

        {/* Version Reason — optional */}
        <div>
          <label className={LABEL}>Version Description / Reason (optional)</label>
          <textarea
            rows={3}
            placeholder="Describe what changed or why this version is being created…"
            value={versionReason}
            onChange={e => setVersionReason(e.target.value)}
            className={`${INPUT} min-h-[72px] resize-y`}
          />
        </div>

        {saveError && (
          <div className="rounded border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-3 text-red-700 dark:text-red-400 text-sm">
            {saveError}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={() => navigate(`/collections/${collectionId}/edit`)}
            disabled={saving}
            className="rounded border border-[#CBD5E1] dark:border-[#475569] px-4 py-2 text-sm font-medium text-[#64748B] hover:bg-[#F1F5F9] dark:hover:bg-[#0F172A] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving || !versionTitle.trim()}
            className="inline-flex items-center gap-1.5 rounded bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            <GitBranch size={14} />
            {saving ? 'Creating…' : 'Create Version'}
          </button>
        </div>
      </div>
    </div>
  )
}
