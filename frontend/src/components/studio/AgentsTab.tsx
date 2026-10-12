import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useFeatures } from '@/api/hooks'
import * as model from '@/api/model'
import { qk } from '@/api/queryKeys'
import { AGENT_TOOL_NAMES, type Agent, type AgentInput, type Lens } from '@/api/types'
import { AgentChat } from '@/components/assistants/agents/AgentChat'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { AssistantActionBar } from './assistants/AssistantActionBar'
import { AssistantCard } from './assistants/AssistantCard'
import { AssistantDefaultPage, AssistantEditorPage } from './assistants/AssistantEditorPage'
import { AssistantIdentitySection } from './assistants/AssistantIdentitySection'
import { AssistantList, AssistantLoadError, AssistantLoading, AssistantNotFound } from './assistants/AssistantList'
import { AssistantTestPanel } from './assistants/AssistantTestPanel'
import {
  ASSISTANT_DEFAULT, ASSISTANT_NEW, assistantErrorLines, assistantKeyError, assistantStatus,
} from './assistants/assistantModel'
import { useAssistantLeaveGuard } from './assistants/useAssistantLeaveGuard'
import { invalidateModeling, isValidLensResourceKey } from './lib'

const TAB = 'agents'
const PARAM = 'agent'

/**
 * Lens detail → Agents: the lens's agents (list, with the built-in Default),
 * the editor of one (`?agent=<key>`, `?agent=new` for a draft,
 * `?agent=_default` for the Default's read-only page) and its test chat.
 */
export function AgentsTab({ ontologyKey, lens }: { ontologyKey: string; lens: Lens }) {
  const features = useFeatures().data
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedKey = searchParams.get(PARAM)
  const queryClient = useQueryClient()
  // Each save remounts the editor and its test chat: agents carry no `updatedAt`.
  const [saves, setSaves] = useState(0)

  // NOTE: modeling agent routes are key-addressed, unlike the other
  // /api/ontologies/{key}/model/lenses/{id}/... routes.
  const listKey = qk.model(ontologyKey, 'lenses', lens.key, 'assistants', 'agents')
  const agents = useQuery({
    queryKey: listKey,
    queryFn: () => model.listAgents(ontologyKey, lens.key),
  })

  const select = (key: string | null) =>
    setSearchParams(key === null ? { tab: TAB } : { tab: TAB, [PARAM]: key }, { replace: true })

  if (agents.isPending) return <AssistantLoading />
  if (agents.error || !agents.data) {
    return <AssistantLoadError kind="agents" error={agents.error} onReload={() => void agents.refetch()} />
  }

  const aiEnabled = features?.ai !== false
  if (selectedKey === ASSISTANT_DEFAULT) {
    return (
      <AssistantDefaultPage
        kind="agents"
        onBack={() => select(null)}
        onNew={() => select(ASSISTANT_NEW)}
        test={
          <AssistantTestPanel kind="agents" aiEnabled={aiEnabled} hint="Ask the built-in default and watch its tool calls and the entities it meets.">
            {(actions) => (
              <AgentChat
                ontologyKey={ontologyKey}
                lensKey={lens.key}
                agentKey={ASSISTANT_DEFAULT}
                name="Default"
                description={null}
                blockedReason={null}
                remember={false}
                actions={actions}
              />
            )}
          </AssistantTestPanel>
        }
      />
    )
  }

  // The saved agent goes into the list before the page remounts on it; the refetch follows.
  const onSaved = (saved: Agent) => {
    queryClient.setQueryData<Agent[]>(listKey, (list = []) =>
      list.some((a) => a.key === saved.key) ? list.map((a) => (a.key === saved.key ? saved : a)) : [...list, saved])
    setSaves((n) => n + 1)
    invalidateModeling(queryClient)
  }
  const common = {
    ontologyKey, lensKey: lens.key, aiEnabled, existingKeys: agents.data.map((a) => a.key), onClose: () => select(null),
  }
  if (selectedKey === ASSISTANT_NEW) {
    return <AgentPage key={ASSISTANT_NEW} {...common} agent={null} onSaved={(saved) => { onSaved(saved); select(saved.key) }} />
  }
  if (selectedKey !== null) {
    const agent = agents.data.find((a) => a.key === selectedKey)
    if (agent === undefined) return <AssistantNotFound kind="agents" assistantKey={selectedKey} onBack={() => select(null)} />
    return (
      <AgentPage
        key={`${agent.key}:${saves}`}
        {...common}
        agent={agent}
        onSaved={onSaved}
        onDeleted={() => {
          queryClient.setQueryData<Agent[]>(listKey, (list) => list?.filter((a) => a.key !== agent.key))
          invalidateModeling(queryClient)
          select(null)
        }}
      />
    )
  }

  return (
    <AssistantList
      kind="agents"
      count={agents.data.length}
      emptyText="Create one to give the AI assistant a persona, a system prompt and a restricted tool set, save it and test it here."
      onNew={() => select(ASSISTANT_NEW)}
      onOpenDefault={() => select(ASSISTANT_DEFAULT)}
    >
      {agents.data.map((agent) => (
        <AssistantCard
          key={agent.key}
          name={agent.name}
          assistantKey={agent.key}
          badges={<Badge variant="secondary" className="text-[10px]">{agent.tools == null ? 'All tools' : `${agent.tools.length} tools`}</Badge>}
          description={agent.description}
          onOpen={() => select(agent.key)}
        />
      ))}
    </AssistantList>
  )
}

