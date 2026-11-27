import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Plus, ScrollText, Trash2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import * as model from '@/api/model'
import { qk } from '@/api/queryKeys'
import type { Lens, RuntimeSkill } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { DocumentEditor } from '@/components/schema/DocumentEditor'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { ASSISTANT_STATUS_TEXT, assistantErrorLines, assistantStatus } from './assistants/assistantModel'
import { useAssistantLeaveGuard } from './assistants/useAssistantLeaveGuard'
import { invalidateModeling } from './lib'
import { RuntimeSkillExplainerButton } from './skills/RuntimeSkillExplainer'
import {
  MAX_SKILL_DESCRIPTION_LENGTH, SKILL_NEW, characters, skillContentProblem, skillDescriptionProblem, skillKeyProblem,
} from './skills/runtimeSkillModel'

const TAB = 'skills'
const PARAM = 'skill'

/**
 * Lens detail → Skills: the lens's runtime skills (list) and the editor of
 * one (`?skill=<key>`, `?skill=_new` for a draft).
 */
export function RuntimeSkillsTab({ ontologyKey, lens }: { ontologyKey: string; lens: Lens }) {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedKey = searchParams.get(PARAM)
  // Each save remounts the editor on the saved version.
  const [saves, setSaves] = useState(0)

  // NOTE: modeling runtime-skill routes are key-addressed, like search profiles.
  const listKey = qk.model(ontologyKey, 'lenses', lens.key, 'skills')
  const skills = useQuery({
    queryKey: listKey,
    queryFn: () => model.listRuntimeSkills(ontologyKey, lens.key),
  })

  const select = (key: string | null) =>
    setSearchParams(key === null ? { tab: TAB } : { tab: TAB, [PARAM]: key }, { replace: true })

  if (skills.isPending) return <div className="space-y-3"><Skeleton className="h-8 w-64" /><Skeleton className="h-40 rounded-xl" /></div>
  if (skills.error || !skills.data) {
    return (
      <div className="text-sm">
        <p role="alert" className="text-destructive">Could not load runtime skills: {assistantErrorLines(skills.error).join(' ')}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void skills.refetch()}>Reload</Button>
      </div>
    )
  }

  // The saved skill goes into the list before the editor remounts on it; the refetch follows.
  const onSaved = (saved: RuntimeSkill) => {
    queryClient.setQueryData<RuntimeSkill[]>(listKey, (list = []) =>
      list.some((s) => s.key === saved.key) ? list.map((s) => (s.key === saved.key ? saved : s)) : [...list, saved])
    setSaves((n) => n + 1)
    invalidateModeling(queryClient)
  }
  const common = {
    ontologyKey, lensKey: lens.key, existingKeys: skills.data.map((s) => s.key), onClose: () => select(null),
  }
  if (selectedKey === SKILL_NEW) {
    return <RuntimeSkillPage key={`${lens.key}:${SKILL_NEW}`} {...common} skill={null} onSaved={(saved) => { onSaved(saved); select(saved.key) }} />
  }
  if (selectedKey !== null) {
    const skill = skills.data.find((s) => s.key === selectedKey)
    if (skill === undefined) {
      return (
        <EmptyState
          icon={ScrollText}
          title="Runtime skill not found"
          description={`This lens has no runtime skill ${selectedKey}. It may have been deleted.`}
          action={<Button variant="outline" onClick={() => select(null)}>All runtime skills</Button>}
        />
      )
    }
    return (
      <RuntimeSkillPage
        key={`${lens.key}:${skill.key}:${saves}`}
        {...common}
        skill={skill}
        onSaved={onSaved}
        onDeleted={() => {
          queryClient.setQueryData<RuntimeSkill[]>(listKey, (list) => list?.filter((s) => s.key !== skill.key))
          invalidateModeling(queryClient)
          select(null)
        }}
      />
    )
  }

  const list = skills.data
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-semibold">Runtime skills</h3>
        <span className="text-[13px] text-muted-foreground">{list.length}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <RuntimeSkillExplainerButton labeled />
          <Button size="sm" data-testid="skill-new" onClick={() => select(SKILL_NEW)}><Plus className="size-3.5" /> New runtime skill</Button>
        </div>
      </div>
      {list.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No runtime skills"
          description="A runtime skill guides MCP clients connected to this lens: they list it by its description and load its instructions when a task calls for them."
          action={<Button onClick={() => select(SKILL_NEW)}><Plus className="size-4" /> New runtime skill</Button>}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {list.map((skill) => (
            <button
              key={skill.key}
              type="button"
              data-testid={`skill-card-${skill.key}`}
              onClick={() => select(skill.key)}
              className="rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/40"
            >
              <span className="font-mono text-[13px] font-semibold">{skill.key}</span>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{skill.description}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface RuntimeSkillPageProps {
  ontologyKey: string
  lensKey: string
  existingKeys: string[]
  /** The saved skill; null for a new one. */
  skill: RuntimeSkill | null
  onSaved: (skill: RuntimeSkill) => void
  onDeleted?: () => void
  onClose: () => void
}

/**
 * Draft + Save editor of one runtime skill. Remount it (React `key`) to
 * re-seed the draft from a newer saved version. The key is typed — a skill
 * has no name to derive it from — and fixed once saved.
 */
function RuntimeSkillPage({ ontologyKey, lensKey, existingKeys, skill, onSaved, onDeleted, onClose }: RuntimeSkillPageProps) {
  const isNew = skill === null
  const [key, setKey] = useState(skill?.key ?? '')
  const [description, setDescription] = useState(skill?.description ?? '')
  const [content, setContent] = useState(skill?.content ?? '')
  // A required field's "empty" message waits until the field was edited.
  const [touched, setTouched] = useState<{ description?: boolean; content?: boolean }>({})
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [failed, setFailed] = useState<'save' | 'delete'>('save')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const dirty = isNew
    ? key !== '' || description !== '' || content !== ''
    : description !== skill.description || content !== skill.content
  const keyProblem = isNew ? skillKeyProblem(key, existingKeys) : undefined
  const descriptionProblem = skillDescriptionProblem(description)
  const contentProblem = skillContentProblem(content)
  const showDescriptionProblem = descriptionProblem !== undefined && (description !== '' || touched.description === true)
  const showContentProblem = contentProblem !== undefined && touched.content === true
  const valid = key !== '' && keyProblem === undefined && descriptionProblem === undefined && contentProblem === undefined
  const canSave = (dirty || isNew) && valid && !busy
  const title = isNew ? 'New runtime skill' : skill.key
  const status = ASSISTANT_STATUS_TEXT[assistantStatus({ isNew, dirty, invalid: false })]
  const { leave, dialog } = useAssistantLeaveGuard(dirty, isNew ? 'The new runtime skill' : `Runtime skill "${skill.key}"`)

  async function save() {
    setBusy(true)
    setErrors([])
    try {
      const saved = await model.upsertRuntimeSkill(ontologyKey, lensKey, key, { description, content })
      toast.success(isNew ? `Runtime skill "${saved.key}" created` : `Runtime skill "${saved.key}" saved`)
      if (isNew) leave(() => onSaved(saved))
      else onSaved(saved)
    } catch (error) {
      setFailed('save')
      setErrors(assistantErrorLines(error))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (skill === null) return
    setBusy(true)
    try {
      await model.deleteRuntimeSkill(ontologyKey, lensKey, skill.key)
      toast.success(`Runtime skill "${skill.key}" deleted`)
      leave(() => onDeleted?.())
    } catch (error) {
      setFailed('delete')
      setErrors(assistantErrorLines(error))
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" className="-ml-2 h-7 gap-1 text-xs text-muted-foreground" onClick={onClose}>
          <ChevronLeft className="size-3.5" /> All runtime skills
        </Button>
        <h2 className={cn('text-[14px] font-semibold', !isNew && 'font-mono')} title={isNew ? undefined : 'Immutable key'}>{title}</h2>
        <RuntimeSkillExplainerButton className="-ml-1.5" />
        <span className={`text-xs ${status.className}`} data-testid="skill-status">{status.text}</span>
      </div>

      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (canSave) void save() }}>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" data-testid="skill-save" disabled={!canSave}>{isNew ? 'Create runtime skill' : 'Save'}</Button>
          {!isNew && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!dirty || busy}
              onClick={() => {
                setDescription(skill.description)
                setContent(skill.content)
                setTouched({})
                setErrors([])
              }}
            >
              Discard changes
            </Button>
          )}
          {!isNew && (
            <Button type="button" size="sm" variant="ghost" className="ml-auto text-destructive" data-testid="skill-delete" disabled={busy} onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-3.5" /> Delete
            </Button>
          )}
        </div>
        {errors.length > 0 && (
          <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
            <p className="font-medium text-destructive">{failed === 'delete' ? 'Not deleted:' : 'Not saved:'}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">{errors.map((line, i) => <li key={i} className="whitespace-pre-wrap break-words">{line}</li>)}</ul>
          </div>
        )}

        <section className="grid gap-4 rounded-xl border bg-card p-4">
          <div className="grid gap-1.5 sm:max-w-md">
            <Label htmlFor="skill-key">Key</Label>
            <Input
              id="skill-key"
              value={key}
              disabled={!isNew || busy}
              autoFocus={isNew}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => { setKey(e.target.value); setErrors([]) }}
              className={cn('font-mono', keyProblem !== undefined && 'border-destructive')}
              aria-invalid={keyProblem !== undefined}
            />
            {keyProblem !== undefined && <p className="text-xs text-destructive" data-testid="skill-key-problem">{keyProblem}</p>}
            <p className="text-xs text-muted-foreground">
              {isNew
                ? 'The skill\'s name in MCP clients: 1 to 64 lowercase letters, digits and single hyphens. Permanent — the key cannot be changed later.'
                : 'The skill\'s name in MCP clients. The key is immutable.'}
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="skill-description">Description</Label>
            <Textarea
              id="skill-description"
              rows={3}
              value={description}
              disabled={busy}
              placeholder="What the skill helps with and when to use it"
              onChange={(e) => { setDescription(e.target.value); setTouched((t) => ({ ...t, description: true })); setErrors([]) }}
              className={cn(showDescriptionProblem && 'border-destructive')}
              aria-invalid={showDescriptionProblem}
            />
            <div className="flex flex-wrap items-start gap-x-3">
              <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                A client shows it and chooses the skill by it, so it says what the skill helps with and when to use it.
              </p>
              <span className={cn('text-xs tabular-nums', characters(description) > MAX_SKILL_DESCRIPTION_LENGTH ? 'text-destructive' : 'text-muted-foreground')}>
                {characters(description)} / {MAX_SKILL_DESCRIPTION_LENGTH}
              </span>
            </div>
            {showDescriptionProblem && <p className="text-xs text-destructive" data-testid="skill-description-problem">{descriptionProblem}</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="skill-content">Content</Label>
            <DocumentEditor
              id="skill-content"
              value={content}
              disabled={busy}
              rows={16}
              invalid={showContentProblem}
              onChange={(value) => { setContent(value); setTouched((t) => ({ ...t, content: true })); setErrors([]) }}
            />
            <p className="text-xs text-muted-foreground">
              The instructions, in Markdown. The client loads them when a task calls for the skill.
            </p>
            {showContentProblem && <p className="text-xs text-destructive" data-testid="skill-content-problem">{contentProblem}</p>}
          </div>
        </section>
      </form>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete runtime skill "{skill?.key ?? ''}"?</AlertDialogTitle>
            <AlertDialogDescription>
              It is removed from this lens, and MCP clients connected to the lens no longer find it. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void remove()}>Delete runtime skill</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {dialog}
    </div>
  )
}
