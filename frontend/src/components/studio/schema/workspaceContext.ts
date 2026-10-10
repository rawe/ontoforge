/** Context of `SchemaWorkspaceProvider`: view and selection from the address, and the calls that change them. */

import { createContext, useContext } from 'react'
import type { SchemaSelection, SchemaView } from './schemaUrl'

export interface SelectOptions {
  /** Open, highlight and scroll to this property of the selected type. */
  propertyKey?: string
}

/** Open, highlight and scroll to a property of the selected type; a new nonce repeats it. */
export interface PropertyRequest {
  propertyKey: string
  nonce: number
}

export interface SchemaWorkspace {
  ontologyKey: string
  view: SchemaView
  selection: SchemaSelection | null
  /** From the address's `prop`; renewed when it changes or the same property is selected again. */
  propertyRequest: PropertyRequest | null
  /** Select a type (and open one of its properties), or clear the selection. Replaces the address. */
  select: (selection: SchemaSelection | null, options?: SelectOptions) => void
  /** Switch Graph ⇄ Classic, keeping the selection and the property. Pushes the address. */
  switchView: (view: SchemaView) => void
}

export const SchemaWorkspaceContext = createContext<SchemaWorkspace | null>(null)

export function useSchemaWorkspace(): SchemaWorkspace {
  const workspace = useContext(SchemaWorkspaceContext)
  if (workspace === null) {
    throw new Error('useSchemaWorkspace must be used inside a SchemaWorkspaceProvider')
  }
  return workspace
}
