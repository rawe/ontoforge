import { useEffect, useRef, type ReactNode } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { EntityCard } from '@/api/entities'
import type { Turn } from '@/components/assistants/chat/chatModel'
import { TypeChip } from '@/components/TypeChip'
import { cn } from '@/lib/utils'
import { groupByRole, roleInfo } from './entityModel'

/** The entity's detail page in the Workbench. */
const entityHref = (ontologyKey: string, lensKey: string, card: EntityCard) =>
  `/o/${ontologyKey}/w/${lensKey}/e/${encodeURIComponent(card.type)}/${encodeURIComponent(card.id)}`

/**
 * The entities an answer met, with how many are evidence: grouped by role
 * when the kind sends roles, else one list in the order they were met.
 * Each card opens the entity's detail page. With `onSelect` a card is
 * selectable (citations and the graph point at it); without, its label is
 * the link. `compact` leaves out the fields and the count line (the
 * Explorer's ask dock); `aside` adds something after each card's label;
 * `onHover` reports the card under the pointer.
 */
export function EntityCardList({ ontologyKey, lensKey, turn, selected = null, onSelect, compact = false, aside, onHover }: {
  ontologyKey: string
  lensKey: string
  turn: Pick<Turn<unknown>, 'entities' | 'status'>
  /** The selected card's ref in this answer, if any. */
  selected?: string | null
  onSelect?: (ref: string) => void
  compact?: boolean
  aside?: (card: EntityCard) => ReactNode
  onHover?: (ref: string | null) => void
}) {
  const { entities } = turn
  if (entities.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {turn.status === 'pending' ? 'The entities appear here as the answer meets them.' : 'This answer met no entities.'}
      </p>
    )
  }
  const evidence = entities.filter((card) => card.evidence).length
  const cardView = (card: EntityCard) => (
    <CardView
      key={card.ref}
      href={entityHref(ontologyKey, lensKey, card)}
      card={card}
      selected={card.ref === selected}
      dimmed={evidence > 0 && !card.evidence}
      onSelect={onSelect}
      compact={compact}
      aside={aside?.(card)}
      onHover={onHover}
    />
  )
  const groups = groupByRole(entities)
  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      {!compact && (
        <p className="text-xs text-muted-foreground">
          {entities.length} {entities.length === 1 ? 'entity' : 'entities'}
          {evidence > 0 && <> · <span className="font-medium text-foreground">{evidence} evidence</span> handed to the answer</>}
        </p>
      )}
      {groups === null
        ? <div className={compact ? 'space-y-1.5' : 'space-y-2'}>{entities.map(cardView)}</div>
        : groups.map(({ role, cards }) => (
            <section key={role} className={compact ? 'space-y-1.5' : 'space-y-2'}>
              <h3 className="flex items-baseline gap-1.5 text-xs font-medium">
                <span aria-hidden className="size-2 shrink-0 translate-y-px rounded-full" style={{ background: roleInfo(role).color }} />
                {roleInfo(role).title}
                <span className="tabular-nums text-muted-foreground">{cards.length}</span>
                {roleInfo(role).hint && <span className={cn('font-normal text-muted-foreground', compact && 'truncate')}>· {roleInfo(role).hint}</span>}
              </h3>
              {cards.map(cardView)}
            </section>
          ))}
    </div>
  )
}

/** One card; selecting it (here, by a citation or in the graph) scrolls it into view. */
function CardView({ card, href, selected, dimmed, onSelect, compact, aside, onHover }: {
  card: EntityCard
  href: string
  selected: boolean
  dimmed: boolean
  onSelect?: (ref: string) => void
  compact: boolean
  aside: ReactNode
  onHover?: (ref: string | null) => void
}) {
  const element = useRef<HTMLElement>(null)
  useEffect(() => {
    if (selected) element.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selected])
  const fields = compact ? [] : card.fields.slice(0, 6)
  const labelClass = 'min-w-0 flex-1 truncate rounded-sm text-left text-[13px] font-medium focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
  return (
    <article
      ref={element}
      onClick={onSelect && (() => onSelect(card.ref))}
      onMouseEnter={onHover && (() => onHover(card.ref))}
      onMouseLeave={onHover && (() => onHover(null))}
      className={cn(
        'rounded-lg border bg-card text-xs transition-[opacity,box-shadow]',
        compact ? 'px-2.5 py-1.5' : 'px-3 py-2',
        compact && onSelect && 'cursor-pointer',
        card.evidence && 'border-l-2 border-l-primary',
        dimmed && !selected && 'opacity-60 hover:opacity-100',
        selected && 'ring-2 ring-ring/60',
      )}
    >
      <div className="flex items-center gap-1.5">
        <TypeChip typeKey={card.type} displayName={card.typeName} size="sm" />
        {onSelect
          ? <button
              type="button"
              aria-pressed={selected}
              onClick={(e) => { e.stopPropagation(); onSelect(card.ref) }}
              className={labelClass}
            >
              {card.label}
            </button>
          : <Link to={href} title="Open the entity" className={cn(labelClass, 'hover:underline')}>{card.label}</Link>}
        {aside}
        <Link
          to={href}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Open ${card.label}`}
          title="Open the entity"
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowUpRight className="size-3.5" />
        </Link>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
        <span className="font-mono">{card.ref}</span>
        {card.hop !== undefined && card.hop > 0 && <span>· {card.hop} {card.hop === 1 ? 'hop' : 'hops'} away</span>}
        {card.evidence && <span className="font-medium text-primary">· Evidence</span>}
      </p>
      {card.reason && <p className={cn('mt-1 text-muted-foreground', compact && 'line-clamp-2')}>{card.reason}</p>}
      {fields.length > 0 && (
        <dl className="mt-1.5 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-2.5 gap-y-0.5 text-[11px]">
          {fields.map((field) => (
            <div key={field.name} className="contents">
              <dt className="max-w-32 truncate text-muted-foreground">{field.name}</dt>
              <dd className="truncate" title={field.value}>{field.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  )
}
