import { Layers } from 'lucide-react'
import type { SearchPartKind } from '@/api/types'
import { ExplainerButton } from '@/components/explainer/ExplainerButton'
import { ExplainerDialog, type ExplainerStory } from '@/components/explainer/ExplainerDialog'
import { getTypeColor } from '@/lib/typeColors'
import { cn } from '@/lib/utils'
import { IndexExplainerDiagram } from './IndexExplainerDiagram'
import {
  CHUNKS,
  EXHIBITOR,
  INDUSTRY,
  NAMED_STEP,
  ONE_OF_EACH,
  PARTS_STEP,
  PART_MEANING,
  PART_RESULT,
  PART_TONE,
  RELATION,
  SEARCH_ENTRIES,
  SEARCH_TEXT,
  STORY,
  indexById,
  type ExampleEntry,
  type IndexId,
  type Module,
  type StoryStep,
} from './indexExplainerStory'

const PLAY_MS = 6000

const EXPLAINER: ExplainerStory<StoryStep> = {
  title: 'How indices work',
  icon: Layers,
  summary: <>
    A search index turns each entity of one type into entries — small pieces of text a search can match. Which entries an
    entity gets depends on the index; a search finds the entity by its best entry.
  </>,
  facts: [
    { label: 'self', value: 'one entry per entity' },
    { label: 'relation', value: 'one per relation' },
    { label: 'passage', value: 'one per chunk of a document' },
  ],
  steps: STORY,
}

const microLabel = 'text-[10px] font-semibold tracking-wider text-muted-foreground uppercase'

/** A part's name in its colour. */
function Part({ part }: { part: SearchPartKind }) {
  return <span className={cn('shrink-0 rounded-md border px-1.5 font-mono text-[11px]', PART_TONE[part].text, PART_TONE[part].border)}>{part}</span>
}

/** One entry: its part, which one it is, and its text. */
function Entry({ entry, faded = false }: { entry: ExampleEntry; faded?: boolean }) {
  return <li className={cn('grid gap-0.5 rounded-md border px-2.5 py-1.5 text-[12px] transition-opacity', faded && 'border-dashed opacity-45')}>
    <span className="flex items-center gap-2"><Part part={entry.part} /><span className="text-muted-foreground">{entry.label}</span></span>
    <span className={cn('min-w-0 break-words', faded && 'line-through')}>{entry.text}</span>
  </li>
}

function Who({ typeKey, type, name }: { typeKey: string; type: string; name: string }) {
  const color = getTypeColor(typeKey)
  return <span className="flex min-w-0 items-center gap-1.5">
    <span className={cn('size-1.5 shrink-0 rounded-full', color.dot)} aria-hidden />
    <span className="truncate font-medium">{name}</span>
    <span className={cn('shrink-0 text-[10.5px]', color.text)}>{type}</span>
  </span>
}

function IndexEntries({ id }: { id: IndexId }) {
  const index = indexById(id)
  return <div className="grid gap-1.5">
    <span className="text-[12px]"><span className="font-medium">{index.name}</span>
      <span className="text-muted-foreground"> · {index.kind}{index.reads !== undefined && ` — reads ${index.reads}`}</span></span>
    <ul className="grid gap-1">{index.entries.map((entry, i) => <Entry key={i} entry={entry} />)}</ul>
  </div>
}

