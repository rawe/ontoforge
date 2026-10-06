/**
 * Management pieces of the retriever-agent editor: the name + key dialog
 * (New, Save as copy), the save bar, the import dialog and the "More" panel
 * with export, copy/move to another lens, raw JSON and delete.
 */
import { Copy, Save, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLenses } from '@/api/hooks'
import {
  deleteRetrieverAgent, exportRetrieverAgent, importRetrieverAgent, transferRetrieverAgent,
  type RetrieverAgent, type RetrieverAgentConfig, type RetrieverAgentExport,
} from '@/api/retrieverAgents'
import { deriveKey, isValidKey } from '@/components/studio/lib'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { errorText } from './errorText'
import { editableConfig, importProblem } from './retrieverAgentModel'

const MAX_KEY_LENGTH = 64
const selectClass = 'h-8 rounded-md border bg-background px-2 text-sm disabled:opacity-50'

/** Name and key of a new retriever agent (New, Save as copy). Keys are permanent and unique in the lens. */
export function NameKeyDialog({ open, title, description, confirmLabel, initialName, existingKeys, busy, error, onCancel, onConfirm }: {
  open: boolean; title: string; description: string; confirmLabel: string; initialName: string; existingKeys: readonly string[]
  busy: boolean; error: string; onCancel: () => void; onConfirm: (name: string, key: string) => void
}) {
  const [name, setName] = useState(initialName)
  const [key, setKey] = useState(deriveKey(initialName))
  const [keyEdited, setKeyEdited] = useState(false)
  const keyProblem = !key ? 'Enter a key.' : !isValidKey(key) ? 'Use lowercase letters, digits or _, starting with a letter.'
    : key.length > MAX_KEY_LENGTH ? `At most ${MAX_KEY_LENGTH} characters.` : existingKeys.includes(key) ? 'This key already exists in this lens.' : ''
  return <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onCancel() }}>
    <DialogContent>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (name.trim() && !keyProblem) onConfirm(name.trim(), key) }}>
        <label className="block space-y-1 text-sm"><span>Name</span><Input aria-label="Retriever agent name" autoFocus value={name} disabled={busy} onChange={(event) => { setName(event.target.value); if (!keyEdited) setKey(deriveKey(event.target.value)) }} placeholder="Person skills" /></label>
        <label className="block space-y-1 text-sm"><span>Key <span className="text-xs text-muted-foreground">· permanent address, unique in this lens</span></span><Input aria-label="Retriever agent key" value={key} maxLength={MAX_KEY_LENGTH} disabled={busy} onChange={(event) => { setKey(event.target.value); setKeyEdited(true) }} className="font-mono" /></label>
        {key && keyProblem && <p className="text-xs text-destructive">{keyProblem}</p>}
        {error && <p role="alert" className="whitespace-pre-wrap break-words text-xs text-destructive">{error}</p>}
        <DialogFooter><Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button><Button type="submit" disabled={busy || !name.trim() || !!keyProblem}>{confirmLabel}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}

/** The one place that decides whether edits take effect: Save writes them, Discard drops them, Save as copy forks them. */
export function RetrieverAgentSaveBar({ isNew, dirty, canSave, busy, onSave, onDiscard, onSaveAsCopy }: {
  isNew: boolean; dirty: boolean; canSave: boolean; busy: boolean; onSave: () => void; onDiscard: () => void; onSaveAsCopy: () => void
}) {
  return <div className={cn('space-y-2 rounded-xl border bg-card p-3', (dirty || isNew) && 'border-(--tc-amber-border) bg-(--tc-amber-bg)')}>
    <p className="text-xs">{isNew ? <><b>New retriever agent.</b> Save creates it; then you can test it.</>
      : dirty ? <><b>Unsaved changes.</b> Save them to test, or discard them.</>
        : <span className="text-muted-foreground">All changes saved. Tests and the Workbench use this configuration.</span>}</p>
    {/* A fixed grid instead of wrapping flex: the column is often too narrow for three buttons in one row. */}
    <div className="grid grid-cols-2 gap-2">
      <Button size="sm" className="gap-1" disabled={busy || !(dirty || isNew) || !canSave} onClick={onSave}><Save className="size-3.5" />Save</Button>
      <Button size="sm" variant="outline" className="gap-1" disabled={busy || !dirty} onClick={onDiscard}><Undo2 className="size-3.5" />Discard</Button>
      {!isNew && <Button size="sm" variant="secondary" className="col-span-2 gap-1" disabled={busy || !canSave} onClick={onSaveAsCopy} title="Save the current configuration as a new retriever agent; this one stays as saved"><Copy className="size-3.5" />Save as copy</Button>}
    </div>
  </div>
}

