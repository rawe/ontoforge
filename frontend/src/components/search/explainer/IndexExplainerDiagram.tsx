import { useId, type ReactNode } from 'react'
import type { SearchPartKind } from '@/api/types'
import { getTypeColor } from '@/lib/typeColors'
import { cn } from '@/lib/utils'
import {
  EXAMPLE_INDICES,
  EXHIBITOR,
  INDUSTRY,
  NAMED_STEP,
  PART_RESULT,
  PART_TONE,
  RELATION,
  STORY,
  type IndexId,
  type Lit,
  type Source,
} from './indexExplainerStory'

const SOURCE_PART: Record<Source, SearchPartKind> = { name: 'self', relation: 'relation', description: 'passage' }

const VIEW = { width: 1200, height: 372 }
const LANE = { x: 380, width: 540 }
const LANES: Record<IndexId, { top: number; height: number }> = {
  default: { top: 36, height: 84 },
  passages: { top: 136, height: 84 },
  custom: { top: 236, height: 116 },
}
const CHIP = { x: 396, width: 120, height: 34, gap: 10, below: 36 }
/** Where each source leaves the example, and where it enters each lane that reads it. */
const FROM: Record<Source, { x: number; y: number }> = {
  name: { x: 332, y: 108 },
  description: { x: 332, y: 196 },
  relation: { x: 346, y: 275 },
}
const INTO: { source: Source; index: IndexId; y: number }[] = [
  { source: 'name', index: 'default', y: 89 },
  { source: 'description', index: 'passages', y: 189 },
  { source: 'name', index: 'custom', y: 262 },
  { source: 'relation', index: 'custom', y: 289 },
  { source: 'description', index: 'custom', y: 316 },
]
const SEARCH = { x: 1070, width: 220, text: 66, best: 186, result: 297 }

const microLabel = 'fill-muted-foreground text-[10px] font-semibold tracking-wider uppercase'

/**
 * The example and its indices: an exhibitor with its own field, its document cut into two
 * chunks and its relation to an industry; three indices and the entries each makes, coloured
 * by part; a search over all entries. The step's regions are lit, the rest fades; a region of
 * another step jumps there.
 */
