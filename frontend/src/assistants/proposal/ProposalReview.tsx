import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  applyBlocker, checkLine, recheckable, strayRefusals, typeExists,
  type Design, type Proposal, type ProposalRow, type ReviewState, type RowGroup, type TypeKind,
} from './proposalModel'

/**
 * The whole proposal as one plain list diff: its rows by group, `+` added,
 * `~` changed (a description before → after), each refused row with the
 * server's reason; then the server's check line, what it does not prove,
 * and Reject, Re-check, Apply all. A row of a type that exists already
 * selects it in the schema.
 */
export function ProposalReview({ proposal, groups, design, state, onSelect, onReject, onRecheck, onApply }: {
  proposal: Proposal
  groups: RowGroup[]
  /** The current design; null while it loads. */
  design: Design | null
  state: ReviewState
  onSelect: (type: { kind: TypeKind; key: string }) => void
  onReject: () => void
  onRecheck: () => void
  onApply: () => void
}) {
  const { check } = state
  const line = checkLine(check)
  const stray = strayRefusals(proposal, check)
  const loose = check.warnings.filter((w) => w.stepId === undefined || !proposal.steps.some((s) => s.id === w.stepId))
  const blocker = applyBlocker(state)
  return (
    <section data-testid="proposal-review" aria-label="Review proposal" className="grid gap-3 border-t pt-2.5">
      <header className="flex items-baseline gap-2">
        <h3 className="flex-1 font-medium">Review proposal</h3>
        <span data-testid="proposal-checked-at" className="text-muted-foreground">checked at rev {check.baseRevision.revision}</span>
      </header>

      <div className="grid gap-2.5">
        {groups.map((group) => (
          <div key={group.key}>
            <p className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{group.label}</p>
            <ul className="grid gap-0.5">
              {group.rows.map((row) => (
                <ReviewRow key={row.stepId} row={row} selectable={typeExists(design, row.type)} onSelect={() => onSelect(row.type)} />
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="grid gap-1.5 border-t pt-2.5">
        <p
          data-testid="proposal-check"
          data-verdict={line.verdict}
          className={cn(line.verdict === 'ok' ? 'text-(--tc-emerald)' : 'text-destructive')}
        >
          <span className="text-muted-foreground">Check: </span>{line.text}
        </p>
        {check.validation.introduced.length > 0 && (
          <IssueList label="New issues" tone="text-destructive" items={check.validation.introduced.map((i) => [i.path, i.message])} />
        )}
        {stray.length > 0 && <IssueList label="Refused" tone="text-destructive" items={stray.map((r) => [r.stepId, r.message])} />}
        {loose.length > 0 && <IssueList label="Warnings" tone="text-(--tc-amber)" items={loose.map((w) => [w.path ?? '', w.message])} />}
        {check.limits.length > 0 && (
          <div data-testid="proposal-limits" className="text-muted-foreground">
            <p>This check does not prove:</p>
            <ul className="list-disc space-y-0.5 pl-4">
              {check.limits.map((limit, i) => <li key={i}>{limit}</li>)}
            </ul>
          </div>
        )}
      </div>

      <Banners state={state} onRecheck={onRecheck} />

      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {blocker !== null && state.phase === 'ready' && (
          <span data-testid="proposal-apply-blocked" className="mr-auto text-muted-foreground">{blocker}</span>
        )}
        <Button size="xs" variant="ghost" data-testid="proposal-reject" disabled={state.phase !== 'ready'} onClick={onReject}>
          Reject
        </Button>
        <Button size="xs" variant="outline" data-testid="proposal-recheck" disabled={!recheckable(state)} onClick={onRecheck}>
          {state.phase === 'checking' ? 'Checking …' : 'Re-check'}
        </Button>
        <Button size="xs" data-testid="proposal-apply" disabled={blocker !== null} onClick={onApply}>
          {state.phase === 'applying' ? 'Applying …' : 'Apply all'}
        </Button>
      </div>
    </section>
  )
}

function ReviewRow({ row, selectable, onSelect }: { row: ProposalRow; selectable: boolean; onSelect: () => void }) {
  const added = row.mark === '+'
  const body = (
    <>
      <span className={cn('w-3 shrink-0 font-mono', added ? 'text-(--tc-emerald)' : 'text-(--tc-amber)')}>{row.mark}</span>
      <span className="min-w-0 flex-1">
        <span className="font-mono text-[11px] break-all">{row.target}</span>
        <span className="text-muted-foreground"> {row.detail}</span>
        {row.change !== undefined && (
          <span className="block break-words text-muted-foreground">
            {row.change.before !== undefined && <>“{row.change.before}” → </>}
            <span className="text-foreground">“{row.change.after}”</span>
          </span>
        )}
        {row.refusal !== undefined && (
          <span data-testid="proposal-row-refusal" className="block break-words text-destructive">
            {row.refusal.message} <span className="font-mono text-[10.5px]">({row.refusal.code})</span>
          </span>
        )}
        {row.warnings.map((warning, i) => (
          <span key={i} className="block break-words text-(--tc-amber)">{warning}</span>
        ))}
      </span>
    </>
  )
  const status = row.refusal !== undefined ? 'refused' : row.warnings.length > 0 ? 'warning' : 'ok'
  return (
    <li data-testid="proposal-row" data-step-id={row.stepId} data-status={status} title={row.reason}>
      {selectable ? (
        <button
          type="button"
          onClick={onSelect}
          className="flex w-full gap-1.5 rounded px-1 py-0.5 text-left hover:bg-muted/60"
          aria-label={`Show ${row.type.key} in the schema`}
        >
          {body}
        </button>
      ) : (
        <div className="flex gap-1.5 px-1 py-0.5">{body}</div>
      )}
    </li>
  )
}

function IssueList({ label, tone, items }: { label: string; tone: string; items: [string, string][] }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <ul className="space-y-0.5">
        {items.map(([path, message], i) => (
          <li key={i} className={cn('break-words', tone)}>
            {path !== '' && <code className="text-[10.5px] text-muted-foreground">{path}</code>} {message}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** What happened to the last Re-check or Apply, above the buttons. */
function Banners({ state, onRecheck }: { state: ReviewState; onRecheck: () => void }) {
  const banners: ReactNode[] = []
  if (state.stale !== null) {
    banners.push(
      <Banner key="stale" testId="proposal-stale" tone="amber">
        The schema changed since this check (rev {state.stale.checked.revision} → {state.stale.current.revision}). Nothing was written.
        <Button size="xs" variant="outline" className="ml-2" data-testid="proposal-stale-recheck" disabled={!recheckable(state)} onClick={onRecheck}>
          Re-check
        </Button>
      </Banner>,
    )
  }
  if (state.refused) {
    banners.push(
      <Banner key="refused" testId="proposal-refused" tone="red">
        Not applied, nothing was written.{' '}
        {state.check.refusals.length > 0 ? 'The refused steps show why.' : 'The proposal introduces the issues above.'}
      </Banner>,
    )
  }
  if (state.phase === 'confirming') {
    banners.push(<Banner key="lost" testId="proposal-lost" tone="amber">The answer to Apply was lost. Checking whether it was applied …</Banner>)
  } else if (state.lost === 'not-applied') {
    banners.push(
      <Banner key="lost" testId="proposal-lost" tone="amber">
        The answer to Apply was lost. The reloaded schema shows it was not applied. Re-check before you apply again.
      </Banner>,
    )
  } else if (state.lost === 'unknown') {
    banners.push(
      <Banner key="lost" testId="proposal-lost" tone="amber">
        The answer to Apply was lost, and the schema could not be reloaded. Reload the page to see whether it was applied.
      </Banner>,
    )
  }
  if (!state.fresh && state.lost === null && state.phase === 'ready') {
    banners.push(
      <Banner key="fresh" testId="proposal-recheck-needed" tone="amber">
        This proposal was checked in an earlier session. Re-check it against the current schema before you apply it.
      </Banner>,
    )
  } else if (state.edited && state.phase === 'ready') {
    banners.push(
      <Banner key="edited" testId="proposal-recheck-needed" tone="amber">
        The schema was edited here since this check. Re-check needed.
      </Banner>,
    )
  }
  if (state.error !== null) banners.push(<Banner key="error" testId="proposal-error" tone="red">{state.error}</Banner>)
  return banners.length === 0 ? null : <div className="grid gap-1.5">{banners}</div>
}

function Banner({ testId, tone, children }: { testId: string; tone: 'amber' | 'red'; children: ReactNode }) {
  return (
    <p
      role="status"
      data-testid={testId}
      className={cn(
        'rounded border px-2.5 py-1.5 break-words',
        tone === 'amber' ? 'border-amber-500/30 bg-amber-500/5' : 'border-destructive/30 bg-destructive/5 text-destructive',
      )}
    >
      {children}
    </p>
  )
}
