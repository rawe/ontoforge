import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

/** Section anchors of the config editor a step's settings jump to. */
export const SECTION_IDS = {
  indices: 'agent-indices',
  filters: 'agent-filters',
  answerFields: 'agent-answer-fields',
  answer: 'agent-answer',
} as const

type SectionId = (typeof SECTION_IDS)[keyof typeof SECTION_IDS]

interface Step {
  title: string
  only?: string
  body: ReactNode
  knobs: { label: string; section: SectionId }[]
}

const STEPS: Step[] = [
  {
    title: 'Plan',
    body: <>A language model reads the question with the name, description and relation groups of each chosen index and the filters. It writes up to four sub-queries: the indices and relation groups to search, a search text with up to three rephrasings, the mode — normally semantic and keyword together — and any filter value the question states.</>,
    knobs: [{ label: 'Search indices and their descriptions', section: SECTION_IDS.indices }, { label: 'Filters', section: SECTION_IDS.filters }],
  },
  {
    title: 'Narrow',
    body: <>Each stated filter value is looked up exactly — ignoring case and spacing — on the result or an entity up to two relations away. Only matching entities stay; the match is reported as the result's condition.</>,
    knobs: [{ label: 'Filters', section: SECTION_IDS.filters }],
  },
  {
    title: 'Rank entries',
    body: <>Each sub-query ranks the <em>entries</em> of its indices: semantic by the meaning of the embedded text, keyword by stemmed words — only what an entry holds can match. An entity counts by its best entry. The similarity threshold drops weak semantic matches, but only in sub-queries without a filter; keyword matches always pass.</>,
    knobs: [{ label: 'What the indices hold', section: SECTION_IDS.indices }, { label: 'Similarity threshold', section: SECTION_IDS.answer }],
  },
  {
    title: 'Fuse',
    body: <>Rankings merge by rank, not by score: semantic with keyword, then the rephrasings, then the sub-queries. An entity found several ways rises. Results carry no score.</>,
    knobs: [],
  },
  {
    title: 'Answer',
    only: 'chat only',
    body: <>The answer fields of the best results, each cut to the character limit, are the evidence the answer is written from. Retrieve stops after Fuse.</>,
    knobs: [{ label: 'Answer fields', section: SECTION_IDS.answerFields }, { label: 'Characters per field', section: SECTION_IDS.answer }],
  },
]

/** How a question becomes results, step by step, with the settings that steer each step. */
export function RetrievalPipeline() {
  return <details className="group rounded-xl border bg-card">
    <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[13px] font-semibold">
      <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
      How a question becomes results
      <span className="ml-auto text-xs font-normal text-muted-foreground">and which setting steers each step</span>
    </summary>
    <ol className="grid gap-3 border-t px-4 py-3">
      {STEPS.map((step, i) => <li key={step.title} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2">
        <span className="flex size-6 items-center justify-center rounded-full border text-[11px] font-medium text-muted-foreground">{i + 1}</span>
        <div className="grid gap-1">
          <span className="text-[13px] font-medium">{step.title}{step.only && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">({step.only})</span>}</span>
          <p className="text-xs text-muted-foreground">{step.body}</p>
          {step.knobs.length > 0 && <div className="flex flex-wrap items-center gap-1 text-[11px]">
            <span className="text-muted-foreground">Set by</span>
            {step.knobs.map((knob) => <button key={knob.label} type="button"
              onClick={() => document.getElementById(knob.section)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className="rounded border border-primary/30 bg-primary/10 px-1.5 py-px text-primary transition-colors hover:bg-primary/20">{knob.label}</button>)}
          </div>}
        </div>
      </li>)}
    </ol>
  </details>
}
