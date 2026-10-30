import { TextSearch } from 'lucide-react'
import { ExplainerButton } from '@/components/explainer/ExplainerButton'
import { ExplainerDialog, type ExplainerStory } from '@/components/explainer/ExplainerDialog'
import { getTypeColor } from '@/lib/typeColors'
import { cn } from '@/lib/utils'
import { SearchExplainerTree } from './SearchExplainerTree'
import {
  EXAMPLE_INDICES,
  EXAMPLE_QUERY,
  FUSED,
  KEYWORD_ENTRIES,
  SEMANTIC_ENTRIES,
  STORY,
  fusionPoints,
  type ExampleEntry,
  type ExampleView,
  type StoryStep,
} from './searchExplainerStory'

const PLAY_MS = 6000

const EXPLAINER: ExplainerStory<StoryStep> = {
  title: 'How search works',
  icon: TextSearch,
  summary: <>
    A search ranks entities — or passages of their documents — for a text. By default it looks for your words and
    for your meaning at the same time, and combines what both find into one list, best first.
  </>,
  facts: [
    { label: 'Keyword', value: 'finds your words' },
    { label: 'Semantic', value: 'finds your meaning' },
    { label: 'Fusion', value: 'combines both by rank' },
  ],
  steps: STORY,
}

const microLabel = 'text-[10px] font-semibold tracking-wider text-muted-foreground uppercase'

function Who({ typeKey, type, entity }: { typeKey: string; type: string; entity: string }) {
  const color = getTypeColor(typeKey)
  return <span className="flex min-w-0 items-center gap-1.5">
    <span className={cn('size-1.5 shrink-0 rounded-full', color.dot)} aria-hidden />
    <span className="truncate font-medium">{entity}</span>
    <span className={cn('shrink-0 text-[10.5px]', color.text)}>{type}</span>
  </span>
}

/** A ranking of the example: one row per entry, a repeated entity struck through when it no longer counts. */
function Entries({ entries, semantic, grouped }: { entries: ExampleEntry[]; semantic: boolean; grouped: boolean }) {
  let rank = 0
  return <ol className="grid gap-1">
    {entries.map((entry, i) => {
      const counts = !grouped || entry.repeat !== true
      if (counts) rank++
      return <li key={i} className={cn('grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-1.5 rounded-md border px-2 py-1 text-[12px] transition-colors',
        !counts && 'border-dashed opacity-55')}>
        <span className="pt-px text-right font-mono text-[11px] text-muted-foreground tabular-nums">{counts && grouped ? rank : ''}</span>
        <span className="grid min-w-0 gap-0.5">
          <span className={cn(!counts && 'line-through')}><Who {...entry} /></span>
          <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="shrink-0">{entry.part}</span>
            {semantic && entry.similarity !== undefined
              ? <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full bg-primary/70" style={{ width: `${entry.similarity * 100}%` }} />
                  </span>
                  <span className="tabular-nums">{entry.similarity.toFixed(2)}</span>
                  <span className="truncate">{entry.found}</span>
                </span>
              : <span className="truncate">found: <span className="text-foreground">{entry.found}</span></span>}
          </span>
          {!counts && <span className="text-[10.5px] text-muted-foreground">already in the ranking — counts once</span>}
        </span>
      </li>
    })}
  </ol>
}

