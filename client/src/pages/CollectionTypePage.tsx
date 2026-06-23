import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CalendarCheck, ClipboardList, FolderPlus, Sparkles } from 'lucide-react'

export default function CollectionTypePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const templateId = searchParams.get('templateId')

  useEffect(() => {
    if (templateId && /^\d+$/.test(templateId)) {
      navigate(`/collections/new/builder?templateId=${templateId}&type=template`, { replace: true })
    }
  }, [navigate, templateId])

  function handleStartFromScratch() {
    navigate('/collections/new/builder?type=standard')
  }

  function handleUseTemplate() {
    navigate('/collections?openTemplateLibrary=1')
  }

  function handleSignupSheet() {
    navigate('/collections/new/signup-builder')
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="space-y-2">
        <p className="text-sm uppercase tracking-[0.18em] text-[#2563EB] font-semibold">New collection</p>
        <h1 className="text-2xl font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Choose how you want to begin</h1>
        <p className="text-sm text-[#64748B] dark:text-[#94A3B8] max-w-2xl">
          Pick a starting path for your collection. You can begin with a blank form, launch from a template, or create a sign-up sheet.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3 items-start">
        <button
          type="button"
          onClick={handleStartFromScratch}
          className="text-left rounded-2xl border border-[#CBD5E1] dark:border-[#334155] bg-white dark:bg-[#0F172A] p-6 shadow-sm hover:border-[#2563EB] hover:shadow-md transition-all"
        >
          <div className="flex items-center gap-3 text-[#2563EB]">
            <FolderPlus size={18} />
            <span className="text-sm font-semibold uppercase tracking-[0.15em]">Start from scratch</span>
          </div>
          <h2 className="mt-4 text-xl font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Blank collection</h2>
          <p className="mt-2 text-sm text-[#475569] dark:text-[#CBD5E1]">
            Build your collection from the ground up, add fields, set workflow rules, and tailor every detail to your process.
          </p>
        </button>

        <button
          type="button"
          onClick={handleUseTemplate}
          className="text-left rounded-2xl border border-[#CBD5E1] dark:border-[#334155] bg-white dark:bg-[#0F172A] p-6 shadow-sm hover:border-[#2563EB] hover:shadow-md transition-all"
        >
          <div className="flex items-center gap-3 text-[#2563EB]">
            <ClipboardList size={18} />
            <span className="text-sm font-semibold uppercase tracking-[0.15em]">Use a template</span>
          </div>
          <h2 className="mt-4 text-xl font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Template-based collection</h2>
          <p className="mt-2 text-sm text-[#475569] dark:text-[#CBD5E1]">
            Browse available templates and start from a proven structure, then fine-tune it in the builder.
          </p>
          <div className="mt-4 inline-flex items-center gap-2 text-sm text-[#2563EB] font-medium">
            <Sparkles size={14} /> Open the template library
          </div>
        </button>

        <button
          type="button"
          onClick={handleSignupSheet}
          className="text-left rounded-2xl border border-[#CBD5E1] dark:border-[#334155] bg-white dark:bg-[#0F172A] p-6 shadow-sm hover:border-[#2563EB] hover:shadow-md transition-all"
        >
          <div className="flex items-center gap-3 text-[#2563EB]">
            <CalendarCheck size={18} />
            <span className="text-sm font-semibold uppercase tracking-[0.15em]">Sign-up sheet</span>
          </div>
          <h2 className="mt-4 text-xl font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Slot-based sign-up</h2>
          <p className="mt-2 text-sm text-[#475569] dark:text-[#CBD5E1]">
            Create a list of date and time slots that people can sign up for, with configurable capacity per slot.
          </p>
        </button>
      </div>
    </div>
  )
}
