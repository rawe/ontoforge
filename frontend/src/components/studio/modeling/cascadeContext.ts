/** Context of `CascadeProvider`: the guard modeling writes call on an error. */

import { createContext, useContext } from 'react'

export type CascadeGuard = (error: unknown, retry: () => void) => boolean

export const CascadeContext = createContext<CascadeGuard | null>(null)

/** `guard(error, retry)`: true when the error was a cascade conflict and the dialog took over. */
export function useCascadeGuard(): CascadeGuard {
  const guard = useContext(CascadeContext)
  if (guard === null) throw new Error('useCascadeGuard must be used inside a CascadeProvider')
  return guard
}
