import { useId } from 'react'
import { cn } from '@/lib/utils'
import { EXAMPLE_INDICES, EXAMPLE_QUERY, STORY, type TreeNodeId } from './searchExplainerStory'

const VIEW = { width: 1120, height: 306 }
const LANES = {
  keyword: { top: 10, center: 82, title: 'Keyword', sub: 'the words' },
  semantic: { top: 160, center: 232, title: 'Semantic', sub: 'the meaning' },
} as const
const LANE_HEIGHT = 140
const INDEX = { x: 222, width: 196, height: 24, first: 34, gap: 29 }
const BOX = { width: 168, height: 52 }

/** The boxes and where they sit; lanes hold one search per index. */
const AT = {
  query: { x: 92, y: 157 },
  filter: { x: 92, y: 266 },
  keywordList: { x: 560, y: LANES.keyword.center },
  semanticList: { x: 560, y: LANES.semantic.center },
  fuse: { x: 786, y: 157 },
  results: { x: 1000, y: 157 },
}

const LABELS: Record<Exclude<TreeNodeId, 'keyword' | 'semantic'>, { label: string; sub: string }> = {
  query: { label: 'Your text', sub: `“${EXAMPLE_QUERY}”` },
  filter: { label: 'Filter', sub: 'optional' },
  keywordList: { label: 'Keyword ranking', sub: 'one place per entity' },
  semanticList: { label: 'Semantic ranking', sub: 'one place per entity' },
  fuse: { label: 'Fusion', sub: 'combine by rank' },
  results: { label: 'Results', sub: 'best first, up to the limit' },
}

const indexY = (lane: 'keyword' | 'semantic', i: number) => LANES[lane].top + INDEX.first + i * INDEX.gap

/**
 * The search tree, simplified: the text fans out to one search per index and method, each
 * method's findings become one ranking, fusion combines them, results come out — the
 * current step's boxes ringed and their ways lit; a box of another step jumps there.
 */
