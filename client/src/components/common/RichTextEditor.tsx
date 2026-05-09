import { useEffect, useRef, useState } from 'react'
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
  onChange?: (html: string) => void
  placeholder?: string
  minHeightClassName?: string
  readOnly?: boolean
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
  readOnly = false,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const [showHtml, setShowHtml] = useState(false)

  useEffect(() => {
    if (showHtml) return

    const el = editorRef.current
    if (!el) return
    if (el.innerHTML !== value) {
      el.innerHTML = value || ''
    }
  }, [showHtml, value])

  function exec(command: string, commandValue?: string) {
    if (readOnly || !onChange) return
    const el = editorRef.current
    if (!el) return
    el.focus()
    document.execCommand(command, false, commandValue)
    onChange(el.innerHTML)
  }

  if (readOnly) {
    return (
      <div
        className="border border-[#E2E8F0] dark:border-[#334155] rounded overflow-hidden bg-white dark:bg-[#0F172A]"
      >
        <div
          ref={editorRef}
          className={[
            'px-3 py-2 text-sm text-[#1E293B] dark:text-[#F1F5F9] prose dark:prose-invert prose-sm max-w-none',
            minHeightClassName,
          ].join(' ')}
        />
      </div>
    )
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
        <button
          type="button"
          onClick={() => setShowHtml(current => !current)}
          className="ml-auto px-2.5 py-1 text-xs font-medium rounded border border-[#CBD5E1] dark:border-[#334155] text-[#475569] dark:text-[#CBD5E1] hover:bg-[#F1F5F9] dark:hover:bg-[#0F172A]"
        >
          {showHtml ? 'Hide HTML' : 'View HTML'}
        </button>
      </div>

      {showHtml ? (
        <textarea
          value={value}
          onChange={e => onChange?.(e.target.value)}
          spellCheck={false}
          placeholder="Edit HTML source..."
          className={[
            'w-full px-3 py-2 text-sm font-mono text-[#1E293B] dark:text-[#F1F5F9] bg-white dark:bg-[#0F172A] focus:outline-none resize-y',
            minHeightClassName,
          ].join(' ')}
        />
      ) : (
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
      )}
    </div>
  )
}
