import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { useSearchCatalog } from '@/api/hooks'
import type {
  EntitySearchItem,
  EntitySearchResponse,
  MethodScores,
  PassageSearchItem,
  PassageSearchResponse,
  Representation,
  RuntimeSchema,
  SearchLimitation,
} from '@/api/types'
import {
  DocumentViewerDialog,
  type DocumentViewerTarget,
} from '@/components/DocumentViewerDialog'
import { IdentityText } from '@/components/IdentityText'
import { TypeChip } from '@/components/TypeChip'
import { identityText } from '@/lib/displayLabel'
import { cn } from '@/lib/utils'
import {
  countText,
  entityLabel,
  entityLink,
  limitationSentence,
  ranText,
  scoresText,
  SCORES_TITLE,
  type LimitationNames,
  type SearchMode,
} from './searchModel'

/** How limitations name the lens's types, indices and documents. */
function useLimitationNames(
  ontologyKey: string,
  lensKey: string,
  schema: RuntimeSchema,
): LimitationNames {
  const catalog = useSearchCatalog(ontologyKey, lensKey).data ?? []
  const type = (key: string) => schema.entityTypes.find((t) => t.key === key)
  return {
    type: (key) => type(key)?.displayName ?? key,
    index: (key) => catalog.find((i) => i.key === key)?.name ?? key,
    document: (key) => {
      const [typeKey, propertyKey] = key.split('.')
      const property = type(typeKey)?.properties.find((p) => p.key === propertyKey)
      return `${type(typeKey)?.displayName ?? typeKey} · ${property?.displayName ?? propertyKey}`
    },
  }
}

/** The line above a search's items: how many, what ran, what could not. */
export function SearchSummary({
  ontologyKey,
  lensKey,
  schema,
  mode,
  response,
}: {
  ontologyKey: string
  lensKey: string
  schema: RuntimeSchema
  mode: SearchMode
  response: { ran: Representation[]; items: unknown[]; limitations: SearchLimitation[] }
}) {
  const names = useLimitationNames(ontologyKey, lensKey, schema)
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p>
        {countText(mode, response.items.length)} · {ranText(response.ran)}
      </p>
      {response.limitations.map((l, i) => (
        <p key={i} className="text-amber-700 dark:text-amber-400">
          {limitationSentence(l, mode, names)}
        </p>
      ))}
    </div>
  )
}

/** The query text an item ranked best for, when a named search ran several. */
function QueryText({ text }: { text: string | undefined }) {
  if (text === undefined) return null
  return <span className="min-w-0 text-[11px] break-words text-muted-foreground">for “{text}”</span>
}

/** The scores of the entry that found an item, quiet beside its place. */
function Scores({ scores }: { scores: MethodScores }) {
  const text = scoresText(scores)
  if (text === '') return null
  return (
    <span className="font-mono text-[11px] text-muted-foreground tabular-nums" title={SCORES_TITLE}>
      {text}
    </span>
  )
}

/** One item of the entity search: rank, type, name with identity, the part
 * that matched — with the custom index that found it, its scores and, from a
 * named search with several texts, the text it ranked best for — and its
 * snippet. */
export function EntitySearchItemRow({
  ontologyKey,
  lensKey,
  schema,
  item,
}: {
  ontologyKey: string
  lensKey: string
  schema: RuntimeSchema
  item: EntitySearchItem
}) {
  const { match } = item
  const type = schema.entityTypes.find((t) => t.key === item.entity._entityTypeKey)
  // A custom index is named, so a row found through it says which one.
  const index = useSearchCatalog(ontologyKey, lensKey).data?.find((i) => i.key === match.index)
  const part =
    match.part === 'relation'
      ? `Relation · ${
          schema.relationTypes.find((r) => r.key === match.relationType)?.displayName ??
          match.relationType
        }${match.target !== undefined ? ` → ${entityLabel(match.target)}` : ''}`
      : match.part === 'passage'
        ? `Passage${
            match.property != null
              ? ` · ${type?.properties.find((p) => p.key === match.property)?.displayName ?? match.property}`
              : ''
          }`
        : 'Own fields'
  return (
    <li className="flex gap-3 px-4 py-2.5">
      <span className="w-6 shrink-0 pt-0.5 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
        {item.rank}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <TypeChip
            typeKey={item.entity._entityTypeKey}
            displayName={type?.displayName ?? item.entity._entityTypeKey}
            size="sm"
          />
          <Link
            to={entityLink(ontologyKey, lensKey, item.entity)}
            className="truncate text-[13px] font-medium hover:underline"
          >
            {entityLabel(item.entity)}
          </Link>
          {item.entity.identity !== undefined && (
            <IdentityText identity={identityText(item.entity.identity)} />
          )}
          <span className="text-[11px] text-muted-foreground" title={index?.name ?? match.index}>
            {part}
            {index?.kind === 'custom' && ` · via ${index.name}`}
          </span>
          <Scores scores={match.scores} />
          <QueryText text={match.queryText} />
        </div>
        {match.snippet !== null && (
          <p className="line-clamp-2 text-[12px] text-muted-foreground">{match.snippet}</p>
        )}
      </div>
    </li>
  )
}

