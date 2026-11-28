import { Fragment } from 'react'
import { ChevronRight, ScrollText } from 'lucide-react'
import { ExplainerButton } from '@/components/explainer/ExplainerButton'
import { ExplainerDialog, type ExplainerStory } from '@/components/explainer/ExplainerDialog'
import { cn } from '@/lib/utils'
import { FLOW, PARTS, STORY, type FlowNodeId, type StoryStep } from './runtimeSkillExplainerStory'

const EXPLAINER: ExplainerStory<StoryStep> = {
  title: 'How a runtime skill works',
  icon: ScrollText,
  summary: <>
    A runtime skill guides an MCP client working with data in this lens. Its key identifies the skill, its description
    helps the client choose it, and its content contains the instructions.
  </>,
  facts: [
    { label: 'Belongs to', value: 'this lens' },
    { label: 'Served by', value: 'the lens\'s runtime MCP endpoints' },
    { label: 'In Claude Code', value: '/<server>:<key>' },
  ],
  steps: STORY,
}

const microLabel = 'text-[10px] font-semibold tracking-wider text-muted-foreground uppercase'

const HEADINGS: Record<FlowNodeId, string> = {
  studio: 'What you edit',
  endpoint: 'What the endpoint serves',
  client: 'What the client holds',
}

/**
 * Opens how a runtime skill works: a bare "?" beside an editor's title, or `labeled` —
 * "? How runtime skills work" — in the list's header.
 */
export function RuntimeSkillExplainerButton({ labeled = false, className }: { labeled?: boolean; className?: string }) {
  return <ExplainerButton title={EXPLAINER.title} label={labeled ? 'How runtime skills work' : undefined} className={className}>
    <ExplainerDialog story={EXPLAINER} label="The step and where the skill goes"
      diagram={({ index, step, go }) => <>
        <h3 className={cn(microLabel, 'mb-1.5')}>Where the skill goes</h3>
        <SkillFlow current={step.node} onSelect={(node) => go(node === step.node ? index : STORY.findIndex((s) => s.node === node))} />
      </>}>
      {({ step }) => <SkillParts step={step} />}
    </ExplainerDialog>
  </ExplainerButton>
}

/** The three places in a row; the step's place is lit and each one moves to its first step. */
function SkillFlow({ current, onSelect }: { current: FlowNodeId; onSelect: (node: FlowNodeId) => void }) {
  return <ol className="flex flex-wrap items-center gap-2">
    {FLOW.map((node, i) => <Fragment key={node.id}>
      {i > 0 && <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
      <li>
        <button type="button" onClick={() => onSelect(node.id)} aria-current={node.id === current ? 'step' : undefined}
          className={cn('grid rounded-lg border px-3 py-1.5 text-left transition-colors',
            node.id === current ? 'border-primary bg-primary/12' : 'bg-card hover:bg-muted/50')}>
          <span className={cn('text-[12.5px] font-medium', node.id === current && 'text-primary')}>{node.label}</span>
          <span className="text-[11px] text-muted-foreground">{node.sub}</span>
        </button>
      </li>
    </Fragment>)}
  </ol>
}

/** The skill's three parts at a step, each as the SKILL.md line it becomes; parts the client does not hold yet are dimmed. */
function SkillParts({ step }: { step: StoryStep }) {
  return <section className="grid gap-2 rounded-xl border bg-card p-3" aria-label={HEADINGS[step.node]}>
    <h3 className={microLabel}>{HEADINGS[step.node]}</h3>
    <ul className="grid gap-1.5">
      {PARTS.map(({ part, label, line }) => {
        const held = step.parts.includes(part)
        return <li key={part} className={cn('flex flex-wrap items-baseline gap-x-3 rounded-md border px-2.5 py-1.5 transition-[opacity,background-color,border-color] duration-500',
          held ? 'border-primary/40 bg-primary/5' : 'border-dashed opacity-50')}>
          <span className="w-24 text-[12.5px] font-medium">{label}</span>
          <code className="font-mono text-[11.5px] text-muted-foreground">{line}</code>
          {!held && <span className="ml-auto text-[11px] text-muted-foreground">not loaded yet</span>}
        </li>
      })}
    </ul>
  </section>
}