/** What the editor changes of an agent; `tools` is kept while "All tools" is on. */
interface AgentDraft {
  name: string
  description: string
  systemPrompt: string
  allTools: boolean
  tools: string[]
}

function draftOf(agent: Agent | null): AgentDraft {
  return {
    name: agent?.name ?? '',
    description: agent?.description ?? '',
    systemPrompt: agent?.systemPrompt ?? '',
    allTools: agent?.tools == null,
    tools: agent?.tools ?? [],
  }
}

function sameDraft(a: AgentDraft, b: AgentDraft): boolean {
  return a.name === b.name && a.description === b.description && a.systemPrompt === b.systemPrompt
    && a.allTools === b.allTools && (a.allTools || (a.tools.length === b.tools.length && a.tools.every((t) => b.tools.includes(t))))
}

function toInput(draft: AgentDraft): AgentInput {
  return {
    name: draft.name.trim(),
    description: draft.description.trim() === '' ? null : draft.description.trim(),
    systemPrompt: draft.systemPrompt.trim() === '' ? null : draft.systemPrompt,
    tools: draft.allTools ? null : draft.tools,
  }
}

interface AgentPageProps {
  ontologyKey: string
  lensKey: string
  aiEnabled: boolean
  existingKeys: string[]
  /** The saved agent; null for a new one. */
  agent: Agent | null
  onSaved: (agent: Agent) => void
  onDeleted?: () => void
  onClose: () => void
}

/**
 * Draft + Save editor of one agent with its test chat. Remount it (React
 * `key`) to re-seed the draft from a newer saved version.
 */
