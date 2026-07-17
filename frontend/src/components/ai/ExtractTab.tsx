import { useMutation } from '@tanstack/react-query'
import { AlertCircle, RotateCcw, ScanText, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { aiExtract } from '@/api/runtime'
import type { ExtractResponse, RuntimeSchema } from '@/api/types'
import { ElapsedIndicator } from '@/components/ai/ElapsedIndicator'
import { ExtractReview } from '@/components/ai/ExtractReview'
import { TypeChip } from '@/components/TypeChip'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface ExtractTabProps {
  ontologyKey: string
  schema: RuntimeSchema
  semanticEnabled: boolean
}

/**
 * Extract tab: paste any text, optionally restrict the entity types, run
 * `/ai/extract` (create:false — nothing is persisted), then review and accept
 * the proposals. The review stage owns all creation.
 */
export function ExtractTab({ ontologyKey, schema, semanticEnabled }: ExtractTabProps) {
  const [text, setText] = useState('')
  const [restrictTypes, setRestrictTypes] = useState<string[]>([])
  const [response, setResponse] = useState<ExtractResponse | null>(null)

  const extract = useMutation({
    mutationFn: () =>
      aiExtract(ontologyKey, {
        text: text.trim(),
        ...(restrictTypes.length > 0 ? { entityTypes: restrictTypes } : {}),
        create: false,
      }),
    onSuccess: (res) => setResponse(res),
  })

  const toggleType = (key: string) =>
    setRestrictTypes((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    )

  if (response !== null) {
    return (
      <ExtractReview
        // Remount the review when a new extraction arrives.
        key={`${response.entities.length}-${response.relations.length}-${text.length}`}
        ontologyKey={ontologyKey}
        schema={schema}
        response={response}
        semanticEnabled={semanticEnabled}
        onBack={() => setResponse(null)}
      />
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-4 py-5">
      <div className="flex items-start gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
          <ScanText className="size-4 text-muted-foreground" />
        </div>
        <div>
          <h2 className="text-sm font-medium">Extract knowledge from text</h2>
          <p className="text-[13px] text-muted-foreground">
            Paste notes, emails or documents. The AI proposes entities and relations that
            fit your schema — nothing is saved until you review and accept.
          </p>
        </div>
      </div>

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste anything — meeting notes, an email thread, a paragraph from a report…"
        rows={10}
        className="mt-4 text-[13px]"
        disabled={extract.isPending}
        autoFocus
      />

      <div className="mt-3">
        <p className="text-xs font-medium text-muted-foreground">
          Restrict to entity types <span className="font-normal">(optional — none = all)</span>
        </p>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
          {schema.entityTypes.map((t) => (
            <Label
              key={t.key}
              className="flex cursor-pointer items-center gap-1.5 text-[13px] font-normal"
            >
              <Checkbox
                checked={restrictTypes.includes(t.key)}
                onCheckedChange={() => toggleType(t.key)}
                disabled={extract.isPending}
              />
              <TypeChip typeKey={t.key} displayName={t.displayName} size="sm" />
            </Label>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button
          size="sm"
          className="gap-1.5"
          disabled={text.trim() === '' || extract.isPending}
          onClick={() => extract.mutate()}
        >
          <Sparkles className="size-3.5" />
          Extract
        </Button>
        {extract.isPending && <ElapsedIndicator label="Extracting" />}
      </div>

      {extract.isError && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-[13px]">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="text-destructive">{extract.error.message}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-1.5 h-6 gap-1 px-2 text-xs"
              onClick={() => extract.mutate()}
            >
              <RotateCcw className="size-3" />
              Retry
            </Button>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
