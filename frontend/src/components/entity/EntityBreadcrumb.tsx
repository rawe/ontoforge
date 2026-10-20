import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import type { PathStep } from '@/api/types'
import { stepLabel } from '@/components/entity/hierarchy'

interface EntityBreadcrumbProps {
  ontologyKey: string
  lensKey: string
  /** Root → … → the entity, from the path read. */
  path: readonly PathStep[]
}

/**
 * The entity's place in its hierarchy, above the title: the ancestors as
 * violet links, then the entity itself, muted. Nothing for a root, or for an
 * entity whose ancestors the lens hides.
 */
export function EntityBreadcrumb({ ontologyKey, lensKey, path }: EntityBreadcrumbProps) {
  if (path.length < 2) return null
  const ancestors = path.slice(0, -1)
  const self = path[path.length - 1]!
  return (
    <nav aria-label="Path" className="mb-1 flex flex-wrap items-center gap-1 text-[12px]">
      {ancestors.map((step) => (
        <Fragment key={step.id}>
          <Link
            to={`/o/${ontologyKey}/w/${lensKey}/e/${step.type}/${step.id}`}
            className="max-w-48 truncate font-medium text-(--tc-violet) hover:underline focus-visible:outline-2 focus-visible:outline-ring/60"
          >
            {stepLabel(step)}
          </Link>
          <span className="text-muted-foreground" aria-hidden>
            ›
          </span>
        </Fragment>
      ))}
      <span aria-current="page" className="max-w-48 truncate text-muted-foreground">
        {stepLabel(self)}
      </span>
    </nav>
  )
}
