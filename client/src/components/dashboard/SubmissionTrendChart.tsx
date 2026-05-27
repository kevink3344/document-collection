import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { TrendData } from '../../api/stats'

// Hex palette keyed by the same hash used in categoryColors.ts
const HEX_PALETTE = [
  '#f43f5e', // rose
  '#f59e0b', // amber
  '#10b981', // emerald
  '#0ea5e9', // sky
  '#8b5cf6', // violet
  '#d946ef', // fuchsia
  '#06b6d4', // cyan
  '#84cc16', // lime
]

function hashCategory(name: string): number {
  return Array.from(name).reduce((total, char) => total + char.charCodeAt(0), 0)
}

function categoryColor(category: string): string {
  return HEX_PALETTE[hashCategory(category) % HEX_PALETTE.length]
}

interface Props {
  data: TrendData
}

export default function SubmissionTrendChart({ data }: Props) {
  const { dates, series } = data

  // Build recharts row objects: [{ date: '05-06', CategoryA: 2, CategoryB: 5 }, ...]
  const chartData = dates.map((isoDate, i) => {
    const label = isoDate.slice(5) // "YYYY-MM-DD" → "MM-DD"
    const row: Record<string, string | number> = { date: label }
    for (const s of series) {
      row[s.category] = s.data[i]
    }
    return row
  })

  return (
    <div className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg p-5">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9]">
          Submission Trend by Category
        </h2>
        <p className="text-xs text-[#64748B] mt-0.5">Daily submission volume over the last 21 days.</p>
      </div>

      {series.length === 0 ? (
        <div className="flex items-center justify-center h-40 text-sm text-[#94A3B8]">
          No submissions in the last 21 days.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chartData} margin={{ top: 4, right: 16, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-grid, #E2E8F0)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: '#64748B' }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#64748B' }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                fontSize: 12,
                borderRadius: 6,
                border: '1px solid #E2E8F0',
                backgroundColor: 'white',
                color: '#1E293B',
              }}
              labelFormatter={(label: string) => `Date: ${label}`}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
              iconType="circle"
              iconSize={8}
            />
            {series.map(s => (
              <Line
                key={s.category}
                type="monotone"
                dataKey={s.category}
                stroke={categoryColor(s.category)}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
