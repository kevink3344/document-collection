import { useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  TrendingUp,
  Layers,
  Tag,
  Users,
  ChevronUp,
  ChevronDown,
  Download,
  Loader2,
  AlertCircle,
  Sparkles,
  RefreshCw,
  Copy,
  CheckCheck,
} from 'lucide-react'
import { getReportsData, getAiReportsSummary, type ReportsData, type ReportsDatePreset, type AiSummaryResponse, type AiFocusArea } from '../api/stats'
import { listCollections } from '../api/collections'
import { getCategoryColorClasses } from '../utils/categoryColors'
import { useAuth } from '../contexts/AuthContext'
import type { Collection } from '../types'

type SortCol = 'title' | 'submissionCount' | 'lastActivity' | 'status'
type SortDir = 'asc' | 'desc'

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtRole(role: string): string {
  return role.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function exportCSV(
  rows: ReportsData['collectionPerformance'],
): void {
  const headers = ['ID', 'Title', 'Category', 'Status', 'Submissions', 'Last Activity']
  const body = rows.map(r => [
    r.id,
    `"${r.title.replace(/"/g, '""')}"`,
    r.category ?? 'Uncategorised',
    r.status,
    r.submissionCount,
    r.lastActivity ?? '',
  ])
  const csv = [headers, ...body].map(row => row.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'collection-performance.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// ── Submissions Bar Chart ─────────────────────────────────────────────────────

function SubmissionsChart({ data }: { data: { date: string; count: number }[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-[#64748B]">
        No submissions in this period.
      </div>
    )
  }

  const W = 560
  const H = 140
  const PAD = { top: 10, right: 8, bottom: 28, left: 32 }
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top - PAD.bottom

  const maxVal = Math.max(...data.map(d => d.count), 1)
  const barW = Math.max(2, Math.floor(chartW / data.length) - 2)

  const yTicks = [0, Math.ceil(maxVal / 2), maxVal]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" aria-label="Submissions over time bar chart">
      {/* Y gridlines */}
      {yTicks.map(tick => {
        const y = PAD.top + chartH - (tick / maxVal) * chartH
        return (
          <g key={tick}>
            <line
              x1={PAD.left}
              y1={y}
              x2={PAD.left + chartW}
              y2={y}
              stroke="#E2E8F0"
              strokeWidth={1}
            />
            <text x={PAD.left - 4} y={y + 4} textAnchor="end" fontSize={9} fill="#94A3B8">
              {tick}
            </text>
          </g>
        )
      })}

      {/* Bars */}
      {data.map((d, i) => {
        const x = PAD.left + i * (chartW / data.length) + (chartW / data.length - barW) / 2
        const barH = (d.count / maxVal) * chartH
        const y = PAD.top + chartH - barH
        return (
          <g key={d.date}>
            <rect x={x} y={y} width={barW} height={barH} rx={2} fill="#2563EB" opacity={0.8} />
            {/* Tooltip-like title */}
            <title>{`${d.date}: ${d.count}`}</title>
          </g>
        )
      })}

      {/* X axis labels — show ~5 evenly spaced */}
      {data.length > 0 && (() => {
        const labelCount = Math.min(data.length, 5)
        const step = Math.floor((data.length - 1) / (labelCount - 1)) || 1
        const indices = Array.from({ length: labelCount }, (_, k) => Math.min(k * step, data.length - 1))
        return indices.map(i => {
          const d = data[i]
          const cx = PAD.left + i * (chartW / data.length) + (chartW / data.length) / 2
          const label = new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
          return (
            <text key={d.date} x={cx} y={H - 4} textAnchor="middle" fontSize={9} fill="#94A3B8">
              {label}
            </text>
          )
        })
      })()}

      {/* X axis baseline */}
      <line
        x1={PAD.left}
        y1={PAD.top + chartH}
        x2={PAD.left + chartW}
        y2={PAD.top + chartH}
        stroke="#E2E8F0"
        strokeWidth={1}
      />
    </svg>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'administrator'

  const [preset, setPreset] = useState<ReportsDatePreset>(30)
  const [data, setData] = useState<ReportsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [sortCol, setSortCol] = useState<SortCol>('submissionCount')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // AI summary state
  const [aiData, setAiData] = useState<AiSummaryResponse | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiFocus, setAiFocus] = useState<AiFocusArea>('general')
  const [copied, setCopied] = useState(false)
  const [surveyOptions, setSurveyOptions] = useState<Collection[]>([])
  const [selectedSurveyId, setSelectedSurveyId] = useState<number | 'all'>('all')

  function generateSummary() {
    setAiLoading(true)
    setAiError(null)
    getAiReportsSummary(preset, aiFocus, selectedSurveyId === 'all' ? undefined : selectedSurveyId)
      .then(setAiData)
      .catch(err => setAiError((err as Error).message))
      .finally(() => setAiLoading(false))
  }

  function copySummary() {
    if (!aiData) return
    const text = [
      aiData.summary,
      '',
      'Key Findings:',
      ...aiData.findings.map(f => `• ${f}`),
      '',
      'Recommended Actions:',
      ...aiData.actions.map(a => `• ${a}`),
    ].join('\n')
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  useEffect(() => {
    setLoading(true)
    setError(null)
    getReportsData(preset)
      .then(setData)
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false))
  }, [preset])

  useEffect(() => {
    listCollections()
      .then(items => setSurveyOptions(items.slice().sort((a, b) => a.title.localeCompare(b.title))))
      .catch(() => setSurveyOptions([]))
  }, [])

  useEffect(() => {
    setAiData(null)
    setAiError(null)
  }, [preset, aiFocus, selectedSurveyId])

  // Sorted collection performance
  const sortedPerformance = useMemo(() => {
    if (!data) return []
    return [...data.collectionPerformance].sort((a, b) => {
      let cmp = 0
      if (sortCol === 'title') cmp = a.title.localeCompare(b.title)
      else if (sortCol === 'submissionCount') cmp = a.submissionCount - b.submissionCount
      else if (sortCol === 'status') cmp = a.status.localeCompare(b.status)
      else if (sortCol === 'lastActivity') {
        const av = a.lastActivity ?? ''
        const bv = b.lastActivity ?? ''
        cmp = av.localeCompare(bv)
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [data, sortCol, sortDir])

  function toggleSort(col: SortCol) {
    if (sortCol === col) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortCol(col); setSortDir('desc') }
  }

  const maxCategoryCount = data
    ? Math.max(...data.categoryBreakdown.map(c => c.count), 1)
    : 1

  const PRESETS: { label: string; value: ReportsDatePreset }[] = [
    { label: 'Last 7 days', value: 7 },
    { label: 'Last 30 days', value: 30 },
    { label: 'Last 90 days', value: 90 },
    { label: 'All time', value: 'all' },
  ]

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Reports</h1>
          <p className="text-sm text-[#64748B] mt-0.5">Insights and analytics for your collections.</p>
        </div>

        {/* Date range filter */}
        <div className="flex items-center gap-1 bg-[#F1F5F9] dark:bg-[#1E293B] p-1 rounded-lg">
          {PRESETS.map(p => (
            <button
              key={p.value}
              onClick={() => setPreset(p.value)}
              className={[
                'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                preset === p.value
                  ? 'bg-white dark:bg-[#334155] text-[#1E293B] dark:text-[#F1F5F9] shadow-sm'
                  : 'text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9]',
              ].join(' ')}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin text-[#2563EB]" />
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {!loading && data && (
        <>
          {/* ── KPI Cards ─────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              icon={<TrendingUp size={20} className="text-[#2563EB]" />}
              label="Total Submissions"
              value={data.kpi.totalSubmissions.toLocaleString()}
            />
            <KpiCard
              icon={<Layers size={20} className="text-emerald-500" />}
              label="Active Collections"
              value={data.kpi.activeCollections.toLocaleString()}
            />
            <KpiCard
              icon={<Tag size={20} className="text-violet-500" />}
              label="Categories in Use"
              value={data.kpi.categoriesInUse.toLocaleString()}
            />
            <KpiCard
              icon={<BarChart3 size={20} className="text-amber-500" />}
              label="Avg Submissions / Collection"
              value={data.kpi.avgSubmissionsPerCollection.toLocaleString()}
            />
          </div>

          {/* ── Charts row ────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Submissions over time */}
            <section className="lg:col-span-2 bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg p-4">
              <h2 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9] mb-3">
                Submissions Over Time
              </h2>
              <SubmissionsChart data={data.submissionsOverTime} />
            </section>

            {/* Category breakdown */}
            <section className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg p-4">
              <h2 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9] mb-3">
                Submissions by Category
              </h2>
              {data.categoryBreakdown.length === 0 ? (
                <p className="text-sm text-[#64748B] text-center py-10">No data.</p>
              ) : (
                <ul className="space-y-3">
                  {data.categoryBreakdown.map(item => {
                    const pct = Math.round((item.count / maxCategoryCount) * 100)
                    const colorClass = getCategoryColorClasses(item.category)
                    return (
                      <li key={item.category}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${colorClass}`}>
                            {item.category}
                          </span>
                          <span className="text-[#64748B] font-medium">{item.count}</span>
                        </div>
                        <div className="h-1.5 bg-[#F1F5F9] dark:bg-[#334155] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#2563EB] rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </div>

          {/* ── Collection Performance Table ───────────────── */}
          <section className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#E2E8F0] dark:border-[#334155]">
              <h2 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9]">
                Collection Performance
              </h2>
              <button
                onClick={() => exportCSV(sortedPerformance)}
                className="flex items-center gap-1.5 text-xs font-medium text-[#2563EB] hover:text-blue-700 transition-colors"
              >
                <Download size={13} />
                Export CSV
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E2E8F0] dark:border-[#334155]">
                    {(
                      [
                        { col: 'title', label: 'Collection' },
                        { col: 'status', label: 'Status' },
                        { col: 'submissionCount', label: 'Submissions' },
                        { col: 'lastActivity', label: 'Last Activity' },
                      ] as { col: SortCol; label: string }[]
                    ).map(({ col, label }) => (
                      <th
                        key={col}
                        className="px-4 py-2.5 text-left font-medium text-[#64748B] text-xs cursor-pointer select-none whitespace-nowrap hover:text-[#1E293B] dark:hover:text-[#F1F5F9] transition-colors"
                        onClick={() => toggleSort(col)}
                      >
                        <span className="inline-flex items-center gap-1">
                          {label}
                          {sortCol === col ? (
                            sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                          ) : (
                            <ChevronDown size={12} className="opacity-30" />
                          )}
                        </span>
                      </th>
                    ))}
                    <th className="px-4 py-2.5 text-left font-medium text-[#64748B] text-xs whitespace-nowrap">
                      Category
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPerformance.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-sm text-[#64748B]">
                        No collections found.
                      </td>
                    </tr>
                  ) : (
                    sortedPerformance.map((row, i) => (
                      <tr
                        key={row.id}
                        className={[
                          'border-b border-[#F1F5F9] dark:border-[#1E293B] last:border-0',
                          i % 2 === 0 ? '' : 'bg-[#F8FAFC] dark:bg-[#0F172A]/30',
                        ].join(' ')}
                      >
                        <td className="px-4 py-2.5 font-medium text-[#1E293B] dark:text-[#F1F5F9] max-w-[240px] truncate">
                          {row.title}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={[
                              'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                              row.status === 'published'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                : 'bg-[#F1F5F9] text-[#64748B] dark:bg-[#334155] dark:text-[#94A3B8]',
                            ].join(' ')}
                          >
                            {row.status === 'published' ? 'Active' : 'Draft'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-[#1E293B] dark:text-[#F1F5F9]">
                          {row.submissionCount.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-[#64748B] whitespace-nowrap">
                          {fmtDate(row.lastActivity)}
                        </td>
                        <td className="px-4 py-2.5">
                          {row.category ? (
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${getCategoryColorClasses(row.category)}`}
                            >
                              {row.category}
                            </span>
                          ) : (
                            <span className="text-[#94A3B8] text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── User Activity (admin only) ─────────────────── */}
          {isAdmin && data.userActivity.length > 0 && (
            <section className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-[#E2E8F0] dark:border-[#334155]">
                <Users size={15} className="text-[#64748B]" />
                <h2 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9]">User Activity</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#E2E8F0] dark:border-[#334155]">
                      {['Name', 'Role', 'Organization', 'Submissions', 'Last Active'].map(h => (
                        <th
                          key={h}
                          className="px-4 py-2.5 text-left font-medium text-[#64748B] text-xs whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.userActivity.map((u, i) => (
                      <tr
                        key={u.id}
                        className={[
                          'border-b border-[#F1F5F9] dark:border-[#1E293B] last:border-0',
                          i % 2 === 0 ? '' : 'bg-[#F8FAFC] dark:bg-[#0F172A]/30',
                        ].join(' ')}
                      >
                        <td className="px-4 py-2.5 font-medium text-[#1E293B] dark:text-[#F1F5F9]">
                          {u.name}
                        </td>
                        <td className="px-4 py-2.5 text-[#64748B]">{fmtRole(u.role)}</td>
                        <td className="px-4 py-2.5 text-[#64748B]">{u.organization ?? '—'}</td>
                        <td className="px-4 py-2.5 tabular-nums text-[#1E293B] dark:text-[#F1F5F9]">
                          {u.submissionCount.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-[#64748B] whitespace-nowrap">
                          {fmtDate(u.lastActive)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ── AI Summary Panel ─────────────────────────────── */}
          <section className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-b border-[#E2E8F0] dark:border-[#334155]">
              <div className="flex items-center gap-2">
                <Sparkles size={15} className="text-violet-500" />
                <h2 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9]">AI Summary</h2>
                <span className="text-xs text-[#64748B] hidden sm:inline">— Powered by Groq</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={selectedSurveyId === 'all' ? 'all' : String(selectedSurveyId)}
                  onChange={e => setSelectedSurveyId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  disabled={aiLoading}
                  className="text-xs border border-[#E2E8F0] dark:border-[#334155] rounded-md px-2 py-1.5 bg-white dark:bg-[#0F172A] text-[#1E293B] dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#2563EB] min-w-[180px]"
                >
                  <option value="all">All surveys</option>
                  {surveyOptions.map(collection => (
                    <option key={collection.id} value={collection.id}>{collection.title}</option>
                  ))}
                </select>
                <select
                  value={aiFocus}
                  onChange={e => setAiFocus(e.target.value as AiFocusArea)}
                  disabled={aiLoading}
                  className="text-xs border border-[#E2E8F0] dark:border-[#334155] rounded-md px-2 py-1.5 bg-white dark:bg-[#0F172A] text-[#1E293B] dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                >
                  <option value="general">General overview</option>
                  <option value="trend">Submission trends</option>
                  <option value="categories">Categories</option>
                  <option value="collections">Collections</option>
                  <option value="users">User activity</option>
                </select>
                <button
                  onClick={generateSummary}
                  disabled={aiLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white transition-colors"
                >
                  {aiLoading ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : aiData ? (
                    <RefreshCw size={13} />
                  ) : (
                    <Sparkles size={13} />
                  )}
                  {aiLoading ? 'Generating…' : aiData ? 'Regenerate' : 'Generate Summary'}
                </button>
                {aiData && !aiLoading && (
                  <button
                    onClick={copySummary}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-[#E2E8F0] dark:border-[#334155] text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9] transition-colors"
                  >
                    {copied ? <CheckCheck size={13} className="text-emerald-500" /> : <Copy size={13} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                )}
              </div>
            </div>

            <div className="px-4 py-4">
              {!aiData && !aiLoading && !aiError && (
                <p className="text-sm text-[#64748B] text-center py-8">
                  Click <span className="font-medium text-violet-600">Generate Summary</span> to produce an AI-powered insight for the selected date range and survey scope.
                </p>
              )}

              {aiLoading && (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-[#64748B]">
                  <Loader2 size={18} className="animate-spin text-violet-500" />
                  Generating summary…
                </div>
              )}

              {!aiLoading && aiError && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3">
                  <AlertCircle size={15} />
                  {aiError}
                </div>
              )}

              {!aiLoading && aiData && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#94A3B8]">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${
                      aiData.usedAi
                        ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400'
                        : 'bg-[#F1F5F9] text-[#64748B] dark:bg-[#334155] dark:text-[#94A3B8]'
                    }`}>
                      {aiData.usedAi ? <Sparkles size={10} /> : null}
                      {aiData.usedAi ? `AI · ${aiData.model}` : 'Deterministic fallback'}
                    </span>
                    <span>{aiData.scopeLabel}</span>
                    <span>·</span>
                    <span>{aiData.dataWindow}</span>
                    <span>·</span>
                    <span>Generated {new Date(aiData.generatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>

                  <p className="text-sm text-[#1E293B] dark:text-[#F1F5F9] leading-relaxed">
                    {aiData.summary}
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-[#F8FAFC] dark:bg-[#0F172A]/40 rounded-lg p-4">
                      <h3 className="text-xs font-semibold text-[#64748B] uppercase tracking-wide mb-2">Key Findings</h3>
                      <ul className="space-y-1.5">
                        {aiData.findings.map((f, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-[#1E293B] dark:text-[#F1F5F9]">
                            <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-violet-500" />
                            {f}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="bg-[#F8FAFC] dark:bg-[#0F172A]/40 rounded-lg p-4">
                      <h3 className="text-xs font-semibold text-[#64748B] uppercase tracking-wide mb-2">Recommended Actions</h3>
                      <ul className="space-y-1.5">
                        {aiData.actions.map((a, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-[#1E293B] dark:text-[#F1F5F9]">
                            <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            {a}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1 border-t border-[#F1F5F9] dark:border-[#334155]">
                    <p className="text-xs text-[#94A3B8] flex-1">{aiData.confidenceNote}</p>
                    <p className="text-xs text-[#94A3B8] italic">AI-generated summary — verify before decision-making.</p>
                  </div>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg px-4 py-4 flex items-start gap-3">
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-[#64748B] leading-tight">{label}</p>
        <p className="text-2xl font-bold text-[#1E293B] dark:text-[#F1F5F9] mt-1 tabular-nums">
          {value}
        </p>
      </div>
    </div>
  )
}
