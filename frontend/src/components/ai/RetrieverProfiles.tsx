import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { listLenses } from '@/api/model'
import { ApiError } from '@/api/http'
import { deleteRetriever, exportRetriever, importRetriever, listRetrievers, saveRetriever, transferRetriever, type RetrieverExport, type RetrieverProfile } from '@/api/retrievers'
import type { RetrievalConfig } from '@/api/retrievalPrototype'
import { editableRetrievalConfig } from './retrieverProfileState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'

type Action = { kind: 'save' | 'delete' | 'copy' | 'move' | 'import'; title: string; description: string; body?: RetrieverExport; target?: { targetLensKey: string; targetKey: string } }
const selectClass = 'h-8 w-full rounded-md border bg-background px-2 text-sm disabled:opacity-50'
const message = (error: unknown) => error instanceof ApiError && error.details ? `${error.message}\n${JSON.stringify(error.details, null, 2)}` : error instanceof Error ? error.message : 'Retriever operation failed.'

export function RetrieverProfiles({ ontologyKey, lensKey, config, profile, dirty, disabled, repairReviewed, onSelect, onConfig, onBusy }: {
  ontologyKey: string; lensKey: string; config: RetrievalConfig; profile: RetrieverProfile | null; dirty: boolean; disabled: boolean
  onSelect: (profile: RetrieverProfile | null, draft?: RetrievalConfig) => void
  onConfig: (config: RetrievalConfig) => void
  onBusy: (busy: boolean) => void
  repairReviewed: boolean
}) {
  const client = useQueryClient()
  const queryKey = ['retrievers', ontologyKey, lensKey]
  const profiles = useQuery({ queryKey, queryFn: () => listRetrievers(ontologyKey, lensKey), retry: false })
  const lenses = useQuery({ queryKey: ['retriever-target-lenses', ontologyKey], queryFn: () => listLenses(ontologyKey), retry: false })
  const [key, setKey] = useState(profile?.key ?? '')
  const [name, setName] = useState(profile?.name ?? '')
  const [description, setDescription] = useState(profile?.description ?? '')
  const [targetLensKey, setTargetLensKey] = useState(lensKey)
  const [targetKey, setTargetKey] = useState('')
  const [importText, setImportText] = useState('')
  const rawConfig = useRef<HTMLTextAreaElement>(null)
  const [action, setAction] = useState<Action | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const active = useRef<AbortController | null>(null)
  const locked = disabled || busy
  const unsupported = profile !== null && (profile.configVersion !== 1 || !editableRetrievalConfig(profile.config))
  const needsRepair = unsupported && !repairReviewed
  const rawValue = needsRepair ? profile?.config : config
  useEffect(() => () => { active.current?.abort(); active.current = null }, [])
  const setWorking = (working: boolean) => { setBusy(working); onBusy(working) }

  async function refresh() { await client.invalidateQueries({ queryKey }) }
  async function execute(reviewed: Action) {
    if (active.current) return
    const controller = new AbortController(); active.current = controller
    setWorking(true); setError(''); setNotice(''); setAction(null)
    try {
      let next: RetrieverProfile | null = null
      if (reviewed.kind === 'save' && reviewed.body) next = profile ? await saveRetriever(ontologyKey, lensKey, reviewed.body.key, reviewed.body, controller.signal) : await importRetriever(ontologyKey, lensKey, reviewed.body, controller.signal)
      if (reviewed.kind === 'import' && reviewed.body) next = await importRetriever(ontologyKey, lensKey, reviewed.body, controller.signal)
      if (reviewed.kind === 'delete' && profile) await deleteRetriever(ontologyKey, lensKey, profile.key, controller.signal)
      if ((reviewed.kind === 'copy' || reviewed.kind === 'move') && profile && reviewed.target) next = await transferRetriever(ontologyKey, lensKey, profile.key, reviewed.kind, reviewed.target, controller.signal)
      if (active.current !== controller || controller.signal.aborted) return
      await refresh()
      if (active.current !== controller) return
      setWorking(false)
      if (reviewed.kind === 'copy' || reviewed.kind === 'move') {
        onSelect(reviewed.target?.targetLensKey === lensKey ? next : reviewed.kind === 'move' ? null : profile)
        setNotice(`${reviewed.kind === 'copy' ? 'Copied' : 'Moved'} to ${reviewed.target?.targetLensKey} / ${reviewed.target?.targetKey}. Target configuration was validated; existing keys are never overwritten.`)
      } else { onSelect(next); setNotice(reviewed.kind === 'delete' ? 'Retriever deleted. The browser draft is preserved.' : 'Retriever saved. Runs now use the server configuration.') }
    } catch (reason) { if (active.current === controller && !controller.signal.aborted) setError(message(reason)) }
    finally { if (active.current === controller) { active.current = null; setWorking(false) } }
  }

  async function download() {
    if (!profile || active.current) return
    const controller = new AbortController(); active.current = controller
    setWorking(true); setError('')
    try {
      const exported = await exportRetriever(ontologyKey, lensKey, profile.key, controller.signal)
      if (active.current !== controller || controller.signal.aborted) return
      const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' }))
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${profile.key}.retriever.json`; anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (reason) { if (!controller.signal.aborted) setError(message(reason)) }
    finally { if (active.current === controller) { active.current = null; setWorking(false) } }
  }

  return <div className="mb-4 space-y-3 rounded-lg border p-3">
    <label className="block space-y-1 text-sm"><span className="font-medium">Retriever profile</span><select aria-label="Retriever profile" className={selectClass} disabled={locked} value={profile?.key ?? ''} onChange={(event) => {
      const next = profiles.data?.find((item) => item.key === event.target.value) ?? null
      setError(''); setNotice(''); onSelect(next)
    }}><option value="">Browser draft (not saved on server)</option>{profiles.data?.map((item) => <option key={item.key} value={item.key}>{item.name} · {item.key}{item.validation.valid ? '' : ' · invalid'}</option>)}</select></label>
    {profiles.error && <p role="alert" className="text-xs text-destructive">{message(profiles.error)} <button type="button" className="underline" onClick={() => void profiles.refetch()}>Reload profiles</button></p>}
    {profile ? <p className="text-xs text-muted-foreground">Lens-local server profile · {dirty ? 'unsaved changes' : 'saved configuration'}. Embeddings, caches and chat history are not stored in this profile.</p> : <p className="text-xs text-muted-foreground">Your V2 browser draft stays local. Save it explicitly to create a named server profile.</p>}
    {profile && !profile.validation.valid && <div role="alert" className="space-y-1 text-xs text-destructive"><p className="font-medium">Invalid in the current lens; saved execution is blocked.</p><ul className="list-disc pl-4">{profile.validation.errors.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
    {needsRepair && <p role="alert" className="text-xs text-destructive">Unsupported configuration version or shape (version {profile?.configVersion}). Raw configuration is preserved below. Export and deletion remain available. Review a version 1 repair before saving or previewing.</p>}
    <details><summary className="cursor-pointer text-sm font-medium">Save and manage profiles</summary><div className="mt-3 space-y-3">
      <label className="block space-y-1 text-xs"><span>Key (unique in this lens)</span><Input aria-label="Retriever key" value={key} disabled={locked || profile !== null} onChange={(event) => setKey(event.target.value)} placeholder="support-search" /></label>
      <label className="block space-y-1 text-xs"><span>Name</span><Input aria-label="Retriever name" value={name} disabled={locked} onChange={(event) => setName(event.target.value)} placeholder="Support search" /></label>
      <label className="block space-y-1 text-xs"><span>Description</span><Textarea aria-label="Retriever description" value={description} disabled={locked} onChange={(event) => setDescription(event.target.value)} rows={2} /></label>
      <div className="flex flex-wrap gap-2"><Button size="sm" disabled={locked || needsRepair || !key.trim() || !name.trim()} onClick={() => {
        const existing = profiles.data?.find((item) => item.key === key.trim())
        if (!profile && existing) { setError('That key already exists. Select the profile to edit it, or choose another key.'); return }
        setAction({ kind: 'save', title: profile ? 'Replace saved retriever?' : 'Save new retriever?', description: `Save ${name.trim()} as ${ontologyKey} / ${lensKey} / ${key.trim()}, configuration version 1. ${profile ? `This replaces the saved configuration${profile.configVersion !== 1 ? ` and its unsupported version ${profile.configVersion}` : ''}, then clears this conversation.` : 'This uploads only this configuration, not browser history or embeddings.'}`, body: { key: key.trim(), name: name.trim(), description: description.trim() || null, configVersion: 1, config } })
      }}>{profile ? 'Save changes' : 'Save browser draft'}</Button>
        {profile && <Button size="sm" variant="outline" disabled={locked || needsRepair} onClick={() => { onSelect(null, config); setNotice('Current configuration copied to an unsaved browser draft. Choose a new key and name to save it.'); }}>New from current</Button>}
      </div>
      {profile && <>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={locked} onClick={() => void download()}>Export saved JSON</Button><Button size="sm" variant="destructive" disabled={locked} onClick={() => setAction({ kind: 'delete', title: 'Delete saved retriever?', description: `Delete ${profile.name} (${profile.key}) from ${lensKey}. This deletes only the profile; entity data and the browser draft remain. This cannot be undone.` })}>Delete profile</Button></div>
        <div className="space-y-2 border-t pt-3"><p className="text-xs text-muted-foreground">Copy or move the saved configuration within this ontology. Unsaved edits are excluded. Target scope is validated; key conflicts abort.</p>
          <label className="block space-y-1 text-xs"><span>Target lens</span><select className={selectClass} aria-label="Target lens" value={targetLensKey} disabled={locked} onChange={(event) => setTargetLensKey(event.target.value)}>{lenses.data?.map((lens) => <option key={lens.key} value={lens.key}>{lens.name} · {lens.key}</option>)}</select></label>
          {lenses.error && <p className="text-xs text-destructive">{message(lenses.error)}</p>}
          <Input aria-label="Target retriever key" placeholder="Target retriever key" value={targetKey} disabled={locked} onChange={(event) => setTargetKey(event.target.value)} />
          <div className="flex gap-2">{(['copy', 'move'] as const).map((kind) => <Button key={kind} size="sm" variant="outline" disabled={locked || !targetKey.trim() || !targetLensKey || !lenses.data} onClick={() => setAction({ kind, title: kind === 'copy' ? 'Copy saved retriever?' : 'Move saved retriever?', description: `${profile.name}: ${lensKey} / ${profile.key} → ${targetLensKey} / ${targetKey.trim()}. ${kind === 'copy' ? 'Creates an independent copy and keeps the source.' : 'Atomically moves the profile and removes its old address.'} A new conversation starts.`, target: { targetLensKey, targetKey: targetKey.trim() } })}>{kind === 'copy' ? 'Copy profile' : 'Move profile'}</Button>)}</div>
        </div>
      </>}
    </div></details>
    <details><summary className="cursor-pointer text-xs">Import one profile JSON</summary><div className="mt-2 space-y-2"><p className="text-xs text-muted-foreground">Paste a profile exported from another ontology, or choose its JSON file. The current lens must expose all referenced types, fields and paths. No schema or instance data is imported; existing keys are not replaced.</p>
      <Input type="file" accept="application/json,.json" aria-label="Import retriever JSON file" disabled={locked} onChange={async (event) => { const file = event.target.files?.[0]; if (file) { if (file.size > 1024 * 1024) { setError('Retriever JSON must be smaller than 1 MiB.'); return } setImportText(await file.text()) } }} />
      <Textarea aria-label="Import retriever JSON" value={importText} disabled={locked} onChange={(event) => setImportText(event.target.value)} rows={5} className="font-mono text-xs" />
      <Button size="sm" variant="outline" disabled={locked || !importText.trim()} onClick={() => { try { const body = JSON.parse(importText) as RetrieverExport; if (body.configVersion !== 1 || typeof body.key !== 'string' || typeof body.name !== 'string' || !editableRetrievalConfig(body.config)) throw new Error('Expected a version 1 retriever export with key, name and config.'); setAction({ kind: 'import', title: 'Import retriever configuration?', description: `Create ${body.name} (${body.key}) in ${ontologyKey} / ${lensKey}. The server validates all references against this lens. Existing keys will not be overwritten.`, body }) } catch (reason) { setError(message(reason)) } }}>Review import</Button>
    </div></details>
    <details open={needsRepair || undefined}><summary className="cursor-pointer text-xs">Advanced configuration JSON / repair</summary><div className="mt-2 space-y-2"><Textarea key={JSON.stringify(rawValue)} ref={rawConfig} aria-label="Retriever configuration JSON" defaultValue={JSON.stringify(rawValue, null, 2)} disabled={locked} rows={8} className="font-mono text-xs" /><Button size="sm" variant="outline" disabled={locked} onClick={() => { try { const next: unknown = JSON.parse(rawConfig.current?.value ?? ''); if (!editableRetrievalConfig(next)) throw new Error('Unsupported configuration shape. Keep buckets, fields, conditions and threshold.'); onConfig(next); setError('') } catch (reason) { setError(message(reason)) } }}>{needsRepair ? 'Review as version 1 draft repair' : 'Apply to draft'}</Button><p className="text-xs text-muted-foreground">Schema references are preserved, including invalid ones. Applying changes does not update the server profile.{needsRepair ? ' This explicit repair treats the reviewed JSON as version 1; saving still requires confirmation and server validation.' : ''}</p></div></details>
    {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
    {error && <p role="alert" className="whitespace-pre-wrap break-words text-xs text-destructive">{error}</p>}
    <AlertDialog open={action !== null} onOpenChange={(open) => { if (!open) setAction(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{action?.title}</AlertDialogTitle><AlertDialogDescription>{action?.description}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { if (action) void execute(action) }}>Confirm {action?.kind}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>
}
