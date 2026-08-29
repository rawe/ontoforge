import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import * as model from '@/api/model'
import { ApiError } from '@/api/http'
import { qk } from '@/api/queryKeys'
import { AGENT_TOOL_NAMES, type AiAgent, type Lens } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { deriveKey, invalidateModeling, isValidKey, toastError } from './lib'
import { KeyField } from './shared'

interface AgentDialogProps {
  /** Modeling agent routes are addressed by lens KEY (not UUID). */
  lensKey: string
  /** null → create mode. */
  agent: AiAgent | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function AgentDialog({ lensKey, agent, open, onOpenChange }: AgentDialogProps) {
  const isEdit = agent !== null
  const queryClient = useQueryClient()

  const [key, setKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [allTools, setAllTools] = useState(true)
  const [tools, setTools] = useState<Set<string>>(new Set())
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setKey(agent?.key ?? '')
      setKeyTouched(isEdit)
      setName(agent?.name ?? '')
      setDescription(agent?.description ?? '')
      setSystemPrompt(agent?.systemPrompt ?? '')
      setAllTools(agent?.tools === null || agent?.tools === undefined)
      setTools(new Set(agent?.tools ?? []))
      setFieldErrors({})
    }
  }

  const save = useMutation({
    mutationFn: () =>
      model.upsertAiAgent(lensKey, key, {
        name: name.trim(),
        description: description.trim() === '' ? null : description.trim(),
        systemPrompt: systemPrompt.trim() === '' ? null : systemPrompt,
        tools: allTools ? null : [...tools],
      }),
    onSuccess: (saved) => {
      invalidateModeling(queryClient)
      toast.success(isEdit ? `Agent "${saved.key}" updated` : `Agent "${saved.key}" created`)
      onOpenChange(false)
    },
    onError: (error) => {
      if (error instanceof ApiError && error.fieldErrors !== undefined) {
        setFieldErrors(error.fieldErrors)
      }
      toastError(error)
    },
  })

  const valid =
    isValidKey(key) && name.trim() !== '' && (allTools || tools.size > 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit agent "${agent.key}"` : 'New agent'}</DialogTitle>
          <DialogDescription>
            Agents are AI personas for this lens, with their own system prompt and
            tool access.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid && !save.isPending) save.mutate()
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="agent-name">Name</Label>
            <Input
              id="agent-name"
              value={name}
              autoFocus
              onChange={(e) => {
                setName(e.target.value)
                if (!keyTouched) setKey(deriveKey(e.target.value))
              }}
              placeholder="Research Assistant"
            />
            {fieldErrors.name !== undefined && (
              <p className="text-xs text-destructive">{fieldErrors.name}</p>
            )}
          </div>
          <KeyField
            id="agent-key"
            value={key}
            onChange={(v) => {
              setKeyTouched(true)
              setKey(v)
            }}
            disabled={isEdit}
            error={fieldErrors.key}
          />
          <div className="grid gap-1.5">
            <Label htmlFor="agent-desc">Description</Label>
            <Textarea
              id="agent-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What is this agent for?"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="agent-prompt">System prompt</Label>
            <Textarea
              id="agent-prompt"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={6}
              className="font-mono text-xs"
              placeholder="You are a helpful assistant for…"
            />
          </div>
          <div className="grid gap-2">
            <label className="flex items-center gap-2 text-[13px] font-medium">
              <Switch checked={allTools} onCheckedChange={setAllTools} />
              All tools
            </label>
            {!allTools && (
              <div className="grid grid-cols-2 gap-1.5 rounded-lg border p-3">
                {AGENT_TOOL_NAMES.map((tool) => (
                  <label key={tool} className="flex items-center gap-2 text-[13px]">
                    <Checkbox
                      checked={tools.has(tool)}
                      onCheckedChange={(checked) => {
                        setTools((prev) => {
                          const next = new Set(prev)
                          if (checked === true) next.add(tool)
                          else next.delete(tool)
                          return next
                        })
                      }}
                    />
                    <span className="font-mono text-xs">{tool}</span>
                  </label>
                ))}
                {tools.size === 0 && (
                  <p className="col-span-2 text-xs text-destructive">
                    Select at least one tool.
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              {isEdit ? 'Save agent' : 'Create agent'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Agents tab: list of AI agent definitions + editor dialog. */
export function AgentsTab({ lens }: { lens: Lens }) {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<AiAgent | null>(null)
  const [toDelete, setToDelete] = useState<AiAgent | null>(null)

  // NOTE: modeling agent routes are key-addressed, unlike the other
  // /api/model/lenses/{id}/... routes.
  const agentsQuery = useQuery({
    queryKey: qk.model('lenses', lens.key, 'ai-agents'),
    queryFn: () => model.listAiAgents(lens.key),
  })
  const agents = agentsQuery.data

  const remove = useMutation({
    mutationFn: (agentKey: string) => model.deleteAiAgent(lens.key, agentKey),
    onSuccess: () => {
      invalidateModeling(queryClient)
      toast.success('Agent deleted')
    },
    onError: toastError,
  })

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[13px] font-semibold">AI agents</h3>
        <span className="text-[13px] text-muted-foreground">{agents?.length ?? 0}</span>
        <Button
          size="sm"
          className="ml-auto"
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          <Plus className="size-3.5" /> New agent
        </Button>
      </div>

      {agentsQuery.isPending && <Skeleton className="h-32 rounded-xl" />}

      {agents !== undefined && agents.length === 0 && (
        <EmptyState
          icon={Bot}
          title="No agents defined"
          description="Agents give the AI assistant a persona, a system prompt and a restricted tool set."
          action={
            <Button
              onClick={() => {
                setEditing(null)
                setDialogOpen(true)
              }}
            >
              <Plus className="size-4" /> New agent
            </Button>
          }
        />
      )}

      {agents !== undefined && agents.length > 0 && (
        <div className="space-y-2">
          {agents.map((agent) => (
            <div
              key={agent.key}
              className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3"
            >
              <Bot className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-medium">{agent.name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {agent.key}
                  </span>
                  <Badge variant="secondary" className="text-[10px]">
                    {agent.tools === null || agent.tools === undefined
                      ? 'All tools'
                      : `${agent.tools.length} tools`}
                  </Badge>
                </div>
                {agent.description !== null && agent.description !== undefined && (
                  <p className="truncate text-[12px] text-muted-foreground">
                    {agent.description}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Edit ${agent.key}`}
                onClick={() => {
                  setEditing(agent)
                  setDialogOpen(true)
                }}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${agent.key}`}
                onClick={() => setToDelete(agent)}
              >
                <Trash2 className="size-3.5 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <AgentDialog
        lensKey={lens.key}
        agent={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />

      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete agent "{toDelete?.key ?? ''}"?</AlertDialogTitle>
            <AlertDialogDescription>
              The agent definition is removed from this lens. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (toDelete !== null) remove.mutate(toDelete.key)
              }}
            >
              Delete agent
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
