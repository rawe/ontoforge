import { useState } from 'react'
import { Loader2, Network } from 'lucide-react'
import type { SchemaEntityType } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface QuickLoadDialogProps {
  types: readonly SchemaEntityType[]
  remaining: number
  onClose: () => void
  onLoad: (typeKeys: string[], limit: number) => Promise<void>
}

export function QuickLoadDialog({ types, remaining, onClose, onLoad }: QuickLoadDialogProps) {
  const [typeKey, setTypeKey] = useState('__all')
  const [limit, setLimit] = useState('100')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const count = Math.min(Number(limit), remaining)
  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      await onLoad(typeKey === '__all' ? types.map(type => type.key) : [typeKey], count)
      onClose()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not load the graph. Try again.')
      setLoading(false)
    }
  }
  return <Dialog open onOpenChange={open => { if (!open && !loading) onClose() }}>
    <DialogContent showCloseButton={!loading}>
      <DialogHeader>
        <DialogTitle>Quick load graph</DialogTitle>
        <DialogDescription>Add existing entities from this lens and the connections between them. Your current canvas stays in place.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="quick-load-type">Entity types</Label>
        <Select value={typeKey} onValueChange={setTypeKey} disabled={loading}>
          <SelectTrigger id="quick-load-type" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All visible types</SelectItem>
            {types.map(type => <SelectItem key={type.key} value={type.key}>{type.displayName}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="quick-load-count">Maximum to add</Label>
        <Select value={limit} onValueChange={setLimit} disabled={loading}>
          <SelectTrigger id="quick-load-count" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{[25, 50, 100, 200].map(count => <SelectItem key={count} value={String(count)}>{count} entities</SelectItem>)}</SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Up to {count} new entities, balanced across the chosen types. Already loaded entities are skipped. The canvas holds 300 entities.</p>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button variant="outline" disabled={loading} onClick={onClose}>Cancel</Button>
        <Button disabled={loading || count <= 0 || types.length === 0} onClick={() => void load()}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Network className="size-4" />}
          {loading ? 'Loading entities and connections…' : 'Load graph'}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