/** Create a retriever agent from an exported JSON (file or paste). Existing keys are never replaced. */
export function ImportDialog({ open, ontologyKey, lensKey, existingKeys, onClose, onImported }: {
  open: boolean; ontologyKey: string; lensKey: string; existingKeys: readonly string[]
  onClose: () => void; onImported: (agent: RetrieverAgent) => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run() {
    setError('')
    let body: unknown
    try { body = JSON.parse(text) } catch { setError('This is not valid JSON.'); return }
    const problem = importProblem(body, existingKeys)
    if (problem !== null) { setError(problem); return }
    setBusy(true)
    try { onImported(await importRetrieverAgent(ontologyKey, lensKey, body as RetrieverAgentExport)); setText('') }
    catch (reason) { setError(errorText(reason)) } finally { setBusy(false) }
  }
  return <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose() }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>Import retriever agent</DialogTitle><DialogDescription>Creates a new retriever agent in {lensKey} from an exported JSON. The server checks every index, type, field and path against this lens.</DialogDescription></DialogHeader>
      <div className="space-y-3 text-sm">
        <Input type="file" accept="application/json,.json" aria-label="Import retriever agent JSON file" disabled={busy} onChange={async (event) => { const file = event.target.files?.[0]; if (file) { if (file.size > 1024 * 1024) { setError('The JSON must be smaller than 1 MiB.'); return } setText(await file.text()) } }} />
        <Textarea aria-label="Import retriever agent JSON" value={text} disabled={busy} onChange={(event) => setText(event.target.value)} rows={8} className="font-mono text-xs" placeholder="…or paste the JSON here" />
        {error && <p role="alert" className="whitespace-pre-wrap break-words text-xs text-destructive">{error}</p>}
      </div>
      <DialogFooter><Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy || !text.trim()} onClick={() => void run()}>Import</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

type Confirm = { title: string; description: string; label: string; run: () => Promise<void> }

