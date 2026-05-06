import { BarChart3 } from 'lucide-react'

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Reports</h1>
        <p className="text-sm text-[#64748B] mt-0.5">Insights and exports for your collections.</p>
      </div>

      <section className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg p-10 text-center">
        <BarChart3 size={40} className="mx-auto mb-3 text-[#CBD5E1]" />
        <p className="text-sm text-[#64748B]">Coming soon</p>
      </section>
    </div>
  )
}