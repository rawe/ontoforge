import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useFeatures, useNavigators, useRuntimeSchema } from '@/api/hooks'
import { deleteNavigator, saveNavigator, type Navigator } from '@/api/navigators'
import { qk } from '@/api/queryKeys'
import type { Lens, RuntimeSchema } from '@/api/types'
import { NavigatorChat } from '@/components/assistants/navigators/NavigatorChat'
import { NavigatorEditor } from '@/components/assistants/navigators/NavigatorEditor'
import { configLine, draftOf, draftProblems, sameDraft, toWrite, type NavigatorDraft } from '@/components/assistants/navigators/navigatorDraft'
import { AssistantActionBar } from './assistants/AssistantActionBar'
import { AssistantCard, AssistantValidityBadges } from './assistants/AssistantCard'
import { AssistantDefaultPage, AssistantEditorPage } from './assistants/AssistantEditorPage'
import { AssistantIdentitySection } from './assistants/AssistantIdentitySection'
import { AssistantList, AssistantLoadError, AssistantLoading, AssistantNotFound } from './assistants/AssistantList'
import { AssistantTestPanel } from './assistants/AssistantTestPanel'
import {
  ASSISTANT_DEFAULT, ASSISTANT_NEW, assistantErrorLines, assistantKeyError, assistantStatus,
} from './assistants/assistantModel'
import { useAssistantLeaveGuard } from './assistants/useAssistantLeaveGuard'
import { isValidLensResourceKey } from './lib'
import { ValidationPanel } from './ValidationPanel'

const TAB = 'navigators'
const PARAM = 'navigator'

/**
 * Lens detail → Navigators: the lens's navigators (list, with the built-in
 * Default), the editor of one (`?navigator=<key>`, `?navigator=new` for a
 * draft, `?navigator=_default` for the Default's read-only page) and its test chat.
 */
