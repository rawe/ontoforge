import { useState } from 'react'
import { readString, storageKeys, writeString } from '@/lib/storage'

/** The Workbench chat's "Show diagnostics" setting: one remembered choice for every kind, off by default. */
export function useDiagnosticsSetting(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => readString(storageKeys.chatDiagnostics) === 'true')
  return [on, (next) => {
    setOn(next)
    writeString(storageKeys.chatDiagnostics, String(next))
  }]
}
