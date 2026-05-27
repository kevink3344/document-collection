import { useEffect, useState } from 'react'
import { FileText, CheckCircle, AlertTriangle, Inbox, TrendingUp } from 'lucide-react'
import { getStats, getTrend, type DashboardStats, type TrendData } from '../api/stats'
import { useAuth } from '../contexts/AuthContext'
import SubmissionTrendChart from '../components/dashboard/SubmissionTrendChart'

export default function DashboardPage() {
  const { user } = useAuth()
  const dashboardTitle = user?.organizationName ? `${user.organizationName} Dashboard` : 'Dashboard'
  const isPrivileged = user?.role === 'administrator' || user?.role === 'team_manager'
  const [loading, setLoading] = useState(true)
  const [kpiStats, setKpiStats] = useState<DashboardStats | null>(null)
  const [trendData, setTrendData] = useState<TrendData | null>(null)

  useEffect(() => {
    if (isPrivileged) {
      Promise.all([
        getStats().then(setKpiStats).catch(() => null),
        getTrend().then(setTrendData).catch(() => null),
      ]).finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-[#64748B]">
        Loading…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[#1E293B] dark:text-[#F1F5F9]">{dashboardTitle}</h1>
        <p className="text-sm text-[#64748B] mt-0.5">Overview of collection activity.</p>
      </div>

      {/* KPI strip — admin & team_manager only */}
      {isPrivileged && kpiStats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            {
              label: 'Open Collections',
              value: kpiStats.openCount,
              icon: <CheckCircle size={16} className="text-green-500" />,
              accent: 'border-green-200 dark:border-green-800',
            },
            {
              label: 'Drafts',
              value: kpiStats.draftCount,
              icon: <FileText size={16} className="text-[#94A3B8]" />,
              accent: 'border-[#E2E8F0] dark:border-[#334155]',
            },
            {
              label: 'Overdue',
              value: kpiStats.overdueCount,
              icon: <AlertTriangle size={16} className={kpiStats.overdueCount > 0 ? 'text-red-500' : 'text-[#94A3B8]'} />,
              accent: kpiStats.overdueCount > 0 ? 'border-red-200 dark:border-red-800' : 'border-[#E2E8F0] dark:border-[#334155]',
            },
            {
              label: 'This Week',
              value: kpiStats.submissionsThisWeek,
              icon: <TrendingUp size={16} className="text-[#2563EB]" />,
              accent: 'border-blue-200 dark:border-blue-800',
            },
            {
              label: 'Total Submissions',
              value: kpiStats.totalSubmissions,
              icon: <Inbox size={16} className="text-[#64748B]" />,
              accent: 'border-[#E2E8F0] dark:border-[#334155]',
            },
          ].map(({ label, value, icon, accent }) => (
            <div
              key={label}
              className={`bg-white dark:bg-[#1E293B] border ${accent} rounded-lg px-4 py-3 flex items-center gap-3`}
            >
              <div className="shrink-0">{icon}</div>
              <div className="min-w-0">
                <p className="text-xl text-[#94A3B8] leading-none">{value}</p>
                <p className="text-xs text-[#64748B] mt-0.5 leading-tight">{label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {trendData && <SubmissionTrendChart data={trendData} />}
    </div>
  )
}
