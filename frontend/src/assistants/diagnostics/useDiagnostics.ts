import { useState, type Dispatch, type SetStateAction } from 'react'
import { readString, storageKeys, writeString } from '@/lib/storage'

/**
 * How diagnostics run in a chat. `toggle`: its "Show diagnostics" switch
 * decides (the Workbench); `always`: every answer asks for them, without a
 * switch (the Studio test panels). A surface that never shows diagnostics
 * does not use this module.
 */
export type DiagnosticsMode = 'toggle' | 'always'

/** The diagnostics drawer and the answer it shows; `id: null` follows the latest answer with diagnostics. */
export interface DrawerState { open: boolean; id: string | null }

/** One chat's diagnostics. Its shell reads and calls what is listed first; `view` is for this module's components. */
export interface DiagnosticsControl {
  /** Asked and shown: the chat sends each question with `diagnostics: true`. */
  readonly on: boolean
  /** The chat has the "Show diagnostics" switch. */
  readonly hasSwitch: boolean
  /** A new question was sent: an open drawer moves to its answer. */
  readonly follow: () => void
  /** The conversation was replaced: the drawer closes. */
  readonly reset: () => void
  readonly view: {
    setOn: (on: boolean) => void
    drawer: DrawerState
    setDrawer: Dispatch<SetStateAction<DrawerState>>
  }
}

const CLOSED: DrawerState = { open: false, id: null }

/**
 * The diagnostics of one chat, and the one place that decides whether a
 * chat shows them: who may see them (everyone today), and whether they are
 * on — always, or by the switch, which is one remembered setting for every
 * chat, off by default.
 */
export function useDiagnostics(mode: DiagnosticsMode): DiagnosticsControl {
  const allowed = true
  const [stored, setStored] = useState(() => readString(storageKeys.chatDiagnostics) === 'true')
  const [drawer, setDrawer] = useState<DrawerState>(CLOSED)
  return {
    on: allowed && (mode === 'always' || stored),
    hasSwitch: allowed && mode === 'toggle',
    follow: () => setDrawer((current) => (current.open ? { open: true, id: null } : current)),
    reset: () => setDrawer(CLOSED),
    view: {
      setOn: (next) => {
        setStored(next)
        writeString(storageKeys.chatDiagnostics, String(next))
        if (!next) setDrawer(CLOSED)
      },
      drawer,
      setDrawer,
    },
  }
}
