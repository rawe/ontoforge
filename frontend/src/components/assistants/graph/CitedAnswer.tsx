import { useMemo } from 'react'
import type { Components } from 'react-markdown'
import { Markdown } from '@/components/ai/Markdown'
import { getTypeColor } from '@/lib/typeColors'
import { cn } from '@/lib/utils'
import type { EntityCard } from './graphEvents'
import { citations } from './graphTurnModel'

/** The markdown tree, as far as citations need it. */
interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
  data?: Record<string, unknown>
}

/**
 * A remark plugin: each citation in the text becomes a `span` with
 * `data-cite` (rendered as a chip below); code and links stay as written.
 */
function remarkCitations(entities: readonly EntityCard[]) {
  const visit = (node: MdNode) => {
    if (node.children === undefined) return
    node.children = node.children.flatMap((child): MdNode[] => {
      if (child.type === 'link' || child.type === 'linkReference') return [child]
      if (child.type !== 'text' || child.value === undefined) {
        visit(child)
        return [child]
      }
      const segments = citations(child.value, entities)
      if (segments.every((s) => s.kind === 'text')) return [child]
      return segments.map((s) => (s.kind === 'text'
        ? { type: 'text', value: s.text }
        : { type: 'text', value: s.card.label, data: { hName: 'span', hProperties: { dataCite: s.ref } } }))
    })
  }
  return () => (tree: unknown) => visit(tree as MdNode)
}

/** One citation: a compact numbered marker in its type's color — the answer
 * names the entity right before it; the label shows on hover. Selects the
 * card in the sidebar. */
function CitationChip({ card, selected, onSelect, onHover }: {
  card: EntityCard
  selected: boolean
  onSelect: (ref: string) => void
  onHover?: (ref: string | null) => void
}) {
  const color = getTypeColor(card.type)
  return (
    <button
      type="button"
      onClick={() => onSelect(card.ref)}
      onMouseEnter={onHover && (() => onHover(card.ref))}
      onMouseLeave={onHover && (() => onHover(null))}
      aria-pressed={selected}
      aria-label={`Evidence ${card.ref}: ${card.label}, ${card.typeName}`}
      title={`${card.typeName}: ${card.label}`}
      className={cn(
        'mx-px inline-flex h-4 min-w-4 cursor-pointer items-center justify-center gap-0.5 rounded-full border px-1 align-[0.15em] font-mono text-[9.5px] leading-none font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
        selected && 'border-primary bg-primary/15 text-foreground',
      )}
    >
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', color.dot)} />
      {card.ref.slice(1)}
    </button>
  )
}

/**
 * A graph kind's answer: markdown whose `[E2]` / `[E2, E5]` citations of
 * evidence cards are chips; other refs stay plain text.
 */
export function CitedAnswer({ text, entities, selected, onSelect, onHover }: {
  text: string
  entities: readonly EntityCard[]
  /** The selected card's ref in this answer, if any. */
  selected: string | null
  onSelect: (ref: string) => void
  /** The card whose citation is under the pointer, null when none is. */
  onHover?: (ref: string | null) => void
}) {
  const plugins = useMemo(() => [remarkCitations(entities)], [entities])
  const components = useMemo<Components>(() => ({
    span: ({ node, children, ...props }) => {
      const ref = node?.properties?.dataCite
      const card = typeof ref === 'string' ? entities.find((e) => e.ref === ref) : undefined
      if (card === undefined) return <span {...props}>{children}</span>
      return <CitationChip card={card} selected={selected === card.ref} onSelect={onSelect} onHover={onHover} />
    },
  }), [entities, selected, onSelect, onHover])
  // A restored answer has no cards: its citations would only be noise.
  const shown = entities.length === 0 ? text.replace(/ ?\[E\d+(?:\s*,\s*E\d+)*\]/g, '') : text
  return <Markdown plugins={plugins} components={components}>{shown}</Markdown>
}
