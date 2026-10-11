/**
 * The schema workspace shared by every part of the schema page. The view and
 * the selection are read from the address (`schemaUrl.ts`), never held as
 * state: selecting replaces the address, switching views pushes it, and
 * reload, links and back/forward restore both.
 *
 * The one-shot property request rides on top: it is renewed whenever the
 * address names another property, and when the same property is selected
 * again (the address does not change, the nonce does). The reveal and tidy
 * requests work the same way for the graph. The add-property request is plain
 * state, dropped by the next selection or view switch. Focus mode, the outline
 * search and the command palette are plain state too, per ontology for the
 * session.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { findTypeByKey, useModelSchema } from '../modeling/useModelSchema'
import { buildSchemaUrl, parseSchemaUrl, type SchemaView } from './schemaUrl'
import {
  SchemaWorkspaceContext,
  type AddPropertyRequest,
  type RevealRequest,
  type SchemaWorkspace,
} from './workspaceContext'

interface SchemaWorkspaceProviderProps {
  ontologyKey: string
  children: ReactNode
}

export function SchemaWorkspaceProvider({ ontologyKey, children }: SchemaWorkspaceProviderProps) {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const { view, sel, prop } = useMemo(() => parseSchemaUrl(pathname, search), [pathname, search])
  const here = pathname + search

  // Renew the property request when the address names another property.
  const [nonce, setNonce] = useState(0)
  const propId = sel === null || prop === null ? null : `${sel.kind}:${sel.key}:${prop}`
  const [seenPropId, setSeenPropId] = useState(propId)
  if (propId !== seenPropId) {
    setSeenPropId(propId)
    setNonce((n) => n + 1)
  }
  const propertyRequest = useMemo(
    () => (prop === null ? null : { propertyKey: prop, nonce }),
    [prop, nonce],
  )

  // The address a `select` has already replaced. Until the router has moved
  // on, it is not checked for an unknown key: deleting the selected type drops
  // it from the cache a moment before the cleared selection reaches the address.
  const leaving = useRef<string | null>(null)
  const [addPropertyRequest, setAddPropertyRequest] = useState<AddPropertyRequest | null>(null)
  const addNonce = useRef(0)
  const [revealRequest, setRevealRequest] = useState<RevealRequest | null>(null)
  const [focusMode, setFocusMode] = useState(false)
  const [query, setQuery] = useState('')
  const [tidyRequest, setTidyRequest] = useState(0)
  const requestTidy = useCallback(() => setTidyRequest((n) => n + 1), [])
  const [paletteOpen, setPaletteOpen] = useState(false)

  const select = useCallback<SchemaWorkspace['select']>(
    (next, options) => {
      if (options?.propertyKey !== undefined) setNonce((n) => n + 1)
      if (options?.reveal === true && next !== null) {
        setRevealRequest((r) => ({ selection: next, nonce: (r?.nonce ?? 0) + 1 }))
      }
      setAddPropertyRequest(null)
      const to = buildSchemaUrl(ontologyKey, view, next, options?.propertyKey ?? null)
      if (to === here) return
      leaving.current = here
      void navigate(to, { replace: true })
    },
    [navigate, ontologyKey, view, here],
  )

  const switchView = useCallback(
    (next: SchemaView) => {
      setAddPropertyRequest(null)
      if (next !== view) void navigate(buildSchemaUrl(ontologyKey, next, sel, prop))
    },
    [navigate, ontologyKey, view, sel, prop],
  )

  const requestAddProperty = useCallback<SchemaWorkspace['requestAddProperty']>(
    (selection) => {
      select(selection)
      addNonce.current += 1
      setAddPropertyRequest({ selection, nonce: addNonce.current })
    },
    [select],
  )

  const toggleFocus = useCallback(() => {
    if (!focusMode && sel === null) {
      toast('Select a type first — focus shows it with its one-hop neighbours.', { id: 'schema-focus-hint' })
    }
    setFocusMode((on) => !on)
  }, [focusMode, sel])
  const exitFocus = useCallback(() => setFocusMode(false), [])

  // An unknown key in the graph leaves the address (the classic page shows not-found instead).
  const schema = useModelSchema(ontologyKey)
  const unknown =
    view === 'graph' &&
    sel !== null &&
    !schema.isPending &&
    schema.error === null &&
    findTypeByKey(schema, sel.kind, sel.key) === undefined
  useEffect(() => {
    if (leaving.current !== here) leaving.current = null
    if (!unknown || sel === null || leaving.current !== null) return
    const kind = sel.kind === 'entity-types' ? 'entity' : 'relation'
    toast.error(`No ${kind} type "${sel.key}"`, { id: 'schema-unknown-selection' })
    void navigate(buildSchemaUrl(ontologyKey, 'graph', null), { replace: true })
  }, [unknown, sel, here, navigate, ontologyKey])

  const value = useMemo<SchemaWorkspace>(
    () => ({
      ontologyKey,
      view,
      selection: sel,
      propertyRequest,
      select,
      switchView,
      addPropertyRequest,
      requestAddProperty,
      revealRequest,
      focusMode,
      toggleFocus,
      exitFocus,
      search: query,
      setSearch: setQuery,
      tidyRequest,
      requestTidy,
      paletteOpen,
      setPaletteOpen,
    }),
    [
      ontologyKey,
      view,
      sel,
      propertyRequest,
      select,
      switchView,
      addPropertyRequest,
      requestAddProperty,
      revealRequest,
      focusMode,
      toggleFocus,
      exitFocus,
      query,
      tidyRequest,
      requestTidy,
      paletteOpen,
    ],
  )
  return <SchemaWorkspaceContext.Provider value={value}>{children}</SchemaWorkspaceContext.Provider>
}
