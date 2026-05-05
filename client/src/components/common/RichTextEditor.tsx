import { useEffect, useRef } from 'react'
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Undo2,
  Redo2,
} from 'lucide-react'

interface RichTextEditorProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minHeightClassName?: string
}

function ToolbarButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      className="p-1.5 rounded border border-[#E2E8F0] dark:border-[#334155] text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]"
    >
      {children}
    </button>
  )
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeightClassName = 'min-h-[120px]',
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    if (el.innerHTML !== value) {
      el.innerHTML = value || ''
    }
  }, [value])

  function exec(command: string, commandValue?: string) {
    const el = editorRef.current
    if (!el) return
    el.focus()
    document.execCommand(command, false, commandValue)
    onChange(el.innerHTML)
  }

  return (
    <div className="border border-[#E2E8F0] dark:border-[#334155] rounded overflow-hidden bg-white dark:bg-[#0F172A]">
      <div className="flex items-center gap-1 p-2 border-b border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#111827]">
        <ToolbarButton title="Bold" onClick={() => exec('bold')}>
          <Bold size={14} />
        </ToolbarButton>
        <ToolbarButton title="Italic" onClick={() => exec('italic')}>
          <Italic size={14} />
        </ToolbarButton>
        <ToolbarButton title="Underline" onClick={() => exec('underline')}>
          <Underline size={14} />
        </ToolbarButton>
        <ToolbarButton title="Bulleted list" onClick={() => exec('insertUnorderedList')}>
          <List size={14} />
        </ToolbarButton>
        <ToolbarButton title="Numbered list" onClick={() => exec('insertOrderedList')}>
          <ListOrdered size={14} />
        </ToolbarButton>
        <ToolbarButton title="Undo" onClick={() => exec('undo')}>
          <Undo2 size={14} />
        </ToolbarButton>
        <ToolbarButton title="Redo" onClick={() => exec('redo')}>
          <Redo2 size={14} />
        </ToolbarButton>
        <label
          title="Text color"
          className="ml-1 inline-flex items-center gap-1 text-xs text-[#64748B]"
        >
          Color
          <input
            type="color"
            defaultValue="#1e293b"
            onChange={e => exec('foreColor', e.target.value)}
            className="w-6 h-6 p-0 border border-[#E2E8F0] dark:border-[#334155] rounded bg-transparent"
          />
        </label>
      </div>

      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={e => onChange((e.currentTarget as HTMLDivElement).innerHTML)}
        data-placeholder={placeholder ?? 'Type here...'}
        className={[
          'px-3 py-2 text-sm text-[#1E293B] dark:text-[#F1F5F9] focus:outline-none',
          minHeightClassName,
          'empty:before:content-[attr(data-placeholder)] empty:before:text-[#94A3B8] empty:before:pointer-events-none',
        ].join(' ')}
      />
    </div>
  )
}
