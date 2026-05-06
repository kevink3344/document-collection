import { useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import type { ColType, TableColumn } from '../../types'

interface Props {
  columns: TableColumn[]
  onSave: (columns: TableColumn[]) => void
  onClose: () => void
}

const COL_TYPE_LABELS: Record<ColType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  checkbox: 'Checkbox',
  list: 'List',
}

function newColumn(order: number): TableColumn {
  return { name: '', colType: 'text', listOptions: null, sortOrder: order }
}

const INPUT =
  'border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#0F172A] ' +
  'text-[#1E293B] dark:text-[#F1F5F9] px-2.5 py-1.5 text-sm rounded focus:outline-none ' +
  'focus:ring-2 focus:ring-[#2563EB]'

export default function TableWizardModal({ columns, onSave, onClose }: Props) {
  const [cols, setCols] = useState<TableColumn[]>(
    columns.length > 0 ? [...columns] : [newColumn(0)]
  )

  function updateCol(idx: number, patch: Partial<TableColumn>) {
    setCols(prev => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)))
  }

  function addCol() {
    setCols(prev => [...prev, newColumn(prev.length)])
  }

  function removeCol(idx: number) {
    setCols(prev => prev.filter((_, i) => i !== idx).map((c, i) => ({ ...c, sortOrder: i })))
  }

  function handleSave() {
    const valid = cols.filter(c => c.name.trim() !== '')
    onSave(
      valid.map((c, i) => ({
        ...c,
        name: c.name.trim(),
        listOptions:
          c.colType === 'list'
            ? (c.listOptions ?? []).map(opt => opt.trim()).filter(Boolean)
            : null,
        sortOrder: i,
      }))
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-[#1E293B] rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0] dark:border-[#334155]">
          <h2 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9]">
            Table Wizard — Define Columns
          </h2>
          <button
            onClick={onClose}
            className="text-[#94A3B8] hover:text-[#64748B] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Column list */}
        <div className="px-5 py-4 space-y-3 max-h-80 overflow-y-auto">
          {cols.map((col, idx) => (
            <div key={idx} className="space-y-2 rounded border border-[#E2E8F0] dark:border-[#334155] p-2.5">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Column name"
                  value={col.name}
                  onChange={e => updateCol(idx, { name: e.target.value })}
                  className={`${INPUT} flex-1`}
                />
                <select
                  value={col.colType}
                  onChange={e => {
                    const nextType = e.target.value as ColType
                    updateCol(idx, {
                      colType: nextType,
                      listOptions: nextType === 'list' ? (col.listOptions ?? []) : null,
                    })
                  }}
                  className={`${INPUT} w-28`}
                >
                  {(Object.keys(COL_TYPE_LABELS) as ColType[]).map(t => (
                    <option key={t} value={t}>
                      {COL_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => removeCol(idx)}
                  disabled={cols.length === 1}
                  className="text-[#94A3B8] hover:text-red-500 transition-colors disabled:opacity-30"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {col.colType === 'list' && (
                <div>
                  <label className="block text-[11px] text-[#64748B] mb-1">
                    List options (comma-separated)
                  </label>
                  <input
                    type="text"
                    placeholder="New, In Progress, Completed"
                    value={(col.listOptions ?? []).join(', ')}
                    onChange={e =>
                      updateCol(idx, {
                        listOptions: e.target.value
                          .split(',')
                          .map(item => item.trim())
                          .filter(Boolean),
                      })
                    }
                    className={`${INPUT} w-full`}
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Add column */}
        <div className="px-5 pb-4">
          <button
            onClick={addCol}
            className="flex items-center gap-1 text-xs text-[#2563EB] hover:underline"
          >
            <Plus size={13} />
            Add column
          </button>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-[#E2E8F0] dark:border-[#334155]">
          <button
            onClick={onClose}
            className="text-sm text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="bg-[#2563EB] hover:bg-blue-700 text-white text-sm font-medium px-4 py-1.5 rounded transition-colors"
          >
            Save columns
          </button>
        </div>
      </div>
    </div>
  )
}
