import { useQueries, type QueryClient } from '@tanstack/react-query'
import { Database, PencilRuler } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { lensScopeQuery, useLenses, useRuntimeSchema } from '@/api/hooks'
import * as model from '@/api/model'
import { qk } from '@/api/queryKeys'
import type { Lens } from '@/api/types'
import { useAccess } from '@/components/auth/useAccess'
import { readString, remove, storageKeys } from '@/lib/storage'
import {
  pickLens,
  studioContext,
  studioTarget,
  workbenchLensPage,
} from './surfaceSwitch'

/** Icons that name the two surfaces everywhere they are linked. */
export const STUDIO_ICON = PencilRuler
export const WORKBENCH_ICON = Database

/** Router state of a Workbench Home reached for a type its lens does not show. */
export interface OutOfScopeState {
  outOfScope: string
}

export interface Target {
  to: string
  state?: OutOfScopeState
  /** Where the switch leads, in words. */
  hint: string
  /** The ontology has no lens: the target is the Studio's lens list instead. */
  unavailable?: boolean
}

/**
 * The lens the Workbench opens when the address names none (see `pickLens`);
 * null while the lenses, or the scopes that decide between them, still load.
 * Only lenses the user may read count.
 */
export function useTargetLens(ontologyKey: string): { lenses: Lens[] | undefined; lens: Lens | null } {
  const access = useAccess()
  const { data: all } = useLenses(ontologyKey)
  const lenses = all?.filter((l) => access.canRead(ontologyKey, l.key))
  const remembered = readString(storageKeys.lastLens(ontologyKey))
  const rememberedValid = lenses?.some((l) => l.key === remembered) ?? false
  // Scopes are only needed to find an unscoped lens when none is remembered.
  const scopes = useQueries({
    queries: (rememberedValid ? [] : (lenses ?? [])).map((l) =>
      lensScopeQuery(ontologyKey, l.lensId),
    ),
  })
  if (lenses === undefined || scopes.some((q) => q.isPending)) return { lenses, lens: null }
  const unscoped = new Set(
    lenses.filter((_, i) => scopes[i]?.data?.scoped === false).map((l) => l.key),
  )
  return { lenses, lens: pickLens(lenses, remembered, unscoped) }
}

/**
 * Where the Studio's switch to the Workbench leads from the current address;
 * null until that is known.
 */
export function useWorkbenchTarget(ontologyKey: string): Target | null {
  const { pathname, search } = useLocation()
  const { lenses, lens: picked } = useTargetLens(ontologyKey)
  const { data: all } = useLenses(ontologyKey)
  const context = studioContext(pathname, search)
  const lens =
    context.kind === 'lens' ? (lenses?.find((l) => l.lensId === context.lensId) ?? picked) : picked
  // Only a selected entity type needs the lens's schema: is the type in its scope?
  const schema = useRuntimeSchema(ontologyKey, context.kind === 'type' ? lens?.key : undefined)

  if (lenses !== undefined && lenses.length === 0) {
    return {
      to: `/o/${ontologyKey}/studio/lenses`,
      hint:
        all !== undefined && all.length > 0
          ? 'No lens assigned to you — opens the lens list'
          : 'No lens yet — create one to use the Workbench',
      unavailable: true,
    }
  }
  if (lens === null) return null

  if (context.kind === 'lens' && lens.lensId === context.lensId) {
    return {
      to: workbenchLensPage(ontologyKey, lens.key, context.tab),
      hint: `Opens lens ${lens.name}`,
    }
  }
  if (context.kind === 'type') {
    const type = schema.data?.entityTypes.find((t) => t.key === context.typeKey)
    if (schema.data !== undefined && type === undefined) {
      return {
        to: `/o/${ontologyKey}/w/${lens.key}`,
        state: { outOfScope: context.typeKey },
        hint: `${context.typeKey} is not in lens ${lens.name} — opens the lens`,
      }
    }
    return {
      to: `/o/${ontologyKey}/w/${lens.key}/t/${encodeURIComponent(context.typeKey)}`,
      hint: `Opens ${type?.displayName ?? context.typeKey} in lens ${lens.name}`,
    }
  }
  return { to: `/o/${ontologyKey}/w/${lens.key}`, hint: `Opens lens ${lens.name}` }
}

/** Where the Workbench's switch to the Studio leads from the current address. */
export function useStudioTarget(ontologyKey: string, lensKey: string): Target {
  const { pathname, search } = useLocation()
  const { data: lenses } = useLenses(ontologyKey)
  const schema = useRuntimeSchema(ontologyKey, lensKey)
  const lens = lenses?.find((l) => l.key === lensKey)
  const to = studioTarget(ontologyKey, pathname, search, lens?.lensId)
  const [page, typeKey] = pathname.split('/').filter(Boolean).slice(4)
  if ((page === 't' || page === 'e') && typeKey !== undefined) {
    const type = schema.data?.entityTypes.find((t) => t.key === typeKey)
    return { to, hint: `Opens ${type?.displayName ?? typeKey} in the schema` }
  }
  return { to, hint: `Opens lens ${lens?.name ?? lensKey} in the Studio` }
}

/**
 * Workbench landing for an ontology reached without a lens (the ontology
 * switcher): the lens `pickLens` chooses, or the Studio's lens list when the
 * ontology has none. A remembered key that no longer resolves is forgotten.
 */
export async function workbenchLanding(
  queryClient: QueryClient,
  ontologyKey: string,
): Promise<string> {
  const lenses = await queryClient.fetchQuery({
    queryKey: qk.lenses(ontologyKey),
    queryFn: () => model.listLenses(ontologyKey),
  })
  const remembered = readString(storageKeys.lastLens(ontologyKey))
  let unscoped = new Set<string>()
  if (!lenses.some((l) => l.key === remembered)) {
    if (remembered !== null) remove(storageKeys.lastLens(ontologyKey))
    // A scope that fails to load counts as scoped, as in `useTargetLens`.
    const scoped = await Promise.all(
      lenses.map((l) =>
        queryClient
          .fetchQuery(lensScopeQuery(ontologyKey, l.lensId))
          .then((scope) => scope.scoped, () => true),
      ),
    )
    unscoped = new Set(lenses.filter((_, i) => !scoped[i]).map((l) => l.key))
  }
  const lens = pickLens(lenses, remembered, unscoped)
  return lens === null ? `/o/${ontologyKey}/studio/lenses` : `/o/${ontologyKey}/w/${lens.key}`
}
