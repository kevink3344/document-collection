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

interface FormatState {
  bold: boolean
  italic: boolean
  underline: boolean
  insertUnorderedList: boolean
  insertOrderedList: boolean
}

function ToolbarButton({
  onClick,
  title,
  active = false,
  children,
}: {
  onClick: () => void
  title: string
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      aria-pressed={active}
      className={[
        'p-1.5 rounded border transition-colors',
        active
          ? 'border-[#2563EB] bg-[#DBEAFE] text-[#1D4ED8] dark:border-[#60A5FA] dark:bg-[#1E3A8A] dark:text-[#BFDBFE]'
          : 'border-[#E2E8F0] dark:border-[#334155] text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]',
      ].join(' ')}
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
  const [formatState, setFormatState] = useState<FormatState>({
    bold: false,
    italic: false,
    underline: false,
    insertUnorderedList: false,
    insertOrderedList: false,
  })
  const contentClassName = [
    'px-3 py-2 text-sm text-[#1E293B] dark:text-[#F1F5F9] break-words',
    '[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1',
    minHeightClassName,
  ].join(' ')

  function updateFormatState() {
    const el = editorRef.current
    const selection = window.getSelection()

    if (!el || !selection || selection.rangeCount === 0) {
      setFormatState({
        bold: false,
        italic: false,
        underline: false,
        insertUnorderedList: false,
        insertOrderedList: false,
      })
      return
    }

    const range = selection.getRangeAt(0)
    const withinEditor = el.contains(range.commonAncestorContainer)

    if (!withinEditor) {
      setFormatState({
        bold: false,
        italic: false,
        underline: false,
        insertUnorderedList: false,
        insertOrderedList: false,
      })
      return
    }

    setFormatState({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      insertUnorderedList: document.queryCommandState('insertUnorderedList'),
      insertOrderedList: document.queryCommandState('insertOrderedList'),
    })
  }

  useEffect(() => {
    if (showHtml) return

    const el = editorRef.current
    if (!el) return
    if (el.innerHTML !== value) {
      el.innerHTML = value || ''
    }
  }, [showHtml, value])

  useEffect(() => {
    if (readOnly || showHtml) return

    const handleSelectionChange = () => updateFormatState()

    document.addEventListener('selectionchange', handleSelectionChange)

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [readOnly, showHtml])

  function exec(command: string, commandValue?: string) {
    if (readOnly || !onChange) return
    const el = editorRef.current
    if (!el) return
    el.focus()
    document.execCommand(command, false, commandValue)
    updateFormatState()
    onChange(el.innerHTML)
  }

  if (readOnly) {
    return (
      <div
        className="border border-[#E2E8F0] dark:border-[#334155] rounded overflow-hidden bg-white dark:bg-[#0F172A]"
      >
        <div
          ref={editorRef}
          className={contentClassName}
        />
      </div>
    )
  }

  return (
    <div className="border border-[#E2E8F0] dark:border-[#334155] rounded overflow-hidden bg-white dark:bg-[#0F172A]">
      <div className="flex items-center gap-1 p-2 border-b border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#111827]">
        <ToolbarButton title="Bold" onClick={() => exec('bold')} active={formatState.bold}>
          <Bold size={14} />
        </ToolbarButton>
        <ToolbarButton title="Italic" onClick={() => exec('italic')} active={formatState.italic}>
          <Italic size={14} />
        </ToolbarButton>
        <ToolbarButton title="Underline" onClick={() => exec('underline')} active={formatState.underline}>
          <Underline size={14} />
        </ToolbarButton>
        <ToolbarButton
          title="Bulleted list"
          onClick={() => exec('insertUnorderedList')}
          active={formatState.insertUnorderedList}
        >
          <List size={14} />
        </ToolbarButton>
        <ToolbarButton
          title="Numbered list"
          onClick={() => exec('insertOrderedList')}
          active={formatState.insertOrderedList}
        >
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
          onInput={e => onChange?.((e.currentTarget as HTMLDivElement).innerHTML)}
          data-placeholder={placeholder ?? 'Type here...'}
          className={[
            contentClassName,
            'focus:outline-none',
            'empty:before:content-[attr(data-placeholder)] empty:before:text-[#94A3B8] empty:before:pointer-events-none',
          ].join(' ')}
        />
      )}
    </div>
  )
}