export function IndexExplainerDiagram({ lit, onSelect }: { lit: Lit[]; onSelect: (index: number) => void }) {
  const id = useId()
  const on = (region: Lit) => lit.includes(region)
  const stepOf = (region: Lit) => STORY.findIndex((step) => step.lit.includes(region))
  const named = on('parts')
  const laneOn = (index: IndexId) => on(index) || (named && index === NAMED_STEP.index)
  /** A source is lit while a lit lane reads it; under parts only where its part is kept. */
  const sourceOn = (source: Source) => on('entity') ||
    INTO.some((into) => into.source === source && laneOn(into.index) && (!named || NAMED_STEP.parts.includes(SOURCE_PART[source])))
  const entryOn = (index: IndexId, part: SearchPartKind) => on('entries') || on('search') ||
    (named ? index === NAMED_STEP.index && NAMED_STEP.parts.includes(part) : on(index))

  const fade = (lit: boolean) => cn('transition-opacity duration-500', !lit && 'opacity-30')
  /** A region of another step: a click jumps there. */
  const region = (at: Lit, children: ReactNode) => {
    const step = stepOf(at)
    const clickable = step >= 0 && !on(at)
    return <g key={at} onClick={clickable ? () => onSelect(step) : undefined} className={cn(clickable && 'cursor-pointer')}>
      {children}
      {clickable && <title>{`Jump to “${STORY[step].title}”`}</title>}
    </g>
  }

  const exhibitor = getTypeColor(EXHIBITOR.typeKey)
  const industry = getTypeColor(INDUSTRY.typeKey)
  const self = PART_TONE.self
  const passage = PART_TONE.passage
  const relation = PART_TONE.relation

  return <svg viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} className="mx-auto block h-auto w-full max-w-[1200px]" role="img"
    aria-label="An exhibitor with a name, a description cut into two chunks and a relation to an industry. Its default index makes one own-fields entry, its passage index one passage entry per chunk, a custom index all three parts. A search compares your text with every entry; the best entry finds the entity, and the result names its part.">
    <defs>
      {(['on', 'off'] as const).map((tone) => <marker key={tone} id={`${id}-${tone}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 1 L 9 5 L 0 9 z" className={tone === 'on' ? 'fill-primary' : 'fill-muted-foreground/50'} />
      </marker>)}
      <marker id={`${id}-rel`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
        <path d="M 0 1 L 9 5 L 0 9 z" className={relation.fill} />
      </marker>
    </defs>

    {/* ── The example data ── */}
    <text x={16} y={24} className={microLabel}>The example data</text>
    {region('entity', <>
      <rect x={16} y={36} width={316} height={214} rx={12} strokeWidth={on('entity') ? 2 : 1.25}
        className={cn('fill-card transition-[stroke] duration-500', on('entity') ? 'stroke-primary' : 'stroke-border')} />
      <circle cx={34} cy={60} r={5} style={{ fill: exhibitor.cssVar }} />
      <text x={46} y={65} className="fill-foreground text-[14px] font-semibold">{EXHIBITOR.name}</text>
      <rect x={236} y={49} width={82} height={20} rx={10} className="fill-none stroke-border" />
      <text x={277} y={63} textAnchor="middle" className="text-[10.5px]" style={{ fill: exhibitor.cssVar }}>{EXHIBITOR.type}</text>
      <line x1={16} y1={80} x2={332} y2={80} className="stroke-border" />

      <g className={fade(sourceOn('name'))}>
        <rect x={28} y={92} width={4} height={30} rx={2} className={self.fill} />
        <text x={42} y={104} className="fill-muted-foreground text-[11px]">Name</text>
        <text x={42} y={118} className="fill-foreground text-[12.5px]">{EXHIBITOR.name}</text>
        <text x={318} y={111} textAnchor="end" className={cn(self.fill, 'text-[10px]')}>own field · string</text>
      </g>

      <g className={fade(sourceOn('description'))}>
        <rect x={28} y={134} width={4} height={104} rx={2} className={passage.fill} />
        <text x={42} y={146} className="fill-muted-foreground text-[11px]">Description</text>
        <text x={318} y={146} textAnchor="end" className={cn(passage.fill, 'text-[10px]')}>own field · document</text>
        <rect x={42} y={154} width={276} height={84} rx={6} className={cn('fill-none', passage.stroke)} strokeOpacity={0.5} />
        <g className="stroke-muted-foreground/50" strokeWidth={2} strokeLinecap="round">
          {[[168, 250], [178, 236], [188, 200], [210, 246], [220, 228]].map(([y, x2]) => <line key={y} x1={54} y1={y} x2={x2} y2={y} />)}
        </g>
        <line x1={42} y1={197} x2={318} y2={197} strokeDasharray="4 3" className={passage.stroke} />
        <text x={310} y={180} textAnchor="end" className={cn(passage.fill, 'text-[10px]')}>chunk 1</text>
        <text x={310} y={222} textAnchor="end" className={cn(passage.fill, 'text-[10px]')}>chunk 2</text>
      </g>

      <g className={fade(sourceOn('relation'))}>
        <path d="M 174 250 L 174 300" fill="none" strokeWidth={2} markerEnd={`url(#${id}-rel)`} className={relation.stroke} />
        <rect x={184} y={264} width={162} height={22} rx={11} className={cn('fill-card', relation.stroke)} />
        <text x={265} y={279} textAnchor="middle" className={cn(relation.fill, 'text-[10.5px]')}>relation · {RELATION}</text>
        <rect x={90} y={304} width={168} height={48} rx={12} strokeWidth={1.25} className="fill-card stroke-border" />
        <circle cx={108} cy={328} r={5} style={{ fill: industry.cssVar }} />
        <text x={120} y={333} className="fill-foreground text-[13px] font-semibold">{INDUSTRY.name}</text>
        <rect x={188} y={318} width={60} height={20} rx={10} className="fill-none stroke-border" />
        <text x={218} y={332} textAnchor="middle" className="text-[10.5px]" style={{ fill: industry.cssVar }}>{INDUSTRY.type}</text>
      </g>
    </>)}

    {/* ── Indices and their entries ── */}
    <text x={LANE.x} y={24} className={microLabel}>Indices and their entries</text>
    {EXAMPLE_INDICES.map((index) => {
      const { top, height } = LANES[index.id]
      const active = laneOn(index.id)
      return region(index.id, <>
        <rect x={LANE.x} y={top} width={LANE.width} height={height} rx={12}
          className={cn('transition-[fill] duration-500', active ? 'fill-primary/8' : 'fill-muted/45')} />
        <text x={LANE.x + 16} y={top + 22} className="text-[11px]">
          <tspan className="fill-foreground font-semibold">{index.name}</tspan>
          <tspan dx={8} className="fill-muted-foreground">{index.kind}{index.reads !== undefined && ` — reads ${index.reads}`}</tspan>
        </text>
        {named && index.id === NAMED_STEP.index && <g>
          <rect x={LANE.x + LANE.width - 112} y={top + height - 28} width={100} height={20} rx={10} className="fill-primary/12 stroke-primary" />
          <text x={LANE.x + LANE.width - 62} y={top + height - 14} textAnchor="middle" className="fill-primary text-[10.5px] font-medium">parts: {NAMED_STEP.parts.join(', ')}</text>
        </g>}
        {index.entries.map((entry, i) => {
          const x = CHIP.x + i * (CHIP.width + CHIP.gap)
          const y = top + CHIP.below
          const tone = PART_TONE[entry.part]
          const lit = entryOn(index.id, entry.part)
          return <g key={i} className={fade(lit)}>
            <rect x={x} y={y} width={CHIP.width} height={CHIP.height} rx={7} strokeWidth={lit ? 1.5 : 1}
              strokeDasharray={named && index.id === NAMED_STEP.index && !lit ? '4 3' : undefined} className={cn('fill-card', tone.stroke)} />
            <text x={x + 12} y={y + 21} className={cn(tone.fill, 'text-[11px]')}>
              <tspan className="font-semibold">{entry.part}</tspan> · {entry.label}
            </text>
          </g>
        })}
        {index.kind === 'custom' && <text x={CHIP.x} y={top + height - 14} className="fill-muted-foreground text-[10px]">only a custom index has relation groups</text>}
      </>)
    })}

    {INTO.map(({ source, index, y }) => {
      const from = FROM[source]
      const lit = sourceOn(source) && laneOn(index)
      return <path key={`${source}-${index}`} d={`M ${from.x} ${from.y} C ${from.x + 24} ${from.y}, ${LANE.x - 24} ${y}, ${LANE.x - 3} ${y}`}
        fill="none" strokeWidth={lit ? 1.75 : 1.1} markerEnd={`url(#${id}-${lit ? 'on' : 'off'})`} strokeDasharray={lit ? '6 4' : undefined}
        className={cn('transition-[stroke] duration-500', lit ? PART_TONE[SOURCE_PART[source]].stroke : 'stroke-muted-foreground/30')}>
        {lit && <animate attributeName="stroke-dashoffset" from="20" to="0" dur="0.9s" repeatCount="indefinite" />}
      </path>
    })}

    {/* ── Search ── */}
    <text x={SEARCH.x - SEARCH.width / 2} y={24} className={microLabel}>Search</text>
    {region('search', <>
      <g className={fade(on('search'))}>
        {EXAMPLE_INDICES.map((index) => {
          const y = LANES[index.id].top + LANES[index.id].height / 2
          const lit = on('search')
          return <path key={index.id} d={`M ${SEARCH.x - SEARCH.width / 2} ${SEARCH.text} C ${SEARCH.x - 140} ${SEARCH.text}, ${LANE.x + LANE.width + 20} ${y}, ${LANE.x + LANE.width + 4} ${y}`}
            fill="none" strokeWidth={lit ? 1.75 : 1.1} markerEnd={`url(#${id}-${lit ? 'on' : 'off'})`} strokeDasharray={lit ? '6 4' : undefined}
            className={lit ? 'stroke-primary' : 'stroke-muted-foreground/40'}>
            {lit && <animate attributeName="stroke-dashoffset" from="20" to="0" dur="0.9s" repeatCount="indefinite" />}
          </path>
        })}
        {[
          { y: SEARCH.text, label: 'Your text', sub: 'compared with every entry' },
          { y: SEARCH.best, label: 'Best entry wins', sub: 'the entity counts once' },
        ].map((box) => <g key={box.label}>
          <rect x={SEARCH.x - SEARCH.width / 2} y={box.y - 26} width={SEARCH.width} height={52} rx={9} strokeWidth={on('search') ? 2 : 1.25}
            className={on('search') ? 'fill-primary/12 stroke-primary' : 'fill-card stroke-border'} />
          <text x={SEARCH.x} y={box.y - 3} textAnchor="middle" className="fill-foreground text-[13px] font-semibold">{box.label}</text>
          <text x={SEARCH.x} y={box.y + 13} textAnchor="middle" className="fill-muted-foreground text-[10.5px]">{box.sub}</text>
        </g>)}
        <rect x={SEARCH.x - SEARCH.width / 2} y={SEARCH.result - 32} width={SEARCH.width} height={64} rx={9} strokeWidth={on('search') ? 2 : 1.25}
          className={on('search') ? 'fill-primary/12 stroke-primary' : 'fill-card stroke-border'} />
        <text x={SEARCH.x} y={SEARCH.result - 10} textAnchor="middle" className="fill-foreground text-[13px] font-semibold">Result</text>
        <text x={SEARCH.x} y={SEARCH.result + 6} textAnchor="middle" className="fill-muted-foreground text-[10.5px]">{EXHIBITOR.name}</text>
        <text x={SEARCH.x} y={SEARCH.result + 21} textAnchor="middle" className={cn(relation.fill, 'text-[10px]')}>{PART_RESULT.relation}</text>
        {[[SEARCH.text + 26, SEARCH.best - 30], [SEARCH.best + 26, SEARCH.result - 36]].map(([y1, y2]) =>
          <path key={y1} d={`M ${SEARCH.x} ${y1} L ${SEARCH.x} ${y2}`} fill="none" strokeWidth={on('search') ? 1.75 : 1.1}
            markerEnd={`url(#${id}-${on('search') ? 'on' : 'off'})`} className={on('search') ? 'stroke-primary' : 'stroke-muted-foreground/40'} />)}
      </g>
    </>)}
  </svg>
}
