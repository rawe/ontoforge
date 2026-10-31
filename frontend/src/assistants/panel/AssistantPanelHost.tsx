import { lazy, Suspense, useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useAuthMe, useFeatures } from '@/api/hooks'
import { readJson, storageKeys, writeJson } from '@/lib/storage'
import type { DraftEditor } from '../draft/draftFillModel'
import type { Focus } from '../types'
import { AssistantPanelContext, type AssistantPanel } from './panelContext'
import { clampWidth, focusId, panelSettings, REVIEW_WIDTH, type PanelSettings } from './panelModel'

// The conversation (markdown, steps, every kind's views) loads on the panel's first open.
const PanelChat = lazy(() => import('./PanelChat').then((m) => ({ default: m.PanelChat })))

/**
 * The docked assistant panel of a layout and the context its pages publish
 * into: rendered after `children` (the layout's sidebar and main), so it sits
 * beside the main area and survives route changes; below `lg` it overlays it
 * as a sheet. v1 serves the Studio helper, bound to the whole ontology.
 *
 * Its conversation remounts for another ontology or principal, and the focus
 * is dropped then, so neither a thread nor a focus carries over. Without a
 * language model on the server only `children` render, and the entry
 * points hide. Mounted on first open, then kept while closed, so closing
 * does not cancel a running answer.
 */
export function AssistantPanelHost({ binding, children }: {
  binding: { ontologyKey: string; lensKey: null }
  children: ReactNode
}) {
  const { data: features } = useFeatures()
  const { data: me } = useAuthMe()
  const available = features?.ai === true
  // Whose conversation: the user's id, null without authentication; undefined while unknown or signed out.
  const principal = me === undefined ? undefined : me.authentication ? me.user?.id : null
  const scope = `${binding.ontologyKey}/${principal === undefined ? '?' : principal === null ? '@anonymous' : `user:${principal}`}`

  const [settings, setSettings] = useState(() => panelSettings(readJson(storageKeys.assistantPanel)))
  const [mounted, setMounted] = useState(settings.open)
  const [focus, setFocus] = useState<Focus | null>(null)
  const [focusScope, setFocusScope] = useState(scope)
  if (focusScope !== scope) {
    setFocusScope(scope)
    setFocus(null)
  }

  const save = useCallback((change: (current: PanelSettings) => PanelSettings) => {
    setSettings((current) => {
      const next = change(current)
      writeJson(storageKeys.assistantPanel, next)
      return next
    })
  }, [])
  const setOpen = useCallback((open: boolean) => {
    if (open) setMounted(true)
    save((current) => ({ ...current, open }))
  }, [save])

  // The one open draft editor; read when a message goes out or a card fills it, so it re-renders nothing.
  const draftEditorRef = useRef<DraftEditor | null>(null)
  const publishDraft = useCallback((editor: DraftEditor) => {
    draftEditorRef.current = editor
    return () => {
      if (draftEditorRef.current === editor) draftEditorRef.current = null
    }
  }, [])
  const draftEditor = useCallback(() => draftEditorRef.current, [])

  // How many reviews hold the panel wide; the saved width is left as it is.
  const [wide, setWide] = useState(0)
  const widen = useCallback(() => {
    setWide((n) => n + 1)
    let held = true
    return () => {
      if (held) setWide((n) => n - 1)
      held = false
    }
  }, [])

  // Stable, so a page's published focus is not published again when the panel opens or closes.
  const unpublish = useCallback((gone: Focus) => setFocus((current) => (focusId(current) === focusId(gone) ? null : current)), [])
  const panel = useMemo<AssistantPanel>(() => ({
    available,
    isOpen: available && settings.open,
    open: (options) => {
      if (options?.focus !== undefined) setFocus(options.focus)
      setOpen(true)
    },
    close: () => setOpen(false),
    toggle: () => setOpen(!settings.open),
    publish: setFocus,
    unpublish,
    publishDraft,
    draftEditor,
    widen,
  }), [available, settings.open, setOpen, unpublish, publishDraft, draftEditor, widen])

  return (
    <AssistantPanelContext.Provider value={panel}>
      {children}
      {available && mounted && (
        <DockedPanel
          open={settings.open}
          width={wide > 0 ? Math.max(settings.width, REVIEW_WIDTH) : settings.width}
          onWidth={(width) => save((current) => ({ ...current, width }))}
        >
          <Suspense fallback={null}>
            <PanelChat
              key={scope}
              binding={binding}
              principal={principal}
              focus={focus}
              onRemoveFocus={() => setFocus(null)}
              onClose={() => setOpen(false)}
            />
          </Suspense>
        </DockedPanel>
      )}
    </AssistantPanelContext.Provider>
  )
}

/** The panel's frame: docked on the right with a resize handle on its left edge; hidden while closed. */
function DockedPanel({ open, width, onWidth, children }: {
  open: boolean
  width: number
  onWidth: (width: number) => void
  children: ReactNode
}) {
  // The width while dragging; null shows the saved one.
  const [dragged, setDragged] = useState<number | null>(null)
  const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const start = event.clientX
    let latest = width
    const move = (e: PointerEvent) => {
      latest = clampWidth(width + start - e.clientX)
      setDragged(latest)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragged(null)
      onWidth(latest)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <aside
      aria-label="Assistant panel"
      data-testid="assistant-panel"
      hidden={!open}
      style={{ width: dragged ?? width }}
      className="relative flex h-full max-w-full shrink-0 flex-col border-l bg-background max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:shadow-xl"
    >
      {children}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize"
        onPointerDown={resize}
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize transition-colors hover:bg-primary/20"
      />
    </aside>
  )
}