/** Rare operations, kept out of the way: export, copy or move to another lens, raw JSON, delete. */
export function RetrieverAgentMore({ ontologyKey, lensKey, agent, config, unsupported, disabled, onBusy, onDeleted, onConfig }: {
  ontologyKey: string; lensKey: string; agent: RetrieverAgent; config: RetrieverAgentConfig; unsupported: boolean; disabled: boolean
  onBusy: (busy: boolean) => void; onDeleted: () => void; onConfig: (config: RetrieverAgentConfig) => void
}) {
  const lenses = useLenses(ontologyKey)
  const otherLenses = lenses.data?.filter((lens) => lens.key !== lensKey) ?? []
  const [targetLensKey, setTargetLensKey] = useState('')
  const rawConfig = useRef<HTMLTextAreaElement>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const active = useRef<AbortController | null>(null)
  const locked = disabled || busy
  const shownConfig = unsupported ? agent.config : config
  useEffect(() => () => { active.current?.abort(); active.current = null }, [])

  async function work(run: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return
    const controller = new AbortController(); active.current = controller
    setBusy(true); onBusy(true); setError(''); setNotice('')
    try { await run(controller.signal) } catch (reason) { if (!controller.signal.aborted) setError(errorText(reason)) }
    finally { if (active.current === controller) { active.current = null; setBusy(false); onBusy(false) } }
  }
  const download = () => work(async (signal) => {
    const exported = await exportRetrieverAgent(ontologyKey, lensKey, agent.key, signal)
    const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${agent.key}.retriever-agent.json`; anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  })

  return <details open={unsupported || undefined} className="rounded-xl border p-3 text-sm">
    <summary className="cursor-pointer font-medium">More: export, other lenses, JSON, delete</summary>
    <div className="mt-3 space-y-4 text-xs">
      <section className="space-y-2"><h3 className="font-medium">Export</h3><p className="text-muted-foreground">Downloads the saved version as JSON, e.g. to import into another lens or ontology.</p>
        <Button size="sm" variant="outline" disabled={locked} onClick={() => void download()}>Export JSON</Button></section>
      {otherLenses.length > 0 && <section className="space-y-2"><h3 className="font-medium">Another lens</h3><p className="text-muted-foreground">Copies or moves the saved version, under the same key, to another lens of this ontology. That lens must offer every index, type and field it uses.</p>
        <select className={`${selectClass} w-full`} aria-label="Target lens" value={targetLensKey} disabled={locked} onChange={(event) => setTargetLensKey(event.target.value)}><option value="">Choose a lens …</option>{otherLenses.map((lens) => <option key={lens.key} value={lens.key}>{lens.name}</option>)}</select>
        <div className="grid grid-cols-2 gap-2">{(['copy', 'move'] as const).map((kind) => <Button key={kind} size="sm" variant="outline" disabled={locked || !targetLensKey} onClick={() => setConfirm({
          title: kind === 'copy' ? 'Copy to another lens?' : 'Move to another lens?', label: kind === 'copy' ? 'Copy' : 'Move',
          description: `${agent.name} (${agent.key}) → lens ${targetLensKey}. ${kind === 'copy' ? 'This retriever agent stays here.' : 'It is removed from this lens.'} Unsaved changes are not included.`,
          run: () => work(async (signal) => {
            await transferRetrieverAgent(ontologyKey, lensKey, agent.key, kind, { targetLensKey, targetKey: agent.key }, signal)
            if (kind === 'move') onDeleted(); else setNotice(`Copied to lens ${targetLensKey}.`)
          }),
        })}>{kind === 'copy' ? 'Copy there' : 'Move there'}</Button>)}</div>
        {lenses.error && <p className="text-destructive">{errorText(lenses.error)}</p>}</section>}
      <section className="space-y-2"><h3 className="font-medium">Configuration JSON</h3><p className="text-muted-foreground">{unsupported ? 'This configuration has an unsupported version or shape. Export it, or paste a version 2 configuration and apply it.' : 'Edit the configuration as JSON. Apply puts it into the editor; Save stores it.'}</p>
        <Textarea key={JSON.stringify(shownConfig)} ref={rawConfig} aria-label="Retriever agent configuration JSON" defaultValue={JSON.stringify(shownConfig, null, 2)} disabled={locked} rows={8} className="font-mono text-xs" />
        <Button size="sm" variant="outline" disabled={locked} onClick={() => { try { const next: unknown = JSON.parse(rawConfig.current?.value ?? ''); if (!editableConfig(next)) throw new Error('Unsupported configuration shape. Keep indices, filters, answerFields, threshold and answerFieldCharacters.'); onConfig(next); setError('') } catch (reason) { setError(errorText(reason)) } }}>Apply to editor</Button></section>
      <section className="space-y-2 border-t pt-3"><h3 className="font-medium text-destructive">Delete</h3><p className="text-muted-foreground">Deletes this retriever agent. Indices and entity data are not touched. This cannot be undone.</p>
        <Button size="sm" variant="destructive" disabled={locked} onClick={() => setConfirm({ title: 'Delete retriever agent?', label: 'Delete', description: `Deletes ${agent.name} (${agent.key}) from ${lensKey}. This cannot be undone.`,
          run: () => work(async (signal) => { await deleteRetrieverAgent(ontologyKey, lensKey, agent.key, signal); onDeleted() }) })}>Delete retriever agent</Button></section>
      {notice && <p role="status" className="text-muted-foreground">{notice}</p>}
      {error && <p role="alert" className="whitespace-pre-wrap break-words text-destructive">{error}</p>}
    </div>
    <AlertDialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirm?.title}</AlertDialogTitle><AlertDialogDescription>{confirm?.description}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { const run = confirm?.run; setConfirm(null); if (run) void run() }}>{confirm?.label}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </details>
}