function AgentPage({ ontologyKey, lensKey, aiEnabled, existingKeys, agent, onSaved, onDeleted, onClose }: AgentPageProps) {
  const isNew = agent === null
  const baseline = useMemo(() => draftOf(agent), [agent])
  const [draft, setDraft] = useState<AgentDraft>(baseline)
  const [key, setKey] = useState(agent?.key ?? '')
  const [busy, setBusy] = useState(false)
  const [saveErrors, setSaveErrors] = useState<string[]>([])
  const [failed, setFailed] = useState<'save' | 'delete'>('save')

  const dirty = !sameDraft(draft, baseline) || (isNew && key !== '')
  const keyValid = !isNew || (isValidLensResourceKey(key) && assistantKeyError(key, existingKeys, 'Agent') === undefined)
  const valid = draft.name.trim() !== '' && (draft.allTools || draft.tools.length > 0) && keyValid
  const canSave = (dirty || isNew) && valid && !busy
  const blockedReason = isNew ? 'Save this agent to test it.'
    : dirty ? 'Unsaved changes. Save them to test; questions use the saved configuration.'
      : null
  const title = draft.name.trim() || agent?.name || 'New agent'
  const { leave, dialog } = useAssistantLeaveGuard(dirty, title)

  const edit = (patch: Partial<AgentDraft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setSaveErrors([])
  }
  const toggleTool = (tool: string, on: boolean) =>
    edit({ tools: on ? [...draft.tools, tool] : draft.tools.filter((t) => t !== tool) })

  async function save() {
    setBusy(true)
    setSaveErrors([])
    try {
      const saved = await model.upsertAgent(ontologyKey, lensKey, key, toInput(draft))
      toast.success(isNew ? `Agent "${saved.name}" created` : `Agent "${saved.name}" saved`)
      if (isNew) leave(() => onSaved(saved))
      else onSaved(saved)
    } catch (error) {
      setFailed('save')
      setSaveErrors(assistantErrorLines(error))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (agent === null) return
    setBusy(true)
    try {
      await model.deleteAgent(ontologyKey, lensKey, agent.key)
      toast.success(`Agent "${agent.name}" deleted`)
      leave(() => onDeleted?.())
    } catch (error) {
      setFailed('delete')
      setSaveErrors(assistantErrorLines(error))
      setBusy(false)
    }
  }

  return (
    <AssistantEditorPage
      kind="agents"
      title={title}
      assistantKey={agent?.key ?? null}
      status={assistantStatus({ isNew, dirty, invalid: false })}
      onBack={onClose}
      test={
        <AssistantTestPanel kind="agents" aiEnabled={aiEnabled} hint="Ask the saved version and watch its tool calls and the entities it meets. Saving starts a new conversation.">
          {(actions) => (
            <AgentChat
              ontologyKey={ontologyKey}
              lensKey={lensKey}
              agentKey={agent?.key ?? null}
              name={agent?.name ?? title}
              description={agent?.description ?? null}
              blockedReason={blockedReason}
              remember={false}
              actions={actions}
            />
          )}
        </AssistantTestPanel>
      }
    >
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (canSave) void save() }}>
        <AssistantActionBar
          kind="agents"
          isNew={isNew}
          dirty={dirty}
          canSave={canSave}
          busy={busy}
          name={agent?.name ?? ''}
          errors={saveErrors}
          failed={failed}
          onDiscard={() => { setDraft(baseline); setSaveErrors([]) }}
          onDelete={() => void remove()}
        />
        <AssistantIdentitySection
          kind="agents"
          isNew={isNew}
          name={draft.name}
          assistantKey={key}
          description={draft.description}
          existingKeys={existingKeys}
          disabled={busy}
          namePlaceholder="Research Assistant"
          descriptionHint="What this agent is for; shown in the Workbench."
          onName={(name) => edit({ name })}
          onKey={setKey}
          onDescription={(description) => edit({ description })}
        />
        <section className="grid gap-4 rounded-xl border bg-card p-4">
          <h3 className="text-[13px] font-semibold">Behaviour</h3>
          <div className="grid gap-1.5">
            <Label htmlFor="agent-prompt">System prompt</Label>
            <Textarea
              id="agent-prompt"
              value={draft.systemPrompt}
              disabled={busy}
              onChange={(e) => edit({ systemPrompt: e.target.value })}
              rows={6}
              className="font-mono text-xs"
              placeholder="You are a helpful assistant for…"
            />
          </div>
          <div className="grid gap-2">
            <label className="flex items-center gap-2 text-[13px] font-medium">
              <Switch checked={draft.allTools} disabled={busy} onCheckedChange={(allTools) => edit({ allTools })} />
              All tools
            </label>
            {!draft.allTools && (
              <div className="grid grid-cols-2 gap-1.5 rounded-lg border p-3">
                {AGENT_TOOL_NAMES.map((tool) => (
                  <label key={tool} className="flex items-center gap-2 text-[13px]">
                    <Checkbox checked={draft.tools.includes(tool)} disabled={busy} onCheckedChange={(checked) => toggleTool(tool, checked === true)} />
                    <span className="font-mono text-xs">{tool}</span>
                  </label>
                ))}
                {draft.tools.length === 0 && <p className="col-span-2 text-xs text-destructive">Select at least one tool.</p>}
              </div>
            )}
          </div>
        </section>
      </form>
      {dialog}
    </AssistantEditorPage>
  )
}
