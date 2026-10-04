import { useQuery } from '@tanstack/react-query'
import { Copy, Plus, Save, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { listLenses } from '@/api/model'
import { ApiError } from '@/api/http'
import { deleteRetriever, exportRetriever, importRetriever, transferRetriever, type RetrieverExport, type RetrieverProfile } from '@/api/retrievers'
import type { RetrievalConfig } from '@/api/retrievalPrototype'
import { editableRetrievalConfig } from './retrieverProfileState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'

const selectClass = 'h-8 rounded-md border bg-background px-2 text-sm disabled:opacity-50'
const keyPattern = /^[a-z][a-z0-9_-]*$/
const errorText = (error: unknown) => error instanceof ApiError && error.details ? `${error.message}\n${JSON.stringify(error.details, null, 2)}` : error instanceof Error ? error.message : 'Retriever operation failed.'
const slug = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+|-+$/g, '').slice(0, 64)

/** Header control: which saved retriever this tab runs, and the way to create another. */
export function RetrieverPicker({ profiles, profile, disabled, onSelect, onNew }: {
  profiles: RetrieverProfile[] | undefined; profile: RetrieverProfile | null; disabled: boolean
  onSelect: (key: string) => void; onNew: () => void
}) {
  return <div className="flex items-center gap-2">
    <label className="flex items-center gap-2 text-sm"><span className="font-medium">Retriever</span>
      <select aria-label="Retriever" className={`${selectClass} max-w-64`} disabled={disabled || !profiles?.length} value={profile?.key ?? ''} onChange={(event) => onSelect(event.target.value)}>
        {!profiles?.length && <option value="">No retriever yet</option>}
        {profiles?.map((item) => <option key={item.key} value={item.key}>{item.name}{item.validation.valid ? '' : ' (invalid)'}</option>)}
      </select>
    </label>
    <Button size="sm" variant="outline" className="h-8 gap-1" disabled={disabled} onClick={onNew}><Plus className="size-3.5" />New</Button>
  </div>
}

/** Name and key for a new retriever, used by New and by Save as copy. Keys are permanent and unique in the lens. */
export function NameKeyDialog({ open, title, description, confirmLabel, initialName, existingKeys, busy, error, onCancel, onConfirm }: {
  open: boolean; title: string; description: string; confirmLabel: string; initialName: string; existingKeys: string[]
  busy: boolean; error: string; onCancel: () => void; onConfirm: (name: string, key: string) => void
}) {
  const [name, setName] = useState(initialName)
  const [key, setKey] = useState(slug(initialName))
  const [keyEdited, setKeyEdited] = useState(false)
  const keyProblem = !key ? 'Enter a key.' : !keyPattern.test(key) ? 'Use lowercase letters, digits, - or _, starting with a letter.' : existingKeys.includes(key) ? 'This key already exists in this lens.' : ''
  return <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onCancel() }}>
    <DialogContent>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (name.trim() && !keyProblem) onConfirm(name.trim(), key) }}>
        <label className="block space-y-1 text-sm"><span>Name</span><Input aria-label="Retriever name" autoFocus value={name} disabled={busy} onChange={(event) => { setName(event.target.value); if (!keyEdited) setKey(slug(event.target.value)) }} placeholder="Person skills" /></label>
        <label className="block space-y-1 text-sm"><span>Key <span className="text-xs text-muted-foreground">· permanent address, unique in this lens</span></span><Input aria-label="Retriever key" value={key} maxLength={64} disabled={busy} onChange={(event) => { setKey(event.target.value); setKeyEdited(true) }} className="font-mono" /></label>
        {key && keyProblem && <p className="text-xs text-destructive">{keyProblem}</p>}
        {error && <p role="alert" className="whitespace-pre-wrap break-words text-xs text-destructive">{error}</p>}
        <DialogFooter><Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button><Button type="submit" disabled={busy || !name.trim() || !!keyProblem}>{confirmLabel}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}

/** The one place that decides whether edits take effect: Save writes them, Discard drops them, Save as copy forks them. */
export function RetrieverSaveBar({ dirty, canSave, busy, onSave, onDiscard, onSaveAsCopy }: {
  dirty: boolean; canSave: boolean; busy: boolean; onSave: () => void; onDiscard: () => void; onSaveAsCopy: () => void
}) {
  return <div className={`mb-4 space-y-2 rounded-lg border p-3 ${dirty ? 'border-amber-500/40 bg-amber-500/5' : ''}`}>
    <p className="text-xs">{dirty ? <><b>Unsaved changes.</b> Save them to ask questions, or discard them.</> : <span className="text-muted-foreground">All changes saved. Questions use this configuration.</span>}</p>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" className="gap-1" disabled={busy || !dirty || !canSave} onClick={onSave}><Save className="size-3.5" />Save</Button>
      <Button size="sm" variant="ghost" className="gap-1" disabled={busy || !dirty} onClick={onDiscard}><Undo2 className="size-3.5" />Discard</Button>
      <Button size="sm" variant="outline" className="ml-auto gap-1" disabled={busy || !canSave} onClick={onSaveAsCopy} title="Save the current configuration as a new retriever; this one stays as saved"><Copy className="size-3.5" />Save as copy</Button>
    </div>
  </div>
}

