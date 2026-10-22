import { cn } from '@/lib/utils'
import { ANCHOR_CAPTIONS, EXAMPLE, type EntityState, type StoryStep } from './rulesetExplainerStory'

const BOX = { width: 112, height: 40 }
const PAD = 12

type Entity = (typeof EXAMPLE.entities)[number]
const ENTITIES = new Map<string, Entity>(EXAMPLE.entities.map((entity) => [entity.id, entity]))
const SUBTREE = new Set<string>(EXAMPLE.subtree)
const FREE = new Set<string>(EXAMPLE.free)

const ENTITY_CLASS: Record<EntityState, { box: string; text: string }> = {
  idle: { box: 'fill-card stroke-border', text: 'fill-foreground/80' },
  covered: { box: 'fill-primary/6 stroke-primary/45', text: 'fill-foreground' },
  anchor: { box: 'fill-primary stroke-primary', text: 'fill-primary-foreground font-semibold' },
  deleted: { box: 'fill-destructive/10 stroke-destructive', text: 'fill-destructive font-semibold' },
  written: { box: 'fill-primary/20 stroke-primary', text: 'fill-foreground font-semibold' },
  staged: { box: 'fill-primary/6 stroke-primary', text: 'fill-foreground' },
  refused: { box: 'fill-destructive/10 stroke-destructive', text: 'fill-foreground' },
}

/**
 * The example hierarchy at one step, by the step's anchor: no anchor, no frame; an anchor,
 * the project Apollo solid and its subtree framed; a deleted anchor, both dashed red. The
 * free type stands apart once there is an anchor; the step's writes show as written,
 * staged or refused.
 */
export function RulesetExplainerTree({ step }: { step: StoryStep }) {
  const mode = step.anchor
  const state = (key: string): EntityState => {
    const own = step.entities[key]
    if (own) return own
    if (mode === 'found') return key === EXAMPLE.anchor ? 'anchor' : SUBTREE.has(key) ? 'covered' : 'idle'
    if (mode === 'deleted' && key === EXAMPLE.anchor) return 'deleted'
    return 'idle'
  }
  const boxes = EXAMPLE.subtree.map((key) => ENTITIES.get(key)!)
  const frame = {
    x1: Math.min(...boxes.map((b) => b.x)) - BOX.width / 2 - PAD,
    x2: Math.max(...boxes.map((b) => b.x)) + BOX.width / 2 + PAD,
    y1: Math.min(...boxes.map((b) => b.y)) - BOX.height / 2 - PAD,
    y2: Math.max(...boxes.map((b) => b.y)) + BOX.height / 2 + PAD,
  }
  const deleted = mode === 'deleted'

  return <svg viewBox={`0 0 ${EXAMPLE.view.width} ${EXAMPLE.view.height}`} className="block h-auto w-full" role="img"
    aria-label={`Example: a customer with two projects and their tasks, and a person. ${ANCHOR_CAPTIONS[mode]}. ${step.title}.`}>
    {mode !== 'none' && <g>
      <rect x={frame.x1} y={frame.y1} width={frame.x2 - frame.x1} height={frame.y2 - frame.y1} rx={12}
        className={deleted ? 'fill-destructive/4 stroke-destructive/60' : 'fill-primary/4 stroke-primary/50'} strokeDasharray="5 4" strokeWidth={1.25} />
      <text x={frame.x1 + 8} y={frame.y1 - 6} className={cn('text-[11px] font-medium', deleted ? 'fill-destructive' : 'fill-primary')}>subtree</text>
    </g>}

    {EXAMPLE.links.map(([from, to]) => {
      const a = ENTITIES.get(from)!
      const b = ENTITIES.get(to)!
      return <path key={`${from}-${to}`} d={`M ${a.x} ${a.y + BOX.height / 2} L ${b.x} ${b.y - BOX.height / 2}`}
        className="stroke-muted-foreground/40" strokeWidth={1.25} fill="none" />
    })}

    {EXAMPLE.entities.map((entity) => {
      const s = state(entity.id)
      const badge = step.badges?.[entity.id] ?? (s === 'deleted' ? 'deleted' : undefined)
      const bad = badge === 'refused' || badge === 'deleted'
      const left = entity.x - BOX.width / 2
      const top = entity.y - BOX.height / 2
      const free = mode !== 'none' && FREE.has(entity.id)
      return <g key={entity.id}>
        <rect x={left} y={top} width={BOX.width} height={BOX.height} rx={8} strokeWidth={s === 'idle' || s === 'covered' ? 1 : 1.5}
          strokeDasharray={s === 'staged' || s === 'deleted' || (free && s === 'idle') ? '4 3' : undefined}
          className={cn('transition-[fill,stroke] duration-500', ENTITY_CLASS[s].box)} />
        <text x={entity.x} y={entity.y - 2} textAnchor="middle" className={cn('text-[13px] transition-[fill] duration-500', ENTITY_CLASS[s].text)}>{entity.label}</text>
        <text x={entity.x} y={entity.y + 12} textAnchor="middle"
          className={cn('text-[10px]', s === 'anchor' ? 'fill-primary-foreground/80' : 'fill-muted-foreground')}>{free ? `${entity.type} · free` : entity.type}</text>
        {badge && <g>
          <rect x={left + BOX.width - badge.length * 6.4 - 4} y={top - 16} width={badge.length * 6.4 + 14} height={18} rx={9}
            className={bad ? 'fill-popover stroke-destructive' : 'fill-popover stroke-primary'} strokeWidth={1.25} />
          <text x={left + BOX.width - badge.length * 6.4 - 4 + (badge.length * 6.4 + 14) / 2} y={top - 3} textAnchor="middle"
            className={cn('text-[10.5px] font-semibold', bad ? 'fill-destructive' : 'fill-primary')}>{badge}</text>
        </g>}
      </g>
    })}
  </svg>
}
