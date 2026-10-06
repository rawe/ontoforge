import { useQuery } from '@tanstack/react-query'
import { Languages, ListTree, Plus, Settings2 } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import * as model from '@/api/model'
import { qk } from '@/api/queryKeys'
import {
  useIndexSchema,
  useSearchIndices,
  useSearchSettings,
  useSwitchManagedIndex,
  useUpdateSearchSettings,
} from '@/api/searchIndexHooks'
import type { EntityType, KeywordLanguage, SearchIndexRecord } from '@/api/types'
import { PageHeader } from '@/components/PageHeader'
import { TypeChip } from '@/components/TypeChip'
import {
  countFields,
  managedByEntityType,
  toggleKeywordLanguage,
} from '@/components/search/searchIndexModel'
import {
  KindBadge,
  ManagedSwitch,
  RepresentationBadges,
  SearchFeatureGate,
  StatusChip,
} from '@/components/search/shared'
import { toastError } from '@/components/studio/lib'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const TABS = ['indices', 'settings'] as const
type Tab = (typeof TABS)[number]

/** `/o/:ontologyKey/studio/search` — search indices and search settings. */
export function SearchPage() {
  const { ontologyKey } = useParams<{ ontologyKey: string }>()
  if (ontologyKey === undefined) return null
  return (
    <SearchFeatureGate>
      <SearchPageContent ontologyKey={ontologyKey} />
    </SearchFeatureGate>
  )
}

function useEntityTypeNames(ontologyKey: string) {
  const { data } = useQuery({
    queryKey: qk.model(ontologyKey, 'entity-types'),
    queryFn: () => model.listEntityTypes(ontologyKey),
  })
  return new Map((data ?? []).map((t: EntityType) => [t.key, t.displayName]))
}

