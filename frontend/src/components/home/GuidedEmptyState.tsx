import { ArrowRight, Cable, Plus, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { SchemaEntityType } from '@/api/types'
import { Button } from '@/components/ui/button'
import { McpConnectDialog } from './McpConnectDialog'

function Step({
  number,
  icon,
  title,
  description,
  action,
  dimmed = false,
}: {
  number: number
  icon: ReactNode
  title: string
  description: string
  action: ReactNode
  dimmed?: boolean
}) {
  return (
    <li
      className={`flex items-start gap-4 rounded-xl border bg-card p-5 ${dimmed ? 'opacity-60' : ''}`}
    >
      <span className="flex size-7 shrink-0 select-none items-center justify-center rounded-full border bg-muted/60 text-[13px] font-semibold tabular-nums">
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {title}
        </h3>
        <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>
        <div className="mt-3">{action}</div>
      </div>
    </li>
  )
}

/**
 * Full-body guided empty state shown when the lens has zero instances:
 * three numbered ways to get data in.
 */
export function GuidedEmptyState({
  ontologyKey,
  lensKey,
  lensName,
  entityTypes,
  aiEnabled,
}: {
  ontologyKey: string
  lensKey: string
  lensName: string
  entityTypes: readonly SchemaEntityType[]
  aiEnabled: boolean
}) {
  const first = entityTypes[0]
  return (
    <div className="mx-auto max-w-2xl px-6 py-14">
      <div className="text-center">
        <h2 className="text-lg font-semibold tracking-tight">
          {lensName} is ready — now add some knowledge
        </h2>
        <p className="mx-auto mt-1.5 max-w-md text-[13px] text-muted-foreground">
          The schema is in place but no entities exist yet. Three ways to get data into
          this lens:
        </p>
      </div>
      <ol className="mt-8 space-y-3">
        {first !== undefined && (
          <Step
            number={1}
            icon={<Plus className="size-4 text-muted-foreground" />}
            title="Add your first entity"
            description={`Start small: create a ${first.displayName.toLowerCase()} by hand, or press ⌘K to add from anywhere.`}
            action={
              <Button asChild size="sm">
                <Link to={`/o/${ontologyKey}/w/${lensKey}/t/${first.key}`}>
                  Open {first.displayName} table
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            }
          />
        )}
        <Step
          number={2}
          icon={<Sparkles className="size-4 text-muted-foreground" />}
          title="Extract from text"
          description={
            aiEnabled
              ? 'Paste notes, docs or emails and let the AI propose entities and relations that fit your schema — you review before anything is saved.'
              : 'AI extraction turns pasted text into entities and relations, but no AI provider is configured on this server.'
          }
          dimmed={!aiEnabled}
          action={
            aiEnabled ? (
              <Button asChild size="sm" variant="outline">
                <Link to={`/o/${ontologyKey}/w/${lensKey}/ai`}>
                  Open AI extract
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">
                Set an AI provider in the backend configuration to enable this.
              </span>
            )
          }
        />
        <Step
          number={3}
          icon={<Cable className="size-4 text-muted-foreground" />}
          title="Connect your AI tools"
          description="Let Claude or any MCP-capable agent read and write this lens directly via the built-in MCP servers."
          action={
            <McpConnectDialog
              ontologyKey={ontologyKey}
              lensKey={lensKey}
              trigger={
                <Button size="sm" variant="outline">
                  View MCP config
                </Button>
              }
            />
          }
        />
      </ol>
    </div>
  )
}
