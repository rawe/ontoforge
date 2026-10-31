import { useState } from 'react'
import type { ToolCall } from '@/api/types'
import { Button } from '@/components/ui/button'
import { useAssistantPanel } from '../panel/panelContext'
import type { Binding } from '../types'
import { proposalOf, type FillOutcome } from './draftFillModel'

const AGENT_FIELDS: Record<string, string> = {
  name: 'Name', description: 'Description', systemPrompt: 'System prompt', tools: 'Tools',
}

/**
 * The card of a `fill_agent_draft` result: the agent and the fields it
 * proposes, and "Fill draft". A click fills the open agent editor only if
 * it is the same editor at the same draft version as when asked (D10)
 * and it is not saving or deleting; otherwise the card says so and
 * nothing changes. While it saves, "Fill draft" stays for a later try.
 */
export function AgentDraftCard({ call, at }: { call: ToolCall; at: Binding }) {
  const { draftEditor } = useAssistantPanel()
  const [outcome, setOutcome] = useState<FillOutcome | null>(null)
  const proposal = proposalOf(call.result)
  if (proposal === null) return null
  const fields = Object.keys(proposal.fields).filter((field) => Object.hasOwn(AGENT_FIELDS, field))
  const fill = () => {
    const editor = draftEditor()
    setOutcome(editor === null ? 'stale' : editor.fill(at.ontologyKey, proposal))
  }
  return (
    <div data-testid="draft-fill-card" className="grid gap-1.5 rounded-lg border bg-card px-3 py-2.5 text-xs">
      <p className="font-medium">
        Agent draft · <span className="font-mono">{proposal.target.agentKey ?? 'new agent'}</span>
      </p>
      <p className="text-muted-foreground">
        {fields.length} {fields.length === 1 ? 'field' : 'fields'}: {fields.map((field) => AGENT_FIELDS[field]).join(', ')}
      </p>
      {outcome === 'busy' && (
        <p role="status" data-testid="draft-fill-outcome" className="text-(--tc-amber)">
          The editor is saving or deleting and cannot fill now. Try again once it is done.
        </p>
      )}
      {outcome === null || outcome === 'busy' ? (
        <Button size="xs" className="w-fit" data-testid="draft-fill-button" onClick={fill}>Fill draft</Button>
      ) : (
        <p role="status" data-testid="draft-fill-outcome" className={outcome === 'stale' ? 'text-(--tc-amber)' : 'text-muted-foreground'}>
          {outcome === 'stale' ? 'The draft changed since you asked. Ask again.' : 'Filled into the editor. Review it, then save.'}
        </p>
      )}
    </div>
  )
}