export function RetrieverDetails({ profile, name, description, disabled, onChange }: {
  profile: RetrieverProfile; name: string; description: string; disabled: boolean; onChange: (name: string, description: string) => void
}) {
  return <details className="mb-4 rounded-lg border p-3 text-sm">
    <summary className="cursor-pointer font-medium">Name and description</summary>
    <div className="mt-3 space-y-3">
      <label className="block space-y-1 text-xs"><span>Name</span><Input aria-label="Name" value={name} disabled={disabled} onChange={(event) => onChange(event.target.value, description)} /></label>
      <label className="block space-y-1 text-xs"><span>Description</span><Textarea aria-label="Description" value={description} disabled={disabled} rows={2} onChange={(event) => onChange(name, event.target.value)} /></label>
      <p className="text-xs text-muted-foreground">Key <code>{profile.key}</code> · stores configuration only, no conversations or embeddings.</p>
    </div>
  </details>
}

type Confirm = { title: string; description: string; label: string; run: () => Promise<void> }

/** Rare profile operations, kept out of the way: export, import, copy or move to another lens, raw JSON, delete. */
export function RetrieverMore({ ontologyKey, lensKey, profile, config, needsRepair, existingKeys, disabled, onBusy, onCreated, onDeleted, onConfig }: {
  ontologyKey: string; lensKey: string; profile: RetrieverProfile; config: RetrievalConfig; needsRepair: boolean; existingKeys: string[]; disabled: boolean
  onBusy: (busy: boolean) => void; onCreated: (profile: RetrieverProfile) => void; onDeleted: () => void; onConfig: (config: RetrievalConfig) => void
}) {
  const lenses = useQuery({ queryKey: ['retriever-target-lenses', ontologyKey], queryFn: () => listLenses(ontologyKey), retry: false })
  const otherLenses = lenses.data?.filter((lens) => lens.key !== lensKey) ?? []
  const [targetLensKey, setTargetLensKey] = useState('')
  const [importText, setImportText] = useState('')
  const rawConfig = useRef<HTMLTextAreaElement>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const active = useRef<AbortController | null>(null)
  const locked = disabled || busy
  useEffect(() => () => { active.current?.abort(); active.current = null }, [])

  async function work(run: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return
    const controller = new AbortController(); active.current = controller
    setBusy(true); onBusy(true); setError(''); setNotice('')
    try { await run(controller.signal) } catch (reason) { if (!controller.signal.aborted) setError(errorText(reason)) }
    finally { if (active.current === controller) { active.current = null; setBusy(false); onBusy(false) } }
  }
  const download = () => work(async (signal) => {
    const exported = await exportRetriever(ontologyKey, lensKey, profile.key, signal)
    const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${profile.key}.retriever.json`; anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
  function reviewImport() {
    try {
      const body = JSON.parse(importText) as RetrieverExport
      if (body.configVersion !== 1 || typeof body.key !== 'string' || typeof body.name !== 'string' || !editableRetrievalConfig(body.config)) throw new Error('Expected a version 1 retriever export with key, name and config.')
      if (existingKeys.includes(body.key)) throw new Error(`Key ${body.key} already exists in this lens. Change the key in the JSON first.`)
      setConfirm({ title: 'Import retriever?', label: 'Import', description: `Creates ${body.name} (${body.key}) in ${lensKey}. The server checks every type, field and path against this lens.`,
        run: () => work(async (signal) => { onCreated(await importRetriever(ontologyKey, lensKey, body, signal)); setImportText('') }) })
    } catch (reason) { setError(errorText(reason)) }
  }

  return <details open={needsRepair || undefined} className="rounded-lg border p-3 text-sm">
    <summary className="cursor-pointer font-medium">More: export, import, other lenses, JSON, delete</summary>
    <div className="mt-3 space-y-4 text-xs">
      <section className="space-y-2"><h3 className="font-medium">Export</h3><p className="text-muted-foreground">Downloads the saved version as JSON, e.g. to import into another ontology.</p>
        <Button size="sm" variant="outline" disabled={locked} onClick={() => void download()}>Export JSON</Button></section>
      <section className="space-y-2"><h3 className="font-medium">Import</h3><p className="text-muted-foreground">Creates a new retriever from an exported JSON. Existing keys are never replaced.</p>
        <Input type="file" accept="application/json,.json" aria-label="Import retriever JSON file" disabled={locked} onChange={async (event) => { const file = event.target.files?.[0]; if (file) { if (file.size > 1024 * 1024) { setError('Retriever JSON must be smaller than 1 MiB.'); return } setImportText(await file.text()) } }} />
        <Textarea aria-label="Import retriever JSON" value={importText} disabled={locked} onChange={(event) => setImportText(event.target.value)} rows={4} className="font-mono text-xs" placeholder="…or paste the JSON here" />
        <Button size="sm" variant="outline" disabled={locked || !importText.trim()} onClick={reviewImport}>Review import</Button></section>
      {otherLenses.length > 0 && <section className="space-y-2"><h3 className="font-medium">Another lens</h3><p className="text-muted-foreground">Copies or moves the saved version, under the same key, to another lens of this ontology. That lens must show every type and field it uses.</p>
        <select className={`${selectClass} w-full`} aria-label="Target lens" value={targetLensKey} disabled={locked} onChange={(event) => setTargetLensKey(event.target.value)}><option value="">Choose a lens …</option>{otherLenses.map((lens) => <option key={lens.key} value={lens.key}>{lens.name}</option>)}</select>
        <div className="flex gap-2">{(['copy', 'move'] as const).map((kind) => <Button key={kind} size="sm" variant="outline" disabled={locked || !targetLensKey} onClick={() => setConfirm({
          title: kind === 'copy' ? 'Copy to another lens?' : 'Move to another lens?', label: kind === 'copy' ? 'Copy' : 'Move',
          description: `${profile.name} (${profile.key}) → lens ${targetLensKey}. ${kind === 'copy' ? 'This retriever stays here.' : 'It is removed from this lens.'} Unsaved changes are not included.`,
          run: () => work(async (signal) => {
            await transferRetriever(ontologyKey, lensKey, profile.key, kind, { targetLensKey, targetKey: profile.key }, signal)
            if (kind === 'move') onDeleted(); else setNotice(`Copied to lens ${targetLensKey}.`)
          }),
        })}>{kind === 'copy' ? 'Copy there' : 'Move there'}</Button>)}</div>
        {lenses.error && <p className="text-destructive">{errorText(lenses.error)}</p>}</section>}
      <section className="space-y-2"><h3 className="font-medium">Configuration JSON</h3><p className="text-muted-foreground">{needsRepair ? 'This configuration has an unsupported shape. Review it as version 1, then save.' : 'Edit the configuration as JSON. Apply puts it into the editor; Save stores it.'}</p>
        <Textarea key={JSON.stringify(needsRepair ? profile.config : config)} ref={rawConfig} aria-label="Retriever configuration JSON" defaultValue={JSON.stringify(needsRepair ? profile.config : config, null, 2)} disabled={locked} rows={8} className="font-mono text-xs" />
        <Button size="sm" variant="outline" disabled={locked} onClick={() => { try { const next: unknown = JSON.parse(rawConfig.current?.value ?? ''); if (!editableRetrievalConfig(next)) throw new Error('Unsupported configuration shape. Keep buckets, fields, conditions and threshold.'); onConfig(next); setError('') } catch (reason) { setError(errorText(reason)) } }}>{needsRepair ? 'Review as version 1' : 'Apply to editor'}</Button></section>
      <section className="space-y-2 border-t pt-3"><h3 className="font-medium text-destructive">Delete</h3><p className="text-muted-foreground">Deletes this retriever. Entity data is not touched. This cannot be undone.</p>
        <Button size="sm" variant="destructive" disabled={locked} onClick={() => setConfirm({ title: 'Delete retriever?', label: 'Delete', description: `Deletes ${profile.name} (${profile.key}) from ${lensKey}. This cannot be undone.`,
          run: () => work(async (signal) => { await deleteRetriever(ontologyKey, lensKey, profile.key, signal); onDeleted() }) })}>Delete retriever</Button></section>
      {notice && <p role="status" className="text-muted-foreground">{notice}</p>}
      {error && <p role="alert" className="whitespace-pre-wrap break-words text-destructive">{error}</p>}
    </div>
    <AlertDialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirm?.title}</AlertDialogTitle><AlertDialogDescription>{confirm?.description}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { const run = confirm?.run; setConfirm(null); if (run) void run() }}>{confirm?.label}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </details>
}
