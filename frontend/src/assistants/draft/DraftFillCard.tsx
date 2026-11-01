import { useState } from 'react'
import type { ToolCall } from '@/api/types'
import { Button } from '@/components/ui/button'
import { itemKey } from '../address'
import { useAssistantPanel } from '../panel/panelContext'
import type { Binding } from '../types'
import { proposalOf, type FillOutcome } from './draftFillModel'
import { draftViewOf, proposedLabels } from './drafters'

/**
 * The card of a `fill_draft` result, in the view of its target's drafter: the item and the fields it
 * proposes, and "Fill draft". A click fills the open editor only if it is
 * the same editor at the same draft version as when asked (D10) and it is
 * not saving or deleting; otherwise the card says so and nothing changes.
 * While it saves, "Fill draft" stays for a later try.
 */
export function DraftFillCard({ call, at }: { call: ToolCall; at: Binding }) {
  const { draftEditor } = useAssistantPanel()
  const [outcome, setOutcome] = useState<FillOutcome | null>(null)
  const proposal = proposalOf(call.result)
  const view = proposal === null ? undefined : draftViewOf(proposal.target.kind)
  if (proposal === null || view === undefined) return null
  const fields = proposedLabels(view, proposal.fields)
  const fill = () => {
    const editor = draftEditor()
    setOutcome(editor === null ? 'stale' : editor.fill(at.ontologyKey, proposal))
  }
  return (
    <div data-testid="draft-fill-card" className="grid gap-1.5 rounded-lg border bg-card px-3 py-2.5 text-xs">
      <p className="font-medium">
        {view.title} · <span className="font-mono">{itemKey(proposal.target) ?? view.newItem}</span>
      </p>
      <p className="text-muted-foreground">
        {fields.length} {fields.length === 1 ? 'field' : 'fields'}: {fields.join(', ')}
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