/** What the example looks like at a step. */
function Example({ view }: { view: ExampleView }) {
  switch (view) {
    case 'indices':
      return <ul className="grid gap-1 sm:grid-cols-2">
        {EXAMPLE_INDICES.map((index, i) => <li key={i} className="rounded-md border px-2.5 py-1.5 text-[12px]">
          <Who typeKey={index.typeKey} type="" entity={`${index.type} · ${index.part}`} />
          <span className="text-[11px] text-muted-foreground">{index.holds}</span>
        </li>)}
      </ul>
    case 'keyword':
      return <Entries entries={KEYWORD_ENTRIES} semantic={false} grouped={false} />
    case 'semantic':
      return <Entries entries={SEMANTIC_ENTRIES} semantic grouped={false} />
    case 'grouped':
      return <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid content-start gap-1"><span className={microLabel}>Keyword ranking</span><Entries entries={KEYWORD_ENTRIES} semantic={false} grouped /></div>
        <div className="grid content-start gap-1"><span className={microLabel}>Semantic ranking</span><Entries entries={SEMANTIC_ENTRIES} semantic grouped /></div>
      </div>
    case 'fused': {
      const best = fusionPoints(FUSED[0])
      return <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left text-[10.5px] text-muted-foreground">
            <th className="pb-1 font-medium">Entity</th>
            <th className="pb-1 text-center font-medium">Keyword</th>
            <th className="pb-1 text-center font-medium">Semantic</th>
            <th className="w-[38%] pb-1 font-medium">Points from both places</th>
          </tr>
        </thead>
        <tbody>
          {FUSED.map((row) => <tr key={row.entity} className="border-t">
            <td className="py-1.5 pr-2"><Who {...row} /></td>
            <td className="text-center tabular-nums">{row.keywordRank === null ? '—' : `#${row.keywordRank}`}</td>
            <td className="text-center tabular-nums">{row.semanticRank === null ? '—' : `#${row.semanticRank}`}</td>
            <td>
              <span className="flex items-center gap-2">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-primary/70" style={{ width: `${(fusionPoints(row) / best) * 100}%` }} />
                </span>
                {row.keywordRank !== null && row.semanticRank !== null && <span className="shrink-0 text-[10.5px] text-primary">found by both</span>}
              </span>
            </td>
          </tr>)}
        </tbody>
      </table>
    }
    case 'results':
      return <ol className="divide-y rounded-md border">
        {FUSED.map((row, i) => <li key={row.entity} className="flex items-center gap-2.5 px-2.5 py-1.5 text-[12px]">
          <span className="w-4 text-right font-mono text-[11px] text-muted-foreground tabular-nums">{i + 1}</span>
          <Who {...row} />
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">matched: {row.matched}</span>
        </li>)}
      </ol>
  }
}

/**
 * Opens how search works — the search tree in plain words, told over one example query: a
 * bare "?" beside the page title, or `labeled` — "? How search works" — where the page
 * points to it.
 */
export function SearchExplainerButton({ labeled = false, className }: { labeled?: boolean; className?: string }) {
  return <ExplainerButton title={EXPLAINER.title} label={labeled ? EXPLAINER.title : undefined} className={className}>
    <ExplainerDialog story={EXPLAINER} label="The step and the search" playMs={PLAY_MS}
      diagram={({ step, go }) => <>
        <h3 className={cn(microLabel, 'mb-1')}>What happens to your text</h3>
        <div className="overflow-x-auto">
          <div className="min-w-[40rem]">
            <SearchExplainerTree lit={step.lit} onSelect={go} />
          </div>
        </div>
      </>}>
      {({ step }) => <SearchExample step={step} />}
    </ExplainerDialog>
  </ExplainerButton>
}

/** The example query at a step beside the step's note. */
function SearchExample({ step }: { step: StoryStep }) {
  return <div className="grid gap-3 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
    <section className="flex flex-col gap-2 rounded-xl border bg-card p-3" aria-label="The example">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={microLabel}>On an example: “{EXAMPLE_QUERY}”{step.view === 'indices' ? ' — four indices of its lens' : ''}</h3>
        {step.view !== 'indices' && step.view !== 'results' && <span className="text-[11px] text-muted-foreground">numbers for illustration — results never show them</span>}
      </div>
      {/* As high as the tallest step's example, so the dialog keeps one height. */}
      <div className="min-h-[15rem]"><Example view={step.view} /></div>
    </section>
    <section className="grid content-start gap-1 rounded-xl border border-primary/40 bg-primary/5 p-3 text-[13px]" aria-label="Note">
      <span className={microLabel}>Good to know</span>
      <p>{step.note}</p>
    </section>
  </div>
}
