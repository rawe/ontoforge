import { useQueries } from '@tanstack/react-query'
import { EyeOff, Layers, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { runtimeSchemaQuery, useLenses } from '@/api/hooks'
import { STUDIO_ICON } from '@/components/layout/surfaceTargets'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * An entity type the current lens does not show — reached from the Studio's
 * switch or by address. Offers the ontology's other lenses that show it,
 * and the lens's scope in the Studio.
 */
export function TypeNotInLens({
  ontologyKey,
  lensKey,
  typeKey,
  onDismiss,
  className,
}: {
  ontologyKey: string
  lensKey: string
  typeKey: string
  onDismiss?: () => void
  className?: string
}) {
  const { data: lenses } = useLenses(ontologyKey)
  const others = (lenses ?? []).filter((l) => l.key !== lensKey)
  const schemas = useQueries({
    queries: others.map((l) => runtimeSchemaQuery(ontologyKey, l.key)),
  })
  const showing = others.filter((_, i) =>
    schemas[i]?.data?.entityTypes.some((t) => t.key === typeKey),
  )
  const typeName =
    schemas
      .flatMap((s) => s.data?.entityTypes ?? [])
      .find((t) => t.key === typeKey)?.displayName ?? typeKey
  const lens = lenses?.find((l) => l.key === lensKey)
  const loaded = lenses !== undefined && schemas.every((s) => !s.isPending)

  return (
    <div className={cn('flex items-start gap-3 rounded-lg border bg-muted/30 p-3', className)}>
      <EyeOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-[13px]">
          <span className="font-medium">{typeName}</span> is not part of lens{' '}
          <span className="font-medium">{lens?.name ?? lensKey}</span>.
          {loaded && showing.length === 0 && (
            <span className="text-muted-foreground"> No lens of this ontology shows it.</span>
          )}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {showing.map((l) => (
            <Button key={l.lensId} asChild size="sm" variant="outline">
              <Link to={`/o/${ontologyKey}/w/${l.key}/t/${encodeURIComponent(typeKey)}`}>
                <Layers className="size-3.5" /> Open in {l.name}
              </Link>
            </Button>
          ))}
          {lens !== undefined && (
            <Button asChild size="sm" variant="ghost">
              <Link to={`/o/${ontologyKey}/studio/lenses/${lens.lensId}`}>
                <STUDIO_ICON className="size-3.5" /> Edit scope in Studio
              </Link>
            </Button>
          )}
        </div>
      </div>
      {onDismiss !== undefined && (
        <Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={onDismiss}>
          <X className="size-4" />
        </Button>
      )}
    </div>
  )
}