export function SearchExplainerTree({ lit, onSelect }: { lit: TreeNodeId[]; onSelect: (index: number) => void }) {
  const id = useId()
  const on = (node: TreeNodeId) => lit.includes(node)
  const stepOf = (node: TreeNodeId) => STORY.findIndex((step) => step.lit.includes(node))

  const edge = (key: string, d: string, active: boolean, dashed = false) => (
    <path key={key} d={d} fill="none" strokeWidth={active ? 1.75 : 1.1} markerEnd={`url(#${id}-${active ? 'on' : 'off'})`}
      strokeDasharray={active ? '6 4' : dashed ? '3 3' : undefined}
      className={cn('transition-[stroke] duration-500', active ? 'stroke-primary' : 'stroke-muted-foreground/40')}>
      {active && <animate attributeName="stroke-dashoffset" from="20" to="0" dur="0.9s" repeatCount="indefinite" />}
    </path>
  )

  const box = (node: Exclude<TreeNodeId, 'keyword' | 'semantic'>, width = BOX.width, height = BOX.height) => {
    const { x, y } = AT[node]
    const active = on(node)
    const step = stepOf(node)
    const clickable = step >= 0 && !active
    return <g key={node} onClick={clickable ? () => onSelect(step) : undefined} className={cn(clickable && 'cursor-pointer')}>
      {active && <rect x={x - width / 2 - 5} y={y - height / 2 - 5} width={width + 10} height={height + 10} rx={13}
        className="fill-none stroke-primary/30" strokeWidth={4} />}
      <rect x={x - width / 2} y={y - height / 2} width={width} height={height} rx={9} strokeWidth={active ? 2 : 1.25}
        strokeDasharray={node === 'filter' && !active ? '4 3' : undefined}
        className={cn('transition-[fill,stroke] duration-500', active ? 'fill-primary/12 stroke-primary' : 'fill-card stroke-border')} />
      <text x={x} y={y - 3} textAnchor="middle" className="fill-foreground text-[13px] font-semibold">{LABELS[node].label}</text>
      <text x={x} y={y + 13} textAnchor="middle" className="fill-muted-foreground text-[10.5px]">{LABELS[node].sub}</text>
      {clickable && <title>{`Jump to “${STORY[step].title}”`}</title>}
    </g>
  }

  return <svg viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} className="mx-auto block h-auto w-full max-w-[1120px]" role="img"
    aria-label="How a search runs: your text is searched in every index of the scope, by keyword and by meaning; each method's findings become one ranking with one place per entity; fusion combines the two rankings by rank; a filter applies inside every search; the best results up to the limit come out.">
    <defs>
      {(['on', 'off'] as const).map((tone) => <marker key={tone} id={`${id}-${tone}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 1 L 9 5 L 0 9 z" className={tone === 'on' ? 'fill-primary' : 'fill-muted-foreground/50'} />
      </marker>)}
    </defs>

    {(['keyword', 'semantic'] as const).map((lane) => {
      const { top, title, sub } = LANES[lane]
      const active = on(lane)
      const step = stepOf(lane)
      return <g key={lane} onClick={!active ? () => onSelect(step) : undefined} className={cn(!active && 'cursor-pointer')}>
        <rect x={196} y={top} width={470} height={LANE_HEIGHT} rx={12}
          className={cn('transition-[fill] duration-500', active ? 'fill-primary/8' : 'fill-muted/45')} />
        <text x={212} y={top + 20} className="text-[11px]">
          <tspan className="fill-foreground font-semibold tracking-wider uppercase">{title}</tspan>
          <tspan className="fill-muted-foreground"> — {sub}</tspan>
        </text>
        {EXAMPLE_INDICES.map((index, i) => {
          const y = indexY(lane, i)
          return <g key={i}>
            <rect x={INDEX.x} y={y} width={INDEX.width} height={INDEX.height} rx={6} strokeWidth={active ? 1.5 : 1}
              className={cn('transition-[fill,stroke] duration-500', active ? 'fill-card stroke-primary/70' : 'fill-card stroke-border')} />
            <text x={INDEX.x + 10} y={y + 16} className="fill-foreground text-[11px]">
              <tspan className="font-semibold">{index.type}</tspan>
              <tspan className="fill-muted-foreground"> · {index.part}</tspan>
            </text>
          </g>
        })}
        {!active && <title>{`Jump to “${STORY[step].title}”`}</title>}
      </g>
    })}

    {/* The text fans out to every search. */}
    {(['keyword', 'semantic'] as const).flatMap((lane) => EXAMPLE_INDICES.map((_, i) => {
      const y = indexY(lane, i) + INDEX.height / 2
      return edge(`q-${lane}-${i}`, `M ${AT.query.x + BOX.width / 2 - 20} ${AT.query.y} C 190 ${AT.query.y}, 180 ${y}, ${INDEX.x - 3} ${y}`, on('query'))
    }))}
    {/* The filter applies inside every search. */}
    <path d={`M 204 ${LANES.keyword.top + 30} L 204 ${LANES.semantic.top + LANE_HEIGHT - 8}`} fill="none" strokeDasharray="3 3" strokeWidth={on('filter') ? 2 : 1}
      className={cn('transition-[stroke] duration-500', on('filter') ? 'stroke-primary' : 'stroke-muted-foreground/35')} />
    {edge('filter', `M ${AT.filter.x + 65} ${AT.filter.y} L 202 ${AT.filter.y}`, on('filter'), true)}

    {(['keyword', 'semantic'] as const).flatMap((lane) => EXAMPLE_INDICES.map((_, i) => {
      const y = indexY(lane, i) + INDEX.height / 2
      const list = lane === 'keyword' ? 'keywordList' : 'semanticList'
      return edge(`l-${lane}-${i}`, `M ${INDEX.x + INDEX.width + 2} ${y} C 450 ${y}, 450 ${AT[list].y}, ${AT[list].x - BOX.width / 2 - 3} ${AT[list].y}`, on(list))
    }))}
    {edge('k-f', `M ${AT.keywordList.x + BOX.width / 2 + 2} ${AT.keywordList.y} C 690 ${AT.keywordList.y}, 680 ${AT.fuse.y - 12}, ${AT.fuse.x - 72} ${AT.fuse.y - 12}`, on('fuse'))}
    {edge('s-f', `M ${AT.semanticList.x + BOX.width / 2 + 2} ${AT.semanticList.y} C 690 ${AT.semanticList.y}, 680 ${AT.fuse.y + 12}, ${AT.fuse.x - 72} ${AT.fuse.y + 12}`, on('fuse'))}
    {edge('f-r', `M ${AT.fuse.x + 70} ${AT.fuse.y} L ${AT.results.x - 88} ${AT.results.y}`, on('results'))}

    {box('query', 130, 56)}
    {box('filter', 130, 40)}
    {box('keywordList')}
    {box('semanticList')}
    {box('fuse', 140, 56)}
    {box('results', 172, 56)}
  </svg>
}