export function NavigatorsTab({ ontologyKey, lens }: { ontologyKey: string; lens: Lens }) {
  const features = useFeatures().data
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedKey = searchParams.get(PARAM)
  const navigators = useNavigators(ontologyKey, lens.key)
  const schema = useRuntimeSchema(ontologyKey, lens.key)
  const queryClient = useQueryClient()

  const select = (key: string | null) =>
    setSearchParams(key === null ? { tab: TAB } : { tab: TAB, [PARAM]: key }, { replace: true })
  // The Workbench's runtime list follows the modeling list.
  const refresh = () => Promise.all([qk.navigators(ontologyKey, lens.key), qk.assistants(ontologyKey, lens.key, 'navigators')]
    .map((queryKey) => queryClient.invalidateQueries({ queryKey })))

  if (navigators.isPending || schema.isPending) return <AssistantLoading />
  if (navigators.error || schema.error || !navigators.data || !schema.data) {
    return <AssistantLoadError kind="navigators" error={navigators.error ?? schema.error} onReload={() => { void navigators.refetch(); void schema.refetch() }} />
  }

  const aiEnabled = features?.ai !== false
  if (selectedKey === ASSISTANT_DEFAULT) {
    return (
      <AssistantDefaultPage
        kind="navigators"
        onBack={() => select(null)}
        onNew={() => select(ASSISTANT_NEW)}
        test={
          <AssistantTestPanel kind="navigators" aiEnabled={aiEnabled} hint="Ask the built-in default and watch its steps and evidence.">
            {(actions) => (
              <NavigatorChat
                ontologyKey={ontologyKey}
                lensKey={lens.key}
                navigatorKey={ASSISTANT_DEFAULT}
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

  const common = {
    ontologyKey, lensKey: lens.key, schema: schema.data, aiEnabled,
    existingKeys: navigators.data.map((n) => n.key), onClose: () => select(null),
  }
  if (selectedKey === ASSISTANT_NEW) {
    return <NavigatorPage key={ASSISTANT_NEW} {...common} navigator={null} onSaved={(saved) => void refresh().then(() => select(saved.key))} />
  }
  if (selectedKey !== null) {
    const navigator = navigators.data.find((n) => n.key === selectedKey)
    if (navigator === undefined) return <AssistantNotFound kind="navigators" assistantKey={selectedKey} onBack={() => select(null)} />
    return (
      <NavigatorPage
        key={`${navigator.key}:${navigator.updatedAt}`}
        {...common}
        navigator={navigator}
        onSaved={(saved) => {
          queryClient.setQueryData<Navigator[]>(qk.navigators(ontologyKey, lens.key), (list) => list?.map((n) => (n.key === saved.key ? saved : n)))
          void refresh()
        }}
        onDeleted={() => {
          queryClient.setQueryData<Navigator[]>(qk.navigators(ontologyKey, lens.key), (list) => list?.filter((n) => n.key !== navigator.key))
          select(null)
          void refresh()
        }}
      />
    )
  }

  return (
    <AssistantList
      kind="navigators"
      count={navigators.data.length}
      emptyText="Create one to choose the relations it may follow, save it and test it here."
      onNew={() => select(ASSISTANT_NEW)}
      onOpenDefault={() => select(ASSISTANT_DEFAULT)}
    >
      {navigators.data.map((navigator) => (
        <AssistantCard
          key={navigator.key}
          name={navigator.name}
          assistantKey={navigator.key}
          badges={<AssistantValidityBadges valid={navigator.validation.valid} warnings={navigator.validation.warnings.length} />}
          description={navigator.description}
          summary={configLine(navigator)}
          onOpen={() => select(navigator.key)}
        />
      ))}
    </AssistantList>
  )
}

interface NavigatorPageProps {
  ontologyKey: string
  lensKey: string
  schema: RuntimeSchema
  aiEnabled: boolean
  existingKeys: string[]
  /** The saved navigator; null for a new one. */
  navigator: Navigator | null
  onSaved: (navigator: Navigator) => void
  onDeleted?: () => void
  onClose: () => void
}

/**
 * Draft + Save editor of one navigator with its test chat. Remount it
 * (React `key`) to re-seed the draft from a newer saved version.
 */
function NavigatorPage({ ontologyKey, lensKey, schema, aiEnabled, existingKeys, navigator, onSaved, onDeleted, onClose }: NavigatorPageProps) {
  const isNew = navigator === null
  const baseline = useMemo(() => draftOf(navigator), [navigator])
  const [draft, setDraft] = useState<NavigatorDraft>(baseline)
  const [key, setKey] = useState(navigator?.key ?? '')
  const [busy, setBusy] = useState(false)
  const [saveErrors, setSaveErrors] = useState<string[]>([])
  const [failed, setFailed] = useState<'save' | 'delete'>('save')

  const dirty = !sameDraft(draft, baseline) || (isNew && key !== '')
  const problems = draftProblems(draft)
  const keyValid = !isNew || (isValidLensResourceKey(key) && assistantKeyError(key, existingKeys, 'Navigator') === undefined)
  const canSave = (dirty || isNew) && Object.keys(problems).length === 0 && keyValid && !busy
  const blockedReason = navigator === null ? 'Save this navigator to test it.'
    : dirty ? 'Unsaved changes. Save them to test; questions use the saved configuration.'
      : !navigator.validation.valid ? 'This navigator is invalid in the current lens. Repair and save it before asking.'
        : null
  const title = draft.name.trim() || navigator?.name || 'New navigator'
  const { leave, dialog } = useAssistantLeaveGuard(dirty, title)

  const edit = (patch: Partial<NavigatorDraft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setSaveErrors([])
  }

  async function save() {
    setBusy(true)
    setSaveErrors([])
    try {
      const saved = await saveNavigator(ontologyKey, lensKey, key, toWrite(draft))
      toast.success(isNew ? `Navigator "${saved.name}" created` : `Navigator "${saved.name}" saved`)
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
    if (navigator === null) return
    setBusy(true)
    try {
      await deleteNavigator(ontologyKey, lensKey, navigator.key)
      toast.success(`Navigator "${navigator.name}" deleted`)
      leave(() => onDeleted?.())
    } catch (error) {
      setFailed('delete')
      setSaveErrors(assistantErrorLines(error))
      setBusy(false)
    }
  }

  return (
    <AssistantEditorPage
      kind="navigators"
      title={title}
      assistantKey={navigator?.key ?? null}
      status={assistantStatus({ isNew, dirty, invalid: navigator !== null && !navigator.validation.valid })}
      onBack={onClose}
      test={
        <AssistantTestPanel kind="navigators" aiEnabled={aiEnabled} hint="Ask the saved version and watch its steps and evidence. Saving starts a new conversation.">
          {(actions) => (
            <NavigatorChat
              key={navigator ? `${navigator.key}:${navigator.updatedAt}` : ASSISTANT_NEW}
              ontologyKey={ontologyKey}
              lensKey={lensKey}
              navigatorKey={navigator?.key ?? null}
              name={navigator?.name ?? title}
              description={navigator?.description ?? null}
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
          kind="navigators"
          isNew={isNew}
          dirty={dirty}
          canSave={canSave}
          busy={busy}
          name={navigator?.name ?? ''}
          errors={saveErrors}
          failed={failed}
          onDiscard={() => { setDraft(baseline); setSaveErrors([]) }}
          onDelete={() => void remove()}
        />
        {navigator && (!navigator.validation.valid || navigator.validation.warnings.length > 0) && (
          <ValidationPanel result={{
            valid: navigator.validation.valid,
            errors: navigator.validation.errors.map((message) => ({ path: '', message })),
            warnings: navigator.validation.warnings.map((message) => ({ path: '', message })),
          }} />
        )}
        <AssistantIdentitySection
          kind="navigators"
          isNew={isNew}
          name={draft.name}
          assistantKey={key}
          description={draft.description}
          existingKeys={existingKeys}
          disabled={busy}
          namePlaceholder="Team explorer"
          nameError={draft.name !== '' ? problems.name : undefined}
          descriptionError={problems.description}
          descriptionHint="What this navigator is for; shown in the Workbench."
          onName={(name) => edit({ name })}
          onKey={setKey}
          onDescription={(description) => edit({ description })}
        />
        <NavigatorEditor draft={draft} onChange={edit} schema={schema} problems={problems} disabled={busy} />
      </form>
      {dialog}
    </AssistantEditorPage>
  )
}
