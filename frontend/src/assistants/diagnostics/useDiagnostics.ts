import { useState } from 'react'
import { readString, storageKeys, writeString } from '@/lib/storage'

/**
 * `toggle`: the chat's "Show diagnostics" switch decides (the Workbench);
 * `always`: every answer asks for them, without a switch (the Studio test
 * panels).
 */
export type DiagnosticsMode = 'toggle' | 'always'

/**
 * The one place that decides whether a chat shows diagnostics: `allowed`
 * (who may see them — everyone today), `on` (asked and shown) and the
 * switch's setter. The switch is one remembered setting for every kind,
 * off by default.
 */
export function useDiagnostics(mode: DiagnosticsMode): { allowed: boolean; on: boolean; setOn: (on: boolean) => void } {
  const allowed = true
  const [stored, setStored] = useState(() => readString(storageKeys.chatDiagnostics) === 'true')
  return {
    allowed,
    on: allowed && (mode === 'always' || stored),
    setOn: (next) => {
      setStored(next)
      writeString(storageKeys.chatDiagnostics, String(next))
    },
  }
}
