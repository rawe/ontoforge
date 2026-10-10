/** Context of `SchemaWorkspaceProvider`: view and selection from the address, and the calls that change them. */

import { createContext, useContext } from 'react'
import type { PropertyDefinition } from '@/api/types'
import type { SchemaSelection, SchemaView } from './schemaUrl'

export interface SelectOptions {
  /** Open, highlight and scroll to this property of the selected type. */
  propertyKey?: string
  /** Pan the graph to the selection, also when it is already selected. */
  reveal?: boolean
}

/** Open, highlight and scroll to a property of the selected type; a new nonce repeats it. */
export interface PropertyRequest {
  propertyKey: string
  nonce: number
}

/** Pan the graph to this selection; a new nonce repeats it. */
export interface RevealRequest {
  selection: SchemaSelection
  nonce: number
}

/** Open the add-property form of this type; a new nonce repeats it. */
export interface AddPropertyRequest {
  selection: SchemaSelection
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
  /** Cleared by the next `select` or view switch. */
  addPropertyRequest: AddPropertyRequest | null
  /** Select a type and open its add-property form. */
  requestAddProperty: (selection: SchemaSelection) => void
  /** Set by `select(…, { reveal: true })`. A changed selection is revealed without it. */
  revealRequest: RevealRequest | null
  /** Graph focus mode: the selection and its one-hop neighbours stay, the rest dims. */
  focusMode: boolean
  /** Turn focus mode on or off; turning it on without a selection shows a hint. */
  toggleFocus: () => void
  exitFocus: () => void
  /** The outline search; the outline filters by it, the graph highlights by it. */
  search: string
  setSearch: (query: string) => void
}

export const SchemaWorkspaceContext = createContext<SchemaWorkspace | null>(null)

export function useSchemaWorkspace(): SchemaWorkspace {
  const workspace = useContext(SchemaWorkspaceContext)
  if (workspace === null) {
    throw new Error('useSchemaWorkspace must be used inside a SchemaWorkspaceProvider')
  }
  return workspace
}

/** The property request as a `PropertiesEditor` open request, once the property is loaded. */
export function openRequestOf(
  request: PropertyRequest | null,
  properties: PropertyDefinition[] | undefined,
): { propertyId: string; nonce: number } | undefined {
  const property =
    request === null ? undefined : properties?.find((p) => p.key === request.propertyKey)
  return property === undefined || request === null
    ? undefined
    : { propertyId: property.propertyId, nonce: request.nonce }
}

/** The add-property request as a `PropertiesEditor` add request, if it is for this type. */
export function addRequestOf(
  request: AddPropertyRequest | null,
  selection: SchemaSelection,
): number | undefined {
  return request !== null &&
    request.selection.kind === selection.kind &&
    request.selection.key === selection.key
    ? request.nonce
    : undefined
}
