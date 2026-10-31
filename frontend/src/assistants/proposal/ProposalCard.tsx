import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '@/api/http'
import * as model from '@/api/model'
import { qk } from '@/api/queryKeys'
import { Button } from '@/components/ui/button'
import { invalidateModeling } from '@/components/studio/lib'
import { buildSchemaUrl, parseSchemaUrl } from '@/components/studio/schema/schemaUrl'
import { cn } from '@/lib/utils'
import { chatErrorText } from '../stream/chatStream'
import { useAssistantPanel } from '../panel/panelContext'
import type { Binding } from '../types'
import {
  appliedIn, applicable, checkLine, checkOf, countsLine, createdTypes, designOf, initialReview, proposalRows, recheckable, revisionOf, reviewReducer,
  type CheckedProposal, type Proposal, type Receipt, type TypeKind,
} from './proposalModel'
import { ProposalReview } from './ProposalReview'

/**
 * The card of a turn's schema proposal: the model's summary in its own
 * words, what the steps add and change, the server's check, and "Review",
 * which widens the panel and opens the whole-proposal review in the card.
 * Apply sends exactly this proposal and the revision of its latest check;
 * the server checks it all again. A restored proposal is re-checked before
 * Apply is offered; a design edit here since the check asks for a re-check
 * too. An Apply whose answer is lost is never sent again by itself: the
 * reloaded schema tells whether it was applied.
 */
