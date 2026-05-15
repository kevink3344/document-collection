import { useEffect, useMemo, useState } from 'react'
import { Sparkles, Loader2, AlertCircle, RefreshCw, Copy, CheckCheck, Download, RotateCcw } from 'lucide-react'
import { jsPDF } from 'jspdf'
import { listCollections } from '../api/collections'
import { getAiReportsSummary, type AiFocusArea, type AiSummaryResponse, type ReportsDatePreset } from '../api/stats'
import type { Collection } from '../types'

const DEFAULT_PROMPT_TEXT = 'Provide a concise executive-ready summary that highlights the most important patterns, risks, opportunities, and recommended next actions for administrators.'

export default function AISummaryPage() {
  const [preset, setPreset] = useState<ReportsDatePreset>(30)
  const [surveyOptions, setSurveyOptions] = useState<Collection[]>([])
  const [selectedSurveyId, setSelectedSurveyId] = useState<number | 'all'>('all')
  const [aiFocus, setAiFocus] = useState<AiFocusArea>('general')
  const [promptText, setPromptText] = useState(DEFAULT_PROMPT_TEXT)
  const [lastPromptUsed, setLastPromptUsed] = useState(DEFAULT_PROMPT_TEXT)
  const [aiData, setAiData] = useState<AiSummaryResponse | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    listCollections()
      .then(items => setSurveyOptions(items.slice().sort((a, b) => a.title.localeCompare(b.title))))
      .catch(() => setSurveyOptions([]))
  }, [])

  useEffect(() => {
    setAiData(null)
    setAiError(null)
  }, [preset, aiFocus, selectedSurveyId])

  const selectedSurveyLabel = useMemo(() => {
    if (selectedSurveyId === 'all') return 'All surveys'
    return surveyOptions.find(collection => collection.id === selectedSurveyId)?.title ?? 'Selected survey'
  }, [selectedSurveyId, surveyOptions])

  const PRESETS: { label: string; value: ReportsDatePreset }[] = [
    { label: 'Last 7 days', value: 7 },
    { label: 'Last 30 days', value: 30 },
    { label: 'Last 90 days', value: 90 },
    { label: 'All time', value: 'all' },
  ]

  function generateSummary() {
    const trimmedPrompt = promptText.trim() || DEFAULT_PROMPT_TEXT
    setLastPromptUsed(trimmedPrompt)
    setAiLoading(true)
    setAiError(null)
    getAiReportsSummary(
      preset,
      aiFocus,
      selectedSurveyId === 'all' ? undefined : selectedSurveyId,
      trimmedPrompt,
    )
      .then(setAiData)
      .catch(err => setAiError((err as Error).message))
      .finally(() => setAiLoading(false))
  }

  function copySummary() {
    if (!aiData) return
    const text = [
      `AI Summary Report`,
      `Survey Scope: ${aiData.scopeLabel}`,
      `Date Range: ${aiData.dataWindow}`,
      `Focus: ${formatFocusLabel(aiData.focus)}`,
      `Generated: ${new Date(aiData.generatedAt).toLocaleString()}`,
      '',
      `Prompt Used:`,
      lastPromptUsed,
      '',
      aiData.summary,
      '',
      'Key Findings:',
      ...aiData.findings.map(item => `• ${item}`),
      '',
      'Recommended Actions:',
      ...aiData.actions.map(item => `• ${item}`),
      '',
      `Confidence Note: ${aiData.confidenceNote}`,
      ...(aiData.aiFailureReason ? ['', `Groq failure reason: ${aiData.aiFailureReason}`] : []),
    ].join('\n')

    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function exportPdf() {
    if (!aiData) return

    const doc = new jsPDF({ unit: 'pt', format: 'letter' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const margin = 44
    const contentWidth = pageWidth - margin * 2
    let y = margin

    const ensureSpace = (needed = 24) => {
      if (y + needed <= pageHeight - margin) return
      doc.addPage()
      y = margin
    }

    const addTextBlock = (text: string, fontSize = 11, gapAfter = 12, isBold = false) => {
      doc.setFont('helvetica', isBold ? 'bold' : 'normal')
      doc.setFontSize(fontSize)
      const lines = doc.splitTextToSize(text, contentWidth)
      const lineHeight = fontSize * 1.45
      ensureSpace(lines.length * lineHeight + gapAfter)
      doc.text(lines, margin, y)
      y += lines.length * lineHeight + gapAfter
    }

    const addList = (items: string[], bulletColor: [number, number, number], gapAfter = 14) => {
      items.forEach(item => {
        const wrapped = doc.splitTextToSize(item, contentWidth - 18)
        const lineHeight = 16
        ensureSpace(wrapped.length * lineHeight + 8)
        doc.setFillColor(...bulletColor)
        doc.circle(margin + 4, y - 4, 2, 'F')
        doc.setTextColor(30, 41, 59)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(11)
        doc.text(wrapped, margin + 14, y)
        y += wrapped.length * lineHeight + 6
      })
      y += gapAfter
    }

    doc.setTextColor(30, 41, 59)
    addTextBlock('AI Summary Report', 20, 8, true)
    addTextBlock('Data Collection Pro', 11, 18)

    addTextBlock(`Survey Scope: ${aiData.scopeLabel}`, 11, 6, true)
    addTextBlock(`Date Range: ${aiData.dataWindow}`, 11, 6)
    addTextBlock(`Focus: ${formatFocusLabel(aiData.focus)}`, 11, 6)
    addTextBlock(`Prompt Used: ${lastPromptUsed}`, 11, 16)
    addTextBlock(`Generated: ${new Date(aiData.generatedAt).toLocaleString()}`, 10, 18)

    addTextBlock('Summary', 13, 10, true)
    addTextBlock(aiData.summary, 11, 16)

    addTextBlock('Key Findings', 13, 10, true)
    addList(aiData.findings, [139, 92, 246])

    addTextBlock('Recommended Actions', 13, 10, true)
    addList(aiData.actions, [16, 185, 129])

    addTextBlock('Confidence Note', 13, 10, true)
    addTextBlock(aiData.confidenceNote, 11, 16)

    if (aiData.aiFailureReason) {
      addTextBlock('Groq Failure Reason', 13, 10, true)
      addTextBlock(aiData.aiFailureReason, 11, 16)
    }

    const safeScope = aiData.scopeLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'all-surveys'
    doc.save(`ai-summary-${safeScope}.pdf`)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[#1E293B] dark:text-[#F1F5F9]">AI Summary</h1>
          <p className="text-sm text-[#64748B] mt-0.5">Generate, adjust, and export AI summaries for survey results.</p>
        </div>

        <div className="flex items-center gap-1 bg-[#F1F5F9] dark:bg-[#1E293B] p-1 rounded-lg">
          {PRESETS.map(presetOption => (
            <button
              key={presetOption.value}
              type="button"
              onClick={() => setPreset(presetOption.value)}
              className={[
                'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                preset === presetOption.value
                  ? 'bg-white dark:bg-[#334155] text-[#1E293B] dark:text-[#F1F5F9] shadow-sm'
                  : 'text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9]',
              ].join(' ')}
            >
              {presetOption.label}
            </button>
          ))}
        </div>
      </div>

      <section className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E2E8F0] dark:border-[#334155] flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-violet-500" />
            <h2 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Summary Controls</h2>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <select
              value={selectedSurveyId === 'all' ? 'all' : String(selectedSurveyId)}
              onChange={e => setSelectedSurveyId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              disabled={aiLoading}
              className="text-sm border border-[#E2E8F0] dark:border-[#334155] rounded-md px-3 py-2 bg-white dark:bg-[#0F172A] text-[#1E293B] dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
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
              className="text-sm border border-[#E2E8F0] dark:border-[#334155] rounded-md px-3 py-2 bg-white dark:bg-[#0F172A] text-[#1E293B] dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            >
              <option value="general">General overview</option>
              <option value="trend">Submission trends</option>
              <option value="categories">Categories</option>
              <option value="collections">Collections</option>
              <option value="users">User activity</option>
            </select>

            <div className="flex items-center gap-2 justify-start lg:justify-end">
              <button
                type="button"
                onClick={() => setPromptText(DEFAULT_PROMPT_TEXT)}
                disabled={aiLoading}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-[#E2E8F0] dark:border-[#334155] text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9] transition-colors"
              >
                <RotateCcw size={14} />
                Reset Prompt
              </button>
              <button
                type="button"
                onClick={generateSummary}
                disabled={aiLoading}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white transition-colors"
              >
                {aiLoading ? <Loader2 size={14} className="animate-spin" /> : aiData ? <RefreshCw size={14} /> : <Sparkles size={14} />}
                {aiLoading ? 'Generating…' : aiData ? 'Regenerate' : 'Generate Summary'}
              </button>
            </div>
          </div>
        </div>

        <div className="px-4 py-4 space-y-3">
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="text-sm font-medium text-[#1E293B] dark:text-[#F1F5F9]">Prompt Instructions</label>
              <span className="text-xs text-[#94A3B8]">Adjust this before each run to shape the response.</span>
            </div>
            <textarea
              value={promptText}
              onChange={e => setPromptText(e.target.value)}
              rows={6}
              className="w-full border border-[#E2E8F0] dark:border-[#334155] rounded-md px-3 py-2 text-sm bg-white dark:bg-[#0F172A] text-[#1E293B] dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              placeholder={DEFAULT_PROMPT_TEXT}
            />
          </div>

          <div className="rounded-lg bg-[#F8FAFC] dark:bg-[#0F172A]/40 px-3 py-3 text-sm text-[#475569] dark:text-[#CBD5E1]">
            Current scope: <span className="font-medium text-[#1E293B] dark:text-[#F1F5F9]">{selectedSurveyLabel}</span> · {formatFocusLabel(aiFocus)} · {preset === 'all' ? 'All time' : `Last ${preset} days`}
          </div>
        </div>
      </section>

      <section className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-b border-[#E2E8F0] dark:border-[#334155]">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-violet-500" />
            <h2 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9]">AI Result</h2>
            <span className="text-xs text-[#64748B] hidden sm:inline">— Powered by Groq</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {aiData && !aiLoading && (
              <>
                <button
                  type="button"
                  onClick={copySummary}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-[#E2E8F0] dark:border-[#334155] text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9] transition-colors"
                >
                  {copied ? <CheckCheck size={13} className="text-emerald-500" /> : <Copy size={13} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  onClick={exportPdf}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#2563EB] hover:bg-blue-700 text-white transition-colors"
                >
                  <Download size={13} />
                  Export PDF
                </button>
              </>
            )}
          </div>
        </div>

        <div className="px-4 py-4">
          {!aiData && !aiLoading && !aiError && (
            <p className="text-sm text-[#64748B] text-center py-8">
              Generate a summary to review AI results and export them to PDF.
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

              <div className="rounded-lg border border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#0F172A]/40 px-4 py-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[#64748B] mb-2">Prompt Used</h3>
                <p className="text-sm text-[#1E293B] dark:text-[#F1F5F9] whitespace-pre-wrap">{lastPromptUsed}</p>
              </div>

              <p className="text-sm text-[#1E293B] dark:text-[#F1F5F9] leading-relaxed">
                {aiData.summary}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[#F8FAFC] dark:bg-[#0F172A]/40 rounded-lg p-4">
                  <h3 className="text-xs font-semibold text-[#64748B] uppercase tracking-wide mb-2">Key Findings</h3>
                  <ul className="space-y-1.5">
                    {aiData.findings.map((finding, index) => (
                      <li key={index} className="flex items-start gap-2 text-sm text-[#1E293B] dark:text-[#F1F5F9]">
                        <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-violet-500" />
                        {finding}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="bg-[#F8FAFC] dark:bg-[#0F172A]/40 rounded-lg p-4">
                  <h3 className="text-xs font-semibold text-[#64748B] uppercase tracking-wide mb-2">Recommended Actions</h3>
                  <ul className="space-y-1.5">
                    {aiData.actions.map((action, index) => (
                      <li key={index} className="flex items-start gap-2 text-sm text-[#1E293B] dark:text-[#F1F5F9]">
                        <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        {action}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1 border-t border-[#F1F5F9] dark:border-[#334155]">
                <p className="text-xs text-[#94A3B8] flex-1">{aiData.confidenceNote}</p>
                <p className="text-xs text-[#94A3B8] italic">AI-generated summary — verify before decision-making.</p>
              </div>

              {!aiData.usedAi && aiData.aiFailureReason && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                  <span className="font-semibold">Groq failure reason:</span> {aiData.aiFailureReason}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function formatFocusLabel(focus: AiFocusArea): string {
  switch (focus) {
    case 'trend':
      return 'Submission trends'
    case 'categories':
      return 'Categories'
    case 'collections':
      return 'Collections'
    case 'users':
      return 'User activity'
    default:
      return 'General overview'
  }
}