/** Context of `DeleteProvider`: what to delete, and the request that opens the dialog. */

import { createContext, useContext } from 'react'
import type { TypeKind } from './useModelSchema'

export type DeleteTarget =
  | { what: 'type'; kind: TypeKind; id: string }
  | { what: 'property'; kind: TypeKind; typeId: string; propertyId: string }

/** A type of either kind, by id and key. */
export interface TypeRef {
  kind: TypeKind
  id: string
  key: string
}

export type RequestDelete = (target: DeleteTarget) => void

export const DeleteContext = createContext<RequestDelete | null>(null)

/** Opens the delete dialog for a type or a property. */
export function useRequestDelete(): RequestDelete {
  const request = useContext(DeleteContext)
  if (request === null) throw new Error('useRequestDelete must be used inside a DeleteProvider')
  return request
}
