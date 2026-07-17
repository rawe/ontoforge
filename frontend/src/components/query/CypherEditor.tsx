import { useMemo } from 'react'
import CodeMirror, { EditorView, type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { StreamLanguage } from '@codemirror/language'
import { cypher } from '@codemirror/legacy-modes/mode/cypher'
import { useTheme } from 'next-themes'
import { EXAMPLE_CYPHER } from './snippets'

interface CypherEditorProps {
  value: string
  onChange: (value: string) => void
  /** Cmd/Ctrl+Enter inside the editor. */
  onRun: () => void
  /** Exposes the CodeMirror view for `insertAtCursor` (see `snippets.ts`). */
  editorRef?: React.RefObject<ReactCodeMirrorRef | null>
}

/**
 * Minimal CodeMirror 6 Cypher editor: legacy-mode Cypher highlighting,
 * bracket matching from the basic setup, app-theme aware, mono font.
 * Cmd/Ctrl+Enter is intercepted in the capture phase (before CodeMirror's
 * own keymap) and triggers `onRun`.
 */
export function CypherEditor({ value, onChange, onRun, editorRef }: CypherEditorProps) {
  const { resolvedTheme } = useTheme()

  const extensions = useMemo(
    () => [
      StreamLanguage.define(cypher),
      EditorView.lineWrapping,
      EditorView.theme({
        '&': { fontSize: '13px' },
        '.cm-content': { fontFamily: 'var(--font-mono)', padding: '10px 0' },
        '.cm-gutters': {
          fontFamily: 'var(--font-mono)',
          background: 'transparent',
          border: 'none',
        },
        '&.cm-focused': { outline: 'none' },
      }),
    ],
    [],
  )

  return (
    <div
      className="overflow-hidden rounded-xl border bg-card focus-within:border-ring"
      onKeyDownCapture={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          onRun()
        }
      }}
    >
      <CodeMirror
        ref={editorRef}
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
        placeholder={EXAMPLE_CYPHER}
        minHeight="140px"
        maxHeight="320px"
        autoFocus
        basicSetup={{
          foldGutter: false,
          autocompletion: false,
          searchKeymap: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
        }}
        style={{ background: 'transparent' }}
        aria-label="Cypher editor"
      />
    </div>
  )
}
