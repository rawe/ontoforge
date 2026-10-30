import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Download,
  Plus,
  Search,
  SearchX,
  Table2,
  Waypoints,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useRuntimeSchema } from '@/api/hooks'
import { useCanEdit } from '@/components/auth/useAccess'
import { qk } from '@/api/queryKeys'
import { listEntities, type ListEntitiesParams } from '@/api/runtime'
import { GONE_CHANGESET_TEXT } from '@/api/staging'
import type { EntityInstance, SchemaProperty } from '@/api/types'
import { useRuntimeWrites, type StagedOutcome } from '@/api/writes'
import { DocumentViewerDialog, type DocumentViewerTarget } from '@/components/DocumentViewerDialog'
import { EmptyState } from '@/components/EmptyState'
import { TypeNotInLens } from '@/components/home/TypeNotInLens'
import { PageHeader } from '@/components/PageHeader'
import { TypeChip } from '@/components/TypeChip'
import { openQuickAdd } from '@/components/quickadd/quickAddBus'
import { BulkActionBar } from '@/components/table/BulkActionBar'
import { bulkDeleteSummary } from '@/components/table/bulkDelete'
import { CellValue } from '@/components/table/CellValue'
import { ColumnVisibilityMenu } from '@/components/table/ColumnVisibilityMenu'
import { FilterChips } from '@/components/table/FilterChips'
import { FilterPopover } from '@/components/table/FilterPopover'
import { absoluteTime, relativeTime } from '@/components/table/format'
import {
  filtersToParam,
  relationSubjects,
  withCondition,
  type FilterCondition,
  type FilterSubjects,
} from '@/components/table/filters'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { displayLabel } from '@/lib/displayLabel'
import { isDocumentStub } from '@/lib/documents'
import { pinnedChangeset, usePinnedChangeset } from '@/lib/pinnedChangeset'

const PAGE_SIZE = 25

/** The identity as a filter subject: the server filters `_identity` as a string. */
const IDENTITY_SUBJECT: SchemaProperty = {
  key: '_identity',
  displayName: 'Identity',
  description: null,
  dataType: 'string',
  required: false,
  defaultValue: null,
}

/** Sortable column header: label + asc/desc indicator. */
function SortableHeader({
  label,
  sorted,
  onToggle,
}: {
  label: string
  sorted: false | 'asc' | 'desc'
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className="-ml-1 inline-flex h-6 items-center gap-1 rounded-sm px-1 text-left font-medium transition-colors hover:text-foreground"
      onClick={onToggle}
    >
      {label}
      {sorted === 'asc' ? (
        <ArrowUp className="size-3 shrink-0" />
      ) : sorted === 'desc' ? (
        <ArrowDown className="size-3 shrink-0" />
      ) : (
        <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground/50" />
      )}
    </button>
  )
}

