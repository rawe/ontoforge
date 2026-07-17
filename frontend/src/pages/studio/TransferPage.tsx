import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, RefreshCw, Upload } from 'lucide-react'
import { toast } from 'sonner'
import * as model from '@/api/model'
import { ApiError } from '@/api/http'
import { useFeatures } from '@/api/hooks'
import type { JsonValue } from '@/api/types'
import { PageHeader } from '@/components/PageHeader'
import { toastError } from '@/components/studio/lib'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface RebuildProgress {
  entityTypeKey: string
  processed: number
  total: number
}

interface RebuildSummary {
  totalProcessed: number
  totalFailed: number
}

/**
 * POST /rebuild-embeddings streams NDJSON progress lines; the shared JSON
 * client can't consume that, so read the stream here and surface progress.
 */
async function rebuildEmbeddingsStream(
  onProgress: (p: RebuildProgress) => void,
): Promise<RebuildSummary> {
  const res = await fetch('/api/model/rebuild-embeddings', { method: 'POST' })
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      if (body.error?.message !== undefined) message = body.error.message
    } catch {
      /* not JSON */
    }
    throw new Error(message)
  }
  if (res.body === null) throw new Error('Empty response')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let summary: RebuildSummary | null = null
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim() === '') continue
      const event = JSON.parse(line) as Record<string, JsonValue>
      if (event.type === 'progress') {
        onProgress(event as unknown as RebuildProgress)
      } else if (event.type === 'summary') {
        summary = event as unknown as RebuildSummary
      }
    }
  }
  if (summary === null) throw new Error('Rebuild finished without a summary')
  return summary
}

function TransferCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Download
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="mb-1 flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <h2 className="text-[13px] font-semibold">{title}</h2>
      </div>
      <p className="mb-4 text-[13px] text-muted-foreground">{description}</p>
      {children}
    </section>
  )
}

/** `/studio/transfer` — export, import, rebuild embeddings. */
export function TransferPage() {
  const queryClient = useQueryClient()
  const { data: features } = useFeatures()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [progress, setProgress] = useState<RebuildProgress | null>(null)

  const exportMutation = useMutation({
    mutationFn: model.exportSchema,
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'schema.json'
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Schema exported')
    },
    onError: toastError,
  })

  const importMutation = useMutation({
    mutationFn: async (selected: File) => {
      const text = await selected.text()
      let data: Record<string, JsonValue>
      try {
        data = JSON.parse(text) as Record<string, JsonValue>
      } catch {
        throw new Error('The selected file is not valid JSON.')
      }
      return model.importSchema(data)
    },
    onSuccess: () => {
      setImportError(null)
      setFile(null)
      if (fileInputRef.current !== null) fileInputRef.current.value = ''
      void queryClient.invalidateQueries()
      toast.success('Schema imported')
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'RESOURCE_CONFLICT') {
        setImportError(
          `Conflict: ${error.message} Existing objects with the same keys prevent the import — resolve the clashes (or import into an empty instance) and retry.`,
        )
      } else {
        setImportError(error instanceof Error ? error.message : String(error))
      }
    },
  })

  const rebuildMutation = useMutation({
    mutationFn: () => rebuildEmbeddingsStream(setProgress),
    onSuccess: (summary) => {
      setProgress(null)
      toast.success(
        `Embeddings rebuilt — ${summary.totalProcessed} processed${
          summary.totalFailed > 0 ? `, ${summary.totalFailed} failed` : ''
        }`,
      )
    },
    onError: (error) => {
      setProgress(null)
      toastError(error)
    },
  })

  const semanticOff = features !== undefined && !features.semanticSearch

  return (
    <div>
      <PageHeader
        title="Transfer"
        description="Export the schema as JSON, import it elsewhere, and rebuild semantic embeddings."
      />
      <div className="grid max-w-3xl gap-4 p-6">
        <TransferCard
          icon={Download}
          title="Export schema"
          description="Download the full global schema — entity types, relation types, properties, ontologies, agents and saved queries — as a portable JSON file."
        >
          <Button
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
          >
            <Download className="size-4" />
            {exportMutation.isPending ? 'Exporting…' : 'Download schema.json'}
          </Button>
        </TransferCard>

        <TransferCard
          icon={Upload}
          title="Import schema"
          description="Import a previously exported schema JSON. Import fails if keys clash with existing objects."
        >
          <div className="flex flex-wrap items-center gap-2">
            <Input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="max-w-xs"
              aria-label="Schema file"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                setImportError(null)
              }}
            />
            <Button
              onClick={() => {
                if (file !== null) importMutation.mutate(file)
              }}
              disabled={file === null || importMutation.isPending}
            >
              <Upload className="size-4" />
              {importMutation.isPending ? 'Importing…' : 'Import'}
            </Button>
          </div>
          {importError !== null && (
            <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-[13px] text-destructive">
              {importError}
            </p>
          )}
        </TransferCard>

        <TransferCard
          icon={RefreshCw}
          title="Rebuild embeddings"
          description="Re-embed all entities and saved queries with the configured embedding provider. Use after bulk imports or provider changes."
        >
          <div className="flex items-center gap-3">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  disabled={rebuildMutation.isPending || semanticOff}
                >
                  <RefreshCw
                    className={rebuildMutation.isPending ? 'size-4 animate-spin' : 'size-4'}
                  />
                  {rebuildMutation.isPending ? 'Rebuilding…' : 'Rebuild embeddings'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Rebuild all embeddings?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Every entity and saved query is re-embedded. Depending on data volume
                    this can take a while and calls the embedding provider for each item.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => rebuildMutation.mutate()}>
                    Rebuild
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            {progress !== null && (
              <span className="font-mono text-xs text-muted-foreground">
                {progress.entityTypeKey}: {progress.processed}/{progress.total}
              </span>
            )}
          </div>
          {semanticOff && (
            <p className="mt-3 text-[12px] text-muted-foreground">
              Semantic search is disabled — configure an embedding provider
              (EMBEDDING_PROVIDER) to enable rebuilding.
            </p>
          )}
        </TransferCard>
      </div>
    </div>
  )
}