function SearchPageContent({ ontologyKey }: { ontologyKey: string }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : 'indices'
  const indices = useSearchIndices(ontologyKey)
  const typeNames = useEntityTypeNames(ontologyKey)

  return (
    <div>
      <PageHeader
        title="Search"
        description="Search indices decide what search finds and how. Managed indices follow the schema; custom indices add fields and relations for agents and retriever agents."
        actions={
          <Button size="sm" asChild>
            <Link to={`/o/${ontologyKey}/studio/search/new`}>
              <Plus className="size-3.5" /> New index
            </Link>
          </Button>
        }
      />
      <div className="p-6">
        <Tabs
          value={tab}
          onValueChange={(v) => setSearchParams(v === 'indices' ? {} : { tab: v }, { replace: true })}
        >
          <TabsList className="mb-4">
            <TabsTrigger value="indices">
              <ListTree className="size-3.5" /> Indices
            </TabsTrigger>
            <TabsTrigger value="settings">
              <Settings2 className="size-3.5" /> Settings
            </TabsTrigger>
          </TabsList>
          <TabsContent value="indices">
            {indices.isPending && <Skeleton className="h-48 rounded-xl" />}
            {indices.isError && (
              <p className="text-[13px] text-destructive">{indices.error.message}</p>
            )}
            {indices.data !== undefined && (
              <IndexTables
                ontologyKey={ontologyKey}
                records={indices.data}
                typeNames={typeNames}
              />
            )}
          </TabsContent>
          <TabsContent value="settings">
            <SettingsTab
              ontologyKey={ontologyKey}
              records={indices.data}
              typeNames={typeNames}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

/* --------------------------------- indices --------------------------------- */

function IndexTables({
  ontologyKey,
  records,
  typeNames,
}: {
  ontologyKey: string
  records: SearchIndexRecord[]
  typeNames: Map<string, string>
}) {
  const custom = records.filter((r) => r.kind === 'custom')
  const managed = records.filter((r) => r.kind !== 'custom')
  const switcher = useSwitchManagedIndex(ontologyKey)
  const link = (key: string) => `/o/${ontologyKey}/studio/search/${encodeURIComponent(key)}`

  const nameCell = (r: SearchIndexRecord) => (
    <TableCell>
      <Link to={link(r.key)} className="group grid">
        <span className="truncate text-[13px] font-medium group-hover:underline">
          {r.definition.name}
        </span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">{r.key}</span>
      </Link>
    </TableCell>
  )
  const typeCell = (r: SearchIndexRecord) => (
    <TableCell>
      <TypeChip
        typeKey={r.definition.entityType}
        displayName={typeNames.get(r.definition.entityType)}
        size="sm"
      />
    </TableCell>
  )

  return (
    <div className="grid gap-6">
      <section className="space-y-2.5">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold">
          Custom indices
          <span className="font-normal text-muted-foreground">{custom.length}</span>
        </h2>
        {custom.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-[13px] text-muted-foreground">
            No custom indices yet. A custom index picks own fields and relations — e.g.
            people with their employer — so one search covers what a relation adds.{' '}
            <Link
              to={`/o/${ontologyKey}/studio/search/new`}
              className="text-foreground underline underline-offset-2"
            >
              New index
            </Link>
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Index</TableHead>
                  <TableHead>Entity type</TableHead>
                  <TableHead>Reads</TableHead>
                  <TableHead>Representations</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {custom.map((r) => (
                  <TableRow key={r.key}>
                    {nameCell(r)}
                    {typeCell(r)}
                    <TableCell className="text-[12px] text-muted-foreground">
                      {countFields(r.definition)} fields
                      {r.definition.relations.length > 0 &&
                        ` · ${r.definition.relations.length} relation group${r.definition.relations.length === 1 ? '' : 's'}`}
                    </TableCell>
                    <TableCell>
                      <RepresentationBadges definition={r.definition} />
                    </TableCell>
                    <TableCell>
                      <StatusChip status={r.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-2.5">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold">
          Managed indices
          <span className="font-normal text-muted-foreground">{managed.length}</span>
        </h2>
        <p className="max-w-2xl text-[12px] text-muted-foreground">
          One default index per entity type (its own string properties) and one passage
          index per document property. They follow the schema and can only be switched on
          or off.
        </p>
        {managed.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-[13px] text-muted-foreground">
            No managed indices — entity types without string or document properties get
            none.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Index</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Entity type</TableHead>
                  <TableHead>Representations</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-16">On</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {managed.map((r) => (
                  <TableRow key={r.key}>
                    {nameCell(r)}
                    <TableCell>
                      <KindBadge kind={r.kind} />
                    </TableCell>
                    {typeCell(r)}
                    <TableCell>
                      <RepresentationBadges definition={r.definition} />
                    </TableCell>
                    <TableCell>
                      <StatusChip status={r.status} />
                    </TableCell>
                    <TableCell>
                      <ManagedSwitch record={r} switcher={switcher} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  )
}

/* --------------------------------- settings -------------------------------- */

const LANGUAGES: { value: KeywordLanguage; label: string }[] = [
  { value: 'german', label: 'German' },
  { value: 'english', label: 'English' },
]

function SettingsTab({
  ontologyKey,
  records,
  typeNames,
}: {
  ontologyKey: string
  records: SearchIndexRecord[] | undefined
  typeNames: Map<string, string>
}) {
  const settings = useSearchSettings(ontologyKey)
  const update = useUpdateSearchSettings(ontologyKey)
  const switcher = useSwitchManagedIndex(ontologyKey)
  const schema = useIndexSchema(ontologyKey)
  const propertyName = (typeKey: string, key: string) =>
    schema?.entityTypes
      .find((t) => t.key === typeKey)
      ?.properties.find((p) => p.key === key)?.displayName ?? key
  const languages = settings.data?.keywordLanguages ?? []
  const groups = managedByEntityType(records ?? [])

  return (
    <div className="grid max-w-3xl gap-4">
      <section className="rounded-xl border bg-card p-4">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold">
          <Languages className="size-4 text-muted-foreground" /> Keyword languages
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Keyword search stems every entry in each language of this set and matches a
          query in each of them. Changing the set rebuilds the keyword entries of every
          index in the background; search keeps answering from the current entries until
          the rebuild is done. At least one language stays selected.
        </p>
        {settings.isPending && <Skeleton className="mt-3 h-6 w-48" />}
        {settings.data !== undefined && (
          <div className="mt-3 flex gap-5">
            {LANGUAGES.map(({ value, label }) => {
              const checked = languages.includes(value)
              const last = checked && languages.length === 1
              return (
                <label
                  key={value}
                  className="flex items-center gap-2 text-[13px]"
                  title={last ? 'At least one language is required' : undefined}
                >
                  <Checkbox
                    checked={checked}
                    disabled={last || update.isPending}
                    onCheckedChange={(on) => {
                      update.mutate(
                        {
                          keywordLanguages: toggleKeywordLanguage(languages, value, on === true),
                        },
                        {
                          onSuccess: () =>
                            toast.success(
                              'Keyword languages saved — keyword entries rebuild in the background',
                            ),
                          onError: toastError,
                        },
                      )
                    }}
                  />
                  {label}
                </label>
              )
            })}
          </div>
        )}
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="text-[13px] font-semibold">Managed indices</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Every entity type gets a default index over its own string properties, and every
          document property a passage index. Switch off what search should not cover.
        </p>
        {records === undefined && <Skeleton className="mt-3 h-24 rounded-lg" />}
        {records !== undefined && groups.length === 0 && (
          <p className="mt-3 text-[13px] text-muted-foreground">No managed indices.</p>
        )}
        <div className="mt-3 grid gap-3">
          {groups.map((g) => (
            <div key={g.entityType} className="rounded-lg border">
              <div className="border-b px-3 py-2">
                <TypeChip
                  typeKey={g.entityType}
                  displayName={typeNames.get(g.entityType)}
                  size="sm"
                />
              </div>
              <ul className="divide-y">
                {[...(g.defaultIndex === null ? [] : [g.defaultIndex]), ...g.passages].map(
                  (r) => (
                    <li key={r.key} className="flex items-center gap-3 px-3 py-2">
                      <div className="grid min-w-0 flex-1">
                        <span className="text-[13px]">
                          {r.kind === 'default'
                            ? 'Default index'
                            : `Passages of ${propertyName(g.entityType, r.documentProperty ?? r.definition.fields[0] ?? '')}`}
                        </span>
                        <Link
                          to={`/o/${ontologyKey}/studio/search/${encodeURIComponent(r.key)}`}
                          className="truncate font-mono text-[11px] text-muted-foreground hover:underline"
                        >
                          {r.key}
                        </Link>
                      </div>
                      <StatusChip status={r.status} />
                      <ManagedSwitch record={r} switcher={switcher} />
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
