import type { Binding } from '../types'

/** The lens of a lens-bound kind's binding. */
export function lensOf(at: Binding): string {
  if (at.lensKey === null) throw new Error('This assistant kind answers in a lens.')
  return at.lensKey
}