/** An entity search response as Advanced search shows it: the summary, then
 * the ranked items. */
export function EntitySearchResult({
  ontologyKey,
  lensKey,
  schema,
  response,
}: {
  ontologyKey: string
  lensKey: string
  schema: RuntimeSchema
  response: EntitySearchResponse
}) {
  return (
    <div className="space-y-2">
      <SearchSummary
        ontologyKey={ontologyKey}
        lensKey={lensKey}
        schema={schema}
        mode="entities"
        response={response}
      />
      {response.items.length === 0 ? (
        <p className="rounded-xl border bg-card p-6 text-center text-[13px] text-muted-foreground">
          Nothing found.
        </p>
      ) : (
        <ol className="divide-y overflow-hidden rounded-xl border bg-card">
          {response.items.map((item) => (
            <EntitySearchItemRow
              key={item.entity._id}
              ontologyKey={ontologyKey}
              lensKey={lensKey}
              schema={schema}
              item={item}
            />
          ))}
        </ol>
      )}
    </div>
  )
}

/** A passage's text, a few lines at first: a long one opens in full on request. */
function PassageText({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 420 || text.split('\n').length > 5
  return (
    <div>
      <p className={cn('whitespace-pre-wrap text-[12px] leading-relaxed', long && !open && 'line-clamp-5')}>
        {text}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
        >
          {open ? 'Show less' : 'Show all'}
        </button>
      )}
    </div>
  )
}

/** One item of the passage search: rank, type, name with identity, the
 * document — which opens the passage's document — and the passage's text. */
export function PassageSearchItemRow({
  ontologyKey,
  lensKey,
  schema,
  item,
  onOpen,
}: {
  ontologyKey: string
  lensKey: string
  schema: RuntimeSchema
  item: PassageSearchItem
  onOpen: (target: DocumentViewerTarget) => void
}) {
  const { entity, passage } = item
  const type = schema.entityTypes.find((t) => t.key === entity._entityTypeKey)
  const property = type?.properties.find((p) => p.key === passage.property)
  return (
    <li className="flex gap-3 px-4 py-2.5">
      <span className="w-6 shrink-0 pt-0.5 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
        {item.rank}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <TypeChip
            typeKey={entity._entityTypeKey}
            displayName={type?.displayName ?? entity._entityTypeKey}
            size="sm"
          />
          <Link
            to={entityLink(ontologyKey, lensKey, entity)}
            className="truncate text-[13px] font-medium hover:underline"
          >
            {entityLabel(entity)}
          </Link>
          {entity.identity !== undefined && <IdentityText identity={identityText(entity.identity)} />}
          {property !== undefined ? (
            <button
              type="button"
              onClick={() =>
                onOpen({
                  entityTypeKey: entity._entityTypeKey,
                  entityId: entity._id,
                  entityLabel: entityLabel(entity),
                  property,
                  length: passage.charOffset + passage.charLength,
                })
              }
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
            >
              <FileText className="size-3" />
              {property.displayName}
            </button>
          ) : (
            <span className="font-mono text-[11px] text-muted-foreground">{passage.property}</span>
          )}
          <Scores scores={passage.scores} />
          <QueryText text={passage.queryText} />
        </div>
        {passage.text !== undefined && <PassageText text={passage.text} />}
      </div>
    </li>
  )
}

/** A passage search response as Advanced search shows it: the summary, then
 * the ranked passages; a passage's document opens in the document viewer. */
export function PassageSearchResult({
  ontologyKey,
  lensKey,
  schema,
  response,
}: {
  ontologyKey: string
  lensKey: string
  schema: RuntimeSchema
  response: PassageSearchResponse
}) {
  const [viewer, setViewer] = useState<DocumentViewerTarget | null>(null)
  return (
    <div className="space-y-2">
      <SearchSummary
        ontologyKey={ontologyKey}
        lensKey={lensKey}
        schema={schema}
        mode="passages"
        response={response}
      />
      {response.items.length === 0 ? (
        <p className="rounded-xl border bg-card p-6 text-center text-[13px] text-muted-foreground">
          Nothing found.
        </p>
      ) : (
        <ol className="divide-y overflow-hidden rounded-xl border bg-card">
          {response.items.map((item) => (
            <PassageSearchItemRow
              key={`${item.entity._id}/${item.passage.property}/${item.passage.ordinal}`}
              ontologyKey={ontologyKey}
              lensKey={lensKey}
              schema={schema}
              item={item}
              onOpen={setViewer}
            />
          ))}
        </ol>
      )}
      <DocumentViewerDialog
        ontologyKey={ontologyKey}
        lensKey={lensKey}
        target={viewer}
        onClose={() => setViewer(null)}
      />
    </div>
  )
}
