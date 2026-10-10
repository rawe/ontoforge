/**
 * The schema workspace shared by every part of the schema page. The view and
 * the selection are read from the address (`schemaUrl.ts`), never held as
 * state: selecting replaces the address, switching views pushes it, and
 * reload, links and back/forward restore both.
 *
 * The one-shot property request rides on top: it is renewed whenever the
 * address names another property, and when the same property is selected
 * again (the address does not change, the nonce does).
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { findTypeByKey, useModelSchema } from '../modeling/useModelSchema'
import { buildSchemaUrl, parseSchemaUrl, type SchemaView } from './schemaUrl'
import { SchemaWorkspaceContext, type SchemaWorkspace } from './workspaceContext'

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

  const select = useCallback<SchemaWorkspace['select']>(
    (next, options) => {
      if (options?.propertyKey !== undefined) setNonce((n) => n + 1)
      const to = buildSchemaUrl(ontologyKey, view, next, options?.propertyKey ?? null)
      if (to !== here) void navigate(to, { replace: true })
    },
    [navigate, ontologyKey, view, here],
  )

  const switchView = useCallback(
    (next: SchemaView) => {
      if (next !== view) void navigate(buildSchemaUrl(ontologyKey, next, sel, prop))
    },
    [navigate, ontologyKey, view, sel, prop],
  )

  // An unknown key in the graph leaves the address (the classic page shows not-found instead).
  const schema = useModelSchema(ontologyKey)
  const unknown =
    view === 'graph' &&
    sel !== null &&
    !schema.isPending &&
    schema.error === null &&
    findTypeByKey(schema, sel.kind, sel.key) === undefined
  useEffect(() => {
    if (!unknown || sel === null) return
    const kind = sel.kind === 'entity-types' ? 'entity' : 'relation'
    toast.error(`No ${kind} type "${sel.key}"`, { id: 'schema-unknown-selection' })
    void navigate(buildSchemaUrl(ontologyKey, 'graph', null), { replace: true })
  }, [unknown, sel, navigate, ontologyKey])

  const value = useMemo<SchemaWorkspace>(
    () => ({ ontologyKey, view, selection: sel, propertyRequest, select, switchView }),
    [ontologyKey, view, sel, propertyRequest, select, switchView],
  )
  return <SchemaWorkspaceContext.Provider value={value}>{children}</SchemaWorkspaceContext.Provider>
}