/** What the example looks like at a step. */
function Example({ step }: { step: StoryStep }) {
  switch (step.view) {
    case 'entity':
      return <dl className="grid gap-2 text-[12px]">
        <Who {...EXHIBITOR} />
        <div className="grid gap-0.5 border-l-2 border-(--tc-cyan) pl-2.5">
          <dt className="text-[11px] text-muted-foreground">Name · own field, string</dt><dd>{EXHIBITOR.name}</dd>
        </div>
        <div className="grid gap-1 border-l-2 border-(--tc-violet) pl-2.5">
          <dt className="text-[11px] text-muted-foreground">Description · own field, document</dt>
          {CHUNKS.map((chunk, i) => <dd key={i} className="flex gap-2">
            <span className="shrink-0 text-[11px] text-(--tc-violet)">chunk {i + 1}</span><span>{chunk}</span>
          </dd>)}
        </div>
        <div className="grid gap-0.5 border-l-2 border-(--tc-orange) pl-2.5">
          <dt className="text-[11px] text-muted-foreground">Relation · {RELATION}</dt>
          <dd className="flex items-center gap-1.5"><span className="text-muted-foreground">→</span><Who {...INDUSTRY} /></dd>
        </div>
      </dl>
    case 'entries':
      return <ul className="grid gap-1.5">
        {ONE_OF_EACH.map((entry) => <li key={entry.part} className="grid gap-0.5 rounded-md border px-2.5 py-1.5 text-[12px]">
          <span className="flex flex-wrap items-center gap-2"><Part part={entry.part} /><span className="text-muted-foreground">{PART_MEANING[entry.part]}</span></span>
          <span className="min-w-0 break-words">{entry.text}</span>
        </li>)}
      </ul>
    case 'default':
    case 'passages':
    case 'custom':
      return <IndexEntries id={step.view} />
    case 'search': {
      const [best] = SEARCH_ENTRIES
      return <div className="grid gap-2.5">
        <ol className="grid gap-1">
          {SEARCH_ENTRIES.map(({ index, entry, similarity }, i) => <li key={i}
            className={cn('grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 rounded-md border px-2 py-1 text-[12px]', i === 0 && 'border-primary/50 bg-primary/5')}>
            <span className="flex min-w-0 items-center gap-2">
              <Part part={entry.part} />
              <span className="truncate text-muted-foreground">{entry.label} · {indexById(index).name}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full bg-primary/70" style={{ width: `${similarity * 100}%` }} />
              </span>
              <span className="w-7 text-right text-[11px] tabular-nums">{similarity.toFixed(2)}</span>
            </span>
          </li>)}
        </ol>
        <div className="grid gap-1">
          <span className={microLabel}>Result</span>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md border px-2.5 py-1.5 text-[12px]">
            <span className="font-mono text-[11px] text-muted-foreground">1</span>
            <Who {...EXHIBITOR} />
            <span className={cn('ml-auto text-[11px]', PART_TONE[best.entry.part].text)}>{PART_RESULT[best.entry.part]}</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Had another entry been best, the row would say {(['self', 'passage'] as const).map((part, i) => <span key={part}>
              {i > 0 && ' or '}<span className={PART_TONE[part].text}>{PART_RESULT[part]}</span>
            </span>)}.
          </p>
        </div>
      </div>
    }
    case 'named': {
      const index = indexById(NAMED_STEP.index)
      return <div className="grid gap-2.5">
        <div className="grid gap-1.5 rounded-md border bg-muted/30 px-2.5 py-2 text-[12px]">
          <span className={microLabel}>A search step</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-muted-foreground">index</span><span className="font-medium">{index.name}</span>
            <span className="ml-2 text-muted-foreground">parts</span>
            {(['self', 'relation', 'passage'] as const).map((part) => <span key={part}
              className={cn('rounded-md border px-2 py-0.5 font-mono text-[11px]',
                NAMED_STEP.parts.includes(part) ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground')}>{part}</span>)}
          </span>
        </div>
        <ul className="grid gap-1">
          {index.entries.map((entry, i) => <Entry key={i} entry={entry} faded={!NAMED_STEP.parts.includes(entry.part)} />)}
        </ul>
      </div>
    }
  }
}

/** What an explainer step shows beside its title: the module it belongs to. */
function ModuleTag({ module }: { module: Module }) {
  return <span className="rounded-md border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">{module}</span>
}

/**
 * Opens how indices work — what a search index consists of, told over one example exhibitor:
 * `labeled` — "? How indices work" — where a page points to it; `parts` opens on what a named
 * search's parts keep.
 */
export function IndexExplainerButton({ labeled = false, parts = false, className }: { labeled?: boolean; parts?: boolean; className?: string }) {
  return <ExplainerButton title={EXPLAINER.title} label={labeled ? EXPLAINER.title : undefined} className={className}>
    <ExplainerDialog story={EXPLAINER} label="The step and the indices" playMs={PLAY_MS} start={parts ? PARTS_STEP : 0}
      tag={(step) => <ModuleTag module={step.module} />}
      diagram={({ step, go }) => <>
        <h3 className={cn(microLabel, 'mb-1')}>The example, its indices and their entries</h3>
        <div className="overflow-x-auto">
          <div className="min-w-[44rem]">
            <IndexExplainerDiagram lit={step.lit} onSelect={go} />
          </div>
        </div>
      </>}>
      {({ step }) => <IndexExample step={step} />}
    </ExplainerDialog>
  </ExplainerButton>
}

/** The example at a step beside the step's note. */
function IndexExample({ step }: { step: StoryStep }) {
  return <div className="grid gap-3 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
    <section className="flex flex-col gap-2 rounded-xl border bg-card p-3" aria-label="The example">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={microLabel}>{step.view === 'search' ? `On an example: “${SEARCH_TEXT}”` : 'On the example'}</h3>
        {step.view === 'search' && <span className="text-[11px] text-muted-foreground">numbers for illustration — results never show them</span>}
      </div>
      {/* As high as the tallest step's example, so the dialog keeps one height. */}
      <div className="min-h-[15rem]"><Example step={step} /></div>
    </section>
    <section className="grid content-start gap-1 rounded-xl border border-primary/40 bg-primary/5 p-3 text-[13px]" aria-label="Note">
      <span className={microLabel}>Good to know</span>
      <p>{step.note}</p>
    </section>
  </div>
}