export function ProposalCard({ checked, restored, at }: { checked: CheckedProposal; restored: boolean; at: Binding }) {
  const { proposal } = checked
  const { ontologyKey } = at
  const queryClient = useQueryClient()
  const [state, dispatch] = useReducer(reviewReducer, undefined, () => initialReview(checked.check, !restored))
  const [reviewing, setReviewing] = useState(false)
  const { widen } = useAssistantPanel()
  const navigate = useNavigate()
  const location = useLocation()
  const card = useRef<HTMLDivElement>(null)
  // A request is out: a second click before the buttons disable sends nothing.
  const sending = useRef(false)

  useEffect(() => {
    if (!reviewing) return
    card.current?.scrollIntoView({ block: 'nearest' })
    return widen()
  }, [reviewing, widen])

  // A design write here since the check: advisory, the server decides on Apply.
  useEffect(() => queryClient.getMutationCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'success') dispatch({ type: 'edited' })
  }), [queryClient])

  const design = useQuery({
    queryKey: qk.model(ontologyKey, 'export'),
    queryFn: () => model.exportSchema(ontologyKey),
    select: designOf,
    enabled: reviewing,
  }).data ?? null
  const groups = useMemo(() => proposalRows(proposal, state.check, design), [proposal, state.check, design])

  // A mutation, so the other open proposals see a design write.
  const apply = useMutation({ mutationFn: (body: { proposal: Proposal; expected: Receipt['revision'] }) =>
    model.applyProposal(ontologyKey, body.proposal, body.expected) })

  const select = (type: { kind: TypeKind; key: string }) => {
    const onSchema = location.pathname.startsWith(`/o/${ontologyKey}/studio/schema`)
    const view = onSchema ? parseSchemaUrl(location.pathname, location.search).view : 'graph'
    navigate(buildSchemaUrl(ontologyKey, view, type))
  }
  // Once its list is read again: the schema page drops a selection its (stale) list does not know.
  const selectFirstNew = async () => {
    const first = createdTypes(proposal)[0]
    if (first === undefined) return
    await queryClient.refetchQueries({ queryKey: qk.model(ontologyKey, first.kind), exact: true }).catch(() => {})
    select(first)
  }

  const recheck = async () => {
    if (!recheckable(state) || sending.current) return
    sending.current = true
    dispatch({ type: 'check' })
    try {
      dispatch({ type: 'checked', check: await model.checkProposal(ontologyKey, proposal) })
    } catch (error) {
      dispatch({ type: 'failed', error: chatErrorText(error, 'The check failed.') })
    } finally {
      sending.current = false
    }
  }

  const applyAll = async () => {
    if (!applicable(state) || sending.current) return
    sending.current = true
    dispatch({ type: 'apply' })
    let receipt: Receipt
    try {
      receipt = await apply.mutateAsync({ proposal, expected: state.check.baseRevision })
    } catch (error) {
      sending.current = false
      const details = error instanceof ApiError && error.status === 409 ? error.details : undefined
      const current = revisionOf(details?.current)
      const refusal = checkOf(details?.check)
      if (details?.code === 'DESIGN_CHANGED' && current !== null) dispatch({ type: 'designChanged', current })
      else if (details?.code === 'PROPOSAL_REFUSED' && refusal !== null) dispatch({ type: 'refused', check: refusal })
      else if (error instanceof ApiError && error.status < 500) dispatch({ type: 'failed', error: error.message })
      else await reconcile()
      return
    }
    sending.current = false
    dispatch({ type: 'applied', receipt })
    invalidateModeling(queryClient)
    setReviewing(false)
    await selectFirstNew()
  }

  // The answer to Apply was lost: it may have been applied. Never sent again; the reloaded schema decides.
  const reconcile = async () => {
    dispatch({ type: 'lost' })
    invalidateModeling(queryClient)
    try {
      const exported = await queryClient.fetchQuery({
        queryKey: qk.model(ontologyKey, 'export'), queryFn: () => model.exportSchema(ontologyKey), staleTime: 0,
      })
      const read = designOf(exported)
      const applied = read === null ? null : appliedIn(proposal, read)
      dispatch({ type: 'reconciled', applied })
      if (applied === true) {
        setReviewing(false)
        await selectFirstNew()
      }
    } catch {
      dispatch({ type: 'reconciled', applied: null })
    }
  }

  const reject = () => {
    dispatch({ type: 'reject' })
    setReviewing(false)
  }

  const line = checkLine(state.check)
  const decided = state.phase === 'applied' || state.phase === 'rejected'
  return (
    <div ref={card} data-testid="proposal-card" data-phase={state.phase} className="grid gap-1.5 rounded-lg border bg-card px-3 py-2.5 text-xs">
      <p className="font-medium">Schema proposal · {proposal.steps.length} {proposal.steps.length === 1 ? 'step' : 'steps'}</p>
      {proposal.summary !== undefined && proposal.summary.trim() !== '' && (
        <blockquote data-testid="proposal-summary" className="border-l-2 pl-2 text-muted-foreground italic">
          <span className="sr-only">The helper's summary: </span>“{proposal.summary}”
        </blockquote>
      )}
      <p className="text-muted-foreground">{countsLine(groups)}</p>
      {!decided && (
        <p data-testid="proposal-card-check" className={cn(line.verdict === 'ok' ? 'text-(--tc-emerald)' : 'text-destructive')}>
          {line.verdict === 'ok' ? 'Checked: ok' : line.verdict === 'refused' ? 'Checked: refused' : 'Checked: introduces issues'}
          <span className="text-muted-foreground"> · rev {state.check.baseRevision.revision}</span>
          {!state.fresh && state.lost === null && <span className="text-(--tc-amber)"> · re-check needed</span>}
        </p>
      )}
      {state.phase === 'applied' && <ReceiptLine receipt={state.receipt} />}
      {state.phase === 'rejected' && (
        <p role="status" data-testid="proposal-rejected" className="text-muted-foreground">Rejected. Nothing was written.</p>
      )}
      {!decided && (
        <Button
          size="xs"
          variant={reviewing ? 'secondary' : 'default'}
          className="w-fit"
          aria-expanded={reviewing}
          data-testid="proposal-review-button"
          onClick={() => setReviewing(!reviewing)}
        >
          {reviewing ? 'Hide review' : 'Review'}
        </Button>
      )}
      {reviewing && !decided && (
        <ProposalReview
          proposal={proposal}
          groups={groups}
          design={design}
          state={state}
          onSelect={select}
          onReject={reject}
          onRecheck={() => void recheck()}
          onApply={() => void applyAll()}
        />
      )}
    </div>
  )
}

/** "Applied · rev 42" and what was created; without a receipt (its answer was lost), what the reloaded schema showed. */
function ReceiptLine({ receipt }: { receipt: Receipt | null }) {
  if (receipt === null) {
    return (
      <p role="status" data-testid="proposal-receipt" className="text-(--tc-emerald)">
        Applied. The answer was lost; the reloaded schema shows the changes.
      </p>
    )
  }
  const created = Object.keys(receipt.created)
  return (
    <div role="status" data-testid="proposal-receipt" className="grid gap-0.5">
      <p className="text-(--tc-emerald)">Applied · rev {receipt.revision.revision}</p>
      {created.length > 0 && (
        <p className="text-muted-foreground">
          Created: <span className="font-mono text-[11px] break-words">{created.join(', ')}</span>
        </p>
      )}
    </div>
  )
}
