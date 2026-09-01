import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { Check, ChevronsUpDown, Settings2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useOntologies } from '@/api/hooks'
import * as model from '@/api/model'
import { qk } from '@/api/queryKeys'
import { Logo } from '@/components/Logo'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { readString, remove, storageKeys } from '@/lib/storage'
import { cn } from '@/lib/utils'

/**
 * Workbench landing for an ontology switch: the ontology's remembered
 * last-used lens if it still exists, otherwise its Studio. A remembered
 * key that no longer resolves is forgotten rather than retried.
 */
async function workbenchTarget(
  queryClient: QueryClient,
  ontologyKey: string,
): Promise<string> {
  const studio = `/o/${ontologyKey}/studio`
  let lensKeys: string[]
  try {
    const lenses = await queryClient.fetchQuery({
      queryKey: qk.lenses(ontologyKey),
      queryFn: () => model.listLenses(ontologyKey),
    })
    lensKeys = lenses.map((l) => l.key)
  } catch {
    return studio
  }
  const remembered = readString(storageKeys.lastLens(ontologyKey))
  if (remembered !== null) {
    if (lensKeys.includes(remembered)) return `/o/${ontologyKey}/w/${remembered}`
    remove(storageKeys.lastLens(ontologyKey))
  }
  return studio
}

/**
 * Ontology switcher — atop the sidebar of both surfaces. Switching keeps
 * the surface: Studio → the other ontology's Studio; Workbench → that
 * ontology's last-used lens, or its Studio if it has none.
 */
export function OntologySwitcher({
  ontologyKey,
  surface,
  collapsed = false,
}: {
  ontologyKey: string
  surface: 'studio' | 'workbench'
  collapsed?: boolean
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: ontologies } = useOntologies()
  const current = ontologies?.find((o) => o.key === ontologyKey)

  const select = (key: string) => {
    if (surface === 'studio') {
      void navigate(`/o/${key}/studio`)
      return
    }
    void workbenchTarget(queryClient, key).then((target) => navigate(target))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'flex h-9 w-full items-center gap-2 rounded-lg px-1.5 text-left',
            'transition-colors duration-100 hover:bg-sidebar-accent/60',
            'focus-visible:outline-2 focus-visible:outline-ring/60',
            collapsed && 'justify-center px-0',
          )}
          aria-label="Switch ontology"
        >
          <Logo className="size-6 shrink-0 rounded-md" />
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold leading-tight">
                  {current?.displayName ?? ontologyKey}
                </span>
                <span className="block truncate font-mono text-[10.5px] leading-tight text-muted-foreground">
                  {ontologyKey}
                </span>
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Ontologies
        </DropdownMenuLabel>
        {(ontologies ?? []).map((o) => (
          <DropdownMenuItem key={o.ontologyId} onSelect={() => select(o.key)} className="gap-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px]">{o.displayName ?? o.key}</span>
              <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
                {o.key}
              </span>
            </span>
            {o.key === ontologyKey && <Check className="size-4 shrink-0" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/')} className="gap-2">
          <Settings2 className="size-4" />
          Manage…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