function csvEscape(value: unknown): string {
  const s =
    value === undefined || value === null
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

/** `/o/:ontologyKey/w/:lensKey/t/:typeKey` — server-driven table over one entity type. */
export function TypeTablePage() {
  const { ontologyKey, lensKey, typeKey } = useParams<{ ontologyKey: string; lensKey: string; typeKey: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // `?new=1` opens Quick Add pre-scoped to this type (linked from empty states).
  const wantsNew = searchParams.get('new') === '1'
  useEffect(() => {
    if (!wantsNew || typeKey === undefined) return
    openQuickAdd(typeKey)
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    setSearchParams(next, { replace: true })
  }, [wantsNew, typeKey, searchParams, setSearchParams])
  const queryClient = useQueryClient()
  const writes = useRuntimeWrites(ontologyKey ?? '', lensKey ?? '')
  const pinned = usePinnedChangeset(ontologyKey ?? '', lensKey ?? '')
  const canEdit = useCanEdit(ontologyKey ?? '', lensKey ?? '')
  const schema = useRuntimeSchema(ontologyKey, lensKey)
  const type = schema.data?.entityTypes.find((t) => t.key === typeKey)
  const nameProperty = type?.nameProperty

  // Required properties first — this is also the column order.
  const properties = useMemo<SchemaProperty[]>(() => {
    if (type === undefined) return []
    return [...type.properties].sort((a, b) => Number(b.required) - Number(a.required))
  }, [type])

  // The identity, a system property: a string column, sortable and filterable.
  const hasIdentity = (type?.identityProperties ?? null) !== null
  const filterSubjects = useMemo<FilterSubjects>(
    () => ({
      properties: hasIdentity ? [IDENTITY_SUBJECT, ...properties] : properties,
      relations:
        typeKey === undefined || schema.data === undefined
          ? []
          : relationSubjects(typeKey, schema.data.relationTypes, schema.data.entityTypes),
    }),
    [properties, typeKey, schema.data, hasIdentity],
  )

  const [page, setPage] = useState(0)
  const [sorting, setSorting] = useState<SortingState>([{ id: '_updatedAt', desc: true }])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    _createdAt: false,
  })
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})
  const [qInput, setQInput] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [filters, setFilters] = useState<FilterCondition[]>([])
  const [docTarget, setDocTarget] = useState<DocumentViewerTarget | null>(null)

  // Debounce the quick filter.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(qInput.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [qInput])

  // Any change to search/filters/sort restarts at page 1.
  const resetKey = JSON.stringify([debouncedQ, filters, sorting])
  const prevResetKey = useRef(resetKey)
  useEffect(() => {
    if (prevResetKey.current !== resetKey) {
      prevResetKey.current = resetKey
      setPage(0)
    }
  }, [resetKey])

  // Reset table-local state when navigating to another type — or lens, whose
  // schema may hide what a filter names.
  const prevTypeKey = useRef(`${lensKey}/${typeKey}`)
  useEffect(() => {
    if (prevTypeKey.current !== `${lensKey}/${typeKey}`) {
      prevTypeKey.current = `${lensKey}/${typeKey}`
      setPage(0)
      setSorting([{ id: '_updatedAt', desc: true }])
      setColumnVisibility({ _createdAt: false })
      setRowSelection({})
      setQInput('')
      setDebouncedQ('')
      setFilters([])
    }
  }, [lensKey, typeKey])

  // Hidden columns are excluded from the request via `fields` (always keep
  // _id). Exception: `fields` returns document properties as their RAW full
  // content (stubs only appear in unprojected reads) — when a document column
  // is visible, skip the projection entirely so the table gets cheap stubs
  // and never pulls document content.
  const params = useMemo<ListEntitiesParams>(() => {
    const sort = sorting[0]
    const allIds = [
      ...(hasIdentity ? ['_identity'] : []),
      ...properties.map((p) => p.key),
      '_updatedAt',
      '_createdAt',
    ]
    const visibleIds = allIds.filter((id) => columnVisibility[id] !== false)
    const anyHidden = visibleIds.length < allIds.length
    const documentKeys = new Set(
      properties.filter((p) => p.dataType === 'document').map((p) => p.key),
    )
    const anyDocumentVisible = visibleIds.some((id) => documentKeys.has(id))
    return {
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      sort: sort?.id ?? '_updatedAt',
      order: sort === undefined || sort.desc ? 'desc' : 'asc',
      ...(debouncedQ !== '' ? { q: debouncedQ } : {}),
      ...(anyHidden && !anyDocumentVisible ? { fields: ['_id', ...visibleIds] } : {}),
      filter: filtersToParam(filters, filterSubjects),
    }
  }, [sorting, properties, columnVisibility, page, debouncedQ, filters, hasIdentity, filterSubjects])

  const entities = useQuery({
    queryKey: qk.entities(ontologyKey ?? '', lensKey ?? '', typeKey ?? '', params),
    queryFn: () => listEntities(ontologyKey!, lensKey!, typeKey!, params),
    enabled:
      ontologyKey !== undefined &&
      lensKey !== undefined &&
      typeKey !== undefined &&
      type !== undefined,
    placeholderData: keepPreviousData,
  })

  // Clamp the page if the last rows of a trailing page were deleted.
  useEffect(() => {
    const total = entities.data?.total
    if (total !== undefined && page > 0 && page * PAGE_SIZE >= total) {
      setPage(Math.max(0, Math.ceil(total / PAGE_SIZE) - 1))
    }
  }, [entities.data?.total, page])

  const columns = useMemo<ColumnDef<EntityInstance>[]>(() => {
    const defs: ColumnDef<EntityInstance>[] = [
      {
        id: 'select',
        enableHiding: false,
        enableSorting: false,
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && 'indeterminate')
            }
            onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked === true)}
            aria-label="Select page"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(checked) => row.toggleSelected(checked === true)}
            onClick={(e) => e.stopPropagation()}
            aria-label="Select row"
          />
        ),
      },
      ...(hasIdentity
        ? [
            {
              id: '_identity',
              accessorFn: (row: EntityInstance) => row._identity,
              header: 'Identity',
              cell: ({ row }: { row: { original: EntityInstance } }) =>
                row.original._identity === undefined ? (
                  <span className="text-muted-foreground/50">—</span>
                ) : (
                  <span className="font-mono text-[12px]">{row.original._identity}</span>
                ),
            } satisfies ColumnDef<EntityInstance>,
          ]
        : []),
      ...properties.map<ColumnDef<EntityInstance>>((p) => ({
        id: p.key,
        accessorFn: (row) => row[p.key],
        header: p.displayName,
        cell: ({ row }) => {
          const value = row.original[p.key]
          return (
            <CellValue
              value={value}
              dataType={p.dataType}
              onOpenDocument={
                isDocumentStub(value)
                  ? () =>
                      setDocTarget({
                        entityTypeKey: typeKey!,
                        entityId: row.original._id,
                        entityLabel: displayLabel(row.original, nameProperty),
                        property: p,
                        length: value.length,
                      })
                  : undefined
              }
            />
          )
        },
      })),
      {
        id: '_updatedAt',
        accessorFn: (row) => row._updatedAt,
        header: 'Updated',
        cell: ({ row }) => {
          const iso = row.original._updatedAt
          if (typeof iso !== 'string') return <span className="text-muted-foreground/50">—</span>
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="whitespace-nowrap text-muted-foreground">
                  {relativeTime(iso)}
                </span>
              </TooltipTrigger>
              <TooltipContent>{absoluteTime(iso)}</TooltipContent>
            </Tooltip>
          )
        },
      },
      {
        id: '_createdAt',
        accessorFn: (row) => row._createdAt,
        header: 'Created',
        cell: ({ row }) => {
          const iso = row.original._createdAt
          if (typeof iso !== 'string') return <span className="text-muted-foreground/50">—</span>
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="whitespace-nowrap text-muted-foreground">
                  {relativeTime(iso)}
                </span>
              </TooltipTrigger>
              <TooltipContent>{absoluteTime(iso)}</TooltipContent>
            </Tooltip>
          )
        },
      },
      {
        id: 'actions',
        enableHiding: false,
        enableSorting: false,
        header: () => null,
        cell: ({ row }) => (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover/row:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  navigate(
                    `/o/${ontologyKey}/w/${lensKey}/explore?focus=${typeKey}:${row.original._id}`,
                  )
                }}
                aria-label="Open in Explorer"
              >
                <Waypoints className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open in Explorer</TooltipContent>
          </Tooltip>
        ),
      },
    ]
    // Selecting rows only leads to deleting them.
    return canEdit ? defs : defs.filter((d) => d.id !== 'select')
  }, [properties, navigate, ontologyKey, lensKey, typeKey, nameProperty, canEdit, hasIdentity])

  const table = useReactTable({
    data: entities.data?.items ?? [],
    columns,
    getRowId: (row) => row._id,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    enableSorting: true,
    state: { sorting, columnVisibility, rowSelection },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    rowCount: entities.data?.total ?? 0,
  })

  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id])

  const bulkDelete = useMutation({
    mutationFn: async (ids: string[]) => {
      const pinnedAtStart = pinnedChangeset(ontologyKey!, lensKey!)
      const verb = pinnedAtStart === null ? 'Deleting' : 'Staging'
      const toastId = toast.loading(`${verb} 0/${ids.length}…`)
      let failed = 0
      let skipped = 0
      let staged: StagedOutcome | undefined
      let gone = false
      for (const [index, id] of ids.entries()) {
        // A pin or leave during the run stops it: the rest would land elsewhere.
        if (pinnedChangeset(ontologyKey!, lensKey!) !== pinnedAtStart) {
          skipped = ids.length - index
          break
        }
        try {
          const outcome = await writes.deleteEntity(typeKey!, id)
          if (outcome.kind === 'staged') staged = outcome
        } catch (err) {
          failed++
          gone ||= err instanceof Error && err.message === GONE_CHANGESET_TEXT
        }
        toast.loading(`${verb} ${index + 1}/${ids.length}…`, { id: toastId })
      }
      const summary = bulkDeleteSummary({
        total: ids.length,
        failed,
        skipped,
        staged: pinnedAtStart !== null,
      })
      if (gone) {
        toast.error(GONE_CHANGESET_TEXT, { id: toastId })
      } else if (!summary.ok) {
        toast.error(summary.text, { id: toastId })
      } else if (staged !== undefined) {
        toast.dismiss(toastId)
        writes.toastStaged(staged, summary.text)
      } else {
        toast.success(summary.text, { id: toastId })
      }
    },
    onSettled: () => {
      setRowSelection({})
      void queryClient.invalidateQueries({
        queryKey: qk.entities(ontologyKey ?? '', lensKey ?? '', typeKey ?? ''),
      })
    },
  })

  const exportCsv = () => {
    const items = entities.data?.items ?? []
    if (items.length === 0) return
    const visibleProps = properties.filter((p) => columnVisibility[p.key] !== false)
    const cols: { header: string; get: (e: EntityInstance) => unknown }[] = [
      { header: '_id', get: (e) => e._id },
      ...(hasIdentity && columnVisibility['_identity'] !== false
        ? [{ header: '_identity', get: (e: EntityInstance) => e._identity }]
        : []),
      ...visibleProps.map((p) => ({
        header: p.key,
        get: (e: EntityInstance) => e[p.key],
      })),
      ...(columnVisibility['_updatedAt'] !== false
        ? [{ header: '_updatedAt', get: (e: EntityInstance) => e._updatedAt }]
        : []),
      ...(columnVisibility['_createdAt'] !== false
        ? [{ header: '_createdAt', get: (e: EntityInstance) => e._createdAt }]
        : []),
    ]
    const lines = [
      cols.map((c) => csvEscape(c.header)).join(','),
      ...items.map((e) => cols.map((c) => csvEscape(c.get(e))).join(',')),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${typeKey}_page-${page + 1}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported ${items.length} rows`)
  }

  if (ontologyKey === undefined || lensKey === undefined || typeKey === undefined)
    return null

  if (schema.isPending) {
    return (
      <div className="p-6">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-6 h-8 w-full max-w-md" />
        <Skeleton className="mt-4 h-64 w-full rounded-lg" />
      </div>
    )
  }

  if (schema.data !== undefined && type === undefined) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16">
        <TypeNotInLens ontologyKey={ontologyKey} lensKey={lensKey} typeKey={typeKey} />
        <Button asChild size="sm" variant="link" className="mt-2 px-0">
          <Link to={`/o/${ontologyKey}/w/${lensKey}`}>Back to overview</Link>
        </Button>
      </div>
    )
  }
  if (type === undefined) return null

  const data = entities.data
  const hasActiveFilters = debouncedQ !== '' || filters.length > 0
  const totalPages = data !== undefined ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1
  const isTrulyEmpty = data !== undefined && data.total === 0 && !hasActiveFilters
  const isFilteredEmpty = data !== undefined && data.items.length === 0 && hasActiveFilters

  const clearFilters = () => {
    setQInput('')
    setDebouncedQ('')
    setFilters([])
  }

  const openRow = (row: EntityInstance) => {
    if (window.getSelection()?.toString() !== '') return
    navigate(`/o/${ontologyKey}/w/${lensKey}/e/${typeKey}/${row._id}`)
  }

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title={type.displayName}
        description={type.description ?? undefined}
        meta={
          <span className="flex items-center gap-2">
            <TypeChip typeKey={type.key} displayName={type.key} size="sm" />
            {data !== undefined && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {data.total} {data.total === 1 ? 'item' : 'items'}
              </span>
            )}
          </span>
        }
      />

      {isTrulyEmpty ? (
        <EmptyState
          icon={Table2}
          title={`Add your first ${type.displayName.toLowerCase()}`}
          description={
            canEdit
              ? `No ${type.displayName.toLowerCase()} entities exist yet. Create one to get started — or press ⌘K to search and add from anywhere.`
              : `No ${type.displayName.toLowerCase()} entities exist yet.`
          }
          action={
            canEdit ? (
              <Button asChild size="sm">
                <Link to={`/o/${ontologyKey}/w/${lensKey}/t/${typeKey}?new=1`}>
                  <Plus className="size-3.5" />
                  New {type.displayName}
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-1 flex-col px-6 pb-6">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder={`Search ${type.displayName.toLowerCase()}…`}
                className="h-8 w-56 pl-8 text-[13px]"
              />
            </div>
            <FilterPopover
              subjects={filterSubjects}
              active={filters}
              onAdd={(f) => setFilters((prev) => withCondition(prev, f))}
              values={{ ontologyKey: ontologyKey!, lensKey: lensKey!, typeKey: typeKey! }}
            />
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-[13px]"
                onClick={exportCsv}
                disabled={data === undefined || data.items.length === 0}
              >
                <Download className="size-3.5" />
                CSV
              </Button>
              <ColumnVisibilityMenu table={table} />
              {canEdit && (
                <Button size="sm" className="h-8 gap-1.5 text-[13px]" onClick={() => openQuickAdd(typeKey)}>
                  <Plus className="size-3.5" />
                  New {type.displayName}
                </Button>
              )}
            </div>
          </div>

          {filters.length > 0 && (
            <div className="pb-3">
              <FilterChips
                filters={filters}
                subjects={filterSubjects}
                onRemove={(id) => setFilters((prev) => prev.filter((f) => f.id !== id))}
                onClearAll={() => setFilters([])}
              />
            </div>
          )}

          {/* Table */}
          <div className="overflow-hidden rounded-lg border">
            <Table className="text-[13px]">
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id} className="hover:bg-transparent">
                    {headerGroup.headers.map((header) => {
                      const canSort = header.column.getCanSort()
                      return (
                        <TableHead
                          key={header.id}
                          className={
                            header.column.id === 'select'
                              ? 'w-9 pl-3'
                              : header.column.id === 'actions'
                                ? 'w-9'
                                : 'whitespace-nowrap text-xs text-muted-foreground'
                          }
                        >
                          {header.isPlaceholder ? null : canSort ? (
                            <SortableHeader
                              label={String(header.column.columnDef.header)}
                              sorted={header.column.getIsSorted()}
                              onToggle={() =>
                                header.column.toggleSorting(
                                  header.column.getIsSorted() === 'asc',
                                )
                              }
                            />
                          ) : (
                            flexRender(header.column.columnDef.header, header.getContext())
                          )}
                        </TableHead>
                      )
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody
                className={entities.isFetching && data !== undefined ? 'opacity-60' : undefined}
              >
                {entities.isPending ? (
                  Array.from({ length: 8 }, (_, i) => (
                    <TableRow key={i}>
                      {table.getVisibleLeafColumns().map((col) => (
                        <TableCell key={col.id} className="py-2">
                          <Skeleton className="h-3.5 w-full max-w-32" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : entities.isError ? (
                  <TableRow>
                    <TableCell
                      colSpan={table.getVisibleLeafColumns().length}
                      className="py-10 text-center text-[13px] text-muted-foreground"
                    >
                      Failed to load: {entities.error.message}
                    </TableCell>
                  </TableRow>
                ) : isFilteredEmpty ? (
                  <TableRow>
                    <TableCell colSpan={table.getVisibleLeafColumns().length} className="py-0">
                      <EmptyState
                        icon={SearchX}
                        title="No matches"
                        description="Nothing matches the current search and filters."
                        className="py-10"
                        action={
                          <Button variant="outline" size="sm" onClick={clearFilters}>
                            Clear filters
                          </Button>
                        }
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      data-state={row.getIsSelected() ? 'selected' : undefined}
                      tabIndex={0}
                      className="group/row cursor-pointer select-text focus-visible:bg-muted/60 focus-visible:outline-none"
                      onClick={() => openRow(row.original)}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          openRow(row.original)
                        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                          e.preventDefault()
                          const sibling =
                            e.key === 'ArrowDown'
                              ? e.currentTarget.nextElementSibling
                              : e.currentTarget.previousElementSibling
                          if (sibling instanceof HTMLElement) sibling.focus()
                        }
                      }}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className={
                            cell.column.id === 'select'
                              ? 'w-9 py-1.5 pl-3'
                              : cell.column.id === 'actions'
                                ? 'w-9 py-1'
                                : 'py-1.5'
                          }
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {data !== undefined && data.total > 0 && (
            <div className="flex items-center justify-between pt-3">
              <span className="text-xs tabular-nums text-muted-foreground">
                {data.total === 0
                  ? '0 items'
                  : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, data.total)} of ${data.total}`}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs tabular-nums text-muted-foreground">
                  Page {Math.min(page + 1, totalPages)} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-7"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="size-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-7"
                  disabled={page + 1 >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  aria-label="Next page"
                >
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            </div>
          )}

          <BulkActionBar
            count={selectedIds.length}
            typeName={type.displayName.toLowerCase()}
            deleting={bulkDelete.isPending}
            staging={pinned !== null}
            onDelete={() => bulkDelete.mutate(selectedIds)}
            onClear={() => setRowSelection({})}
          />

          <DocumentViewerDialog
            ontologyKey={ontologyKey}
            lensKey={lensKey}
            target={docTarget}
            onClose={() => setDocTarget(null)}
          />
        </div>
      )}
    </div>
  )
}
