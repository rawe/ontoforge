/**
 * The CASCADE_REQUIRED flow of the modeling layer, mounted once per page: a
 * modeling write calls `guard(error, retry)` from `useCascadeGuard()`
 * (`cascadeContext.ts`); a cascade conflict opens the shared `CascadeDialog`,
 * which re-runs the write with `cascade=true`. Deletes run their own cascade
 * stage (`DeleteDialog`).
 */

import type { ReactNode } from 'react'
import { CascadeDialog } from '../CascadeDialog'
import { useCascade } from '../useCascade'
import { CascadeContext } from './cascadeContext'

export function CascadeProvider({ children }: { children: ReactNode }) {
  const { cascade, guard, clear } = useCascade()
  return (
    <CascadeContext.Provider value={guard}>
      {children}
      <CascadeDialog cascade={cascade} onClose={clear} />
    </CascadeContext.Provider>
  )
}

