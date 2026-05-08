import { useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'

interface MatrixConfig {
  rows: string[]
  columns: string[]
}

interface Props {
  config: MatrixConfig | null
  onSave: (config: MatrixConfig) => void
  onClose: () => void
}

const INPUT =
  'border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#0F172A] ' +
  'text-[#1E293B] dark:text-[#F1F5F9] px-2.5 py-1.5 text-sm rounded focus:outline-none ' +
  'focus:ring-2 focus:ring-[#2563EB]'

export default function MatrixLikertConfigModal({ config, onSave, onClose }: Props) {
  const defaultConfig: MatrixConfig = {
    rows: ['Better working hours', 'Better base salary', 'Better benefits package', 'Promotion from current position'],
    columns: ['Major factor', 'Moderate factor', 'Minor factor', 'Not a factor at all'],
  }

  const [rows, setRows] = useState<string[]>(config?.rows && config.rows.length > 0 ? [...config.rows] : [...defaultConfig.rows])
  const [columns, setColumns] = useState<string[]>(config?.columns && config.columns.length > 0 ? [...config.columns] : [...defaultConfig.columns])

  function updateRow(idx: number, val: string) {
    setRows(prev => prev.map((r, i) => (i === idx ? val : r)))
  }

  function addRow() {
    setRows(prev => [...prev, ''])
  }

  function removeRow(idx: number) {
    setRows(prev => prev.filter((_, i) => i !== idx))
  }

  function updateColumn(idx: number, val: string) {
    setColumns(prev => prev.map((c, i) => (i === idx ? val : c)))
  }

  function addColumn() {
    setColumns(prev => [...prev, ''])
  }

  function removeColumn(idx: number) {
    setColumns(prev => prev.filter((_, i) => i !== idx))
  }

  function handleSave() {
    const validRows = rows.filter(r => r.trim() !== '').map(r => r.trim())
    const validColumns = columns.filter(c => c.trim() !== '').map(c => c.trim())

    if (validRows.length === 0 || validColumns.length === 0) {
      alert('Please add at least one row and one column.')
      return
    }

    onSave({ rows: validRows, columns: validColumns })
  }

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-[#1E293B] rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#334155] p-5">
          <h2 className="text-lg font-semibold text-[#1E293B] dark:text-[#F1F5F9]">
            Configure Matrix Likert Scale
          </h2>
          <button
            onClick={onClose}
            className="text-[#94A3B8] hover:text-[#1E293B] dark:hover:text-[#F1F5F9] transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Rows section */}
          <div>
            <h3 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9] mb-3">
              Rows (Left side labels)
            </h3>
            <div className="space-y-2">
              {rows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder={`Row ${i + 1}`}
                    value={row}
                    onChange={e => updateRow(i, e.target.value)}
                    className={`${INPUT} flex-1`}
                  />
                  <button
                    onClick={() => removeRow(i)}
                    className="text-[#94A3B8] hover:text-red-500 transition-colors shrink-0"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <button
                onClick={addRow}
                className="flex items-center gap-1.5 text-xs text-[#2563EB] hover:underline mt-2"
              >
                <Plus size={12} />
                Add row
              </button>
            </div>
          </div>

          {/* Columns section */}
          <div>
            <h3 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9] mb-3">
              Columns (Top header labels)
            </h3>
            <div className="space-y-2">
              {columns.map((col, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder={`Column ${i + 1}`}
                    value={col}
                    onChange={e => updateColumn(i, e.target.value)}
                    className={`${INPUT} flex-1`}
                  />
                  <button
                    onClick={() => removeColumn(i)}
                    className="text-[#94A3B8] hover:text-red-500 transition-colors shrink-0"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <button
                onClick={addColumn}
                className="flex items-center gap-1.5 text-xs text-[#2563EB] hover:underline mt-2"
              >
                <Plus size={12} />
                Add column
              </button>
            </div>
          </div>

          {/* Preview */}
          <div>
            <h3 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9] mb-3">
              Preview
            </h3>
            <div className="overflow-x-auto">
              <table className="border-collapse border border-[#CBD5E1] dark:border-[#334155] text-xs">
                <thead>
                  <tr>
                    <th className="border border-[#CBD5E1] dark:border-[#334155] bg-[#F1F5F9] dark:bg-[#0F172A] p-2 text-left font-semibold" />
                    {columns.map((col, i) => (
                      <th
                        key={i}
                        className="border border-[#CBD5E1] dark:border-[#334155] bg-[#F1F5F9] dark:bg-[#0F172A] p-2 text-left font-semibold max-w-xs text-[#1E293B] dark:text-[#F1F5F9]"
                      >
                        {col || `Col ${i + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i}>
                      <td className="border border-[#CBD5E1] dark:border-[#334155] bg-[#F1F5F9] dark:bg-[#0F172A] p-2 font-semibold text-[#1E293B] dark:text-[#F1F5F9]">
                        {row || `Row ${i + 1}`}
                      </td>
                      {columns.map((_, j) => (
                        <td
                          key={j}
                          className="border border-[#CBD5E1] dark:border-[#334155] p-2 text-center"
                        >
                          ◯
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[#E2E8F0] dark:border-[#334155] p-5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm font-medium bg-[#2563EB] hover:bg-blue-700 text-white rounded transition-colors"
          >
            Save Matrix
          </button>
        </div>
      </div>
    </div>
  )
}
