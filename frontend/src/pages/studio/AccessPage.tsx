import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Layers, Plus, Search, X } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useLenses } from '@/api/hooks'
import { qk } from '@/api/queryKeys'
import type { AccessAssignment, Role, User } from '@/api/types'
import * as users from '@/api/users'
import { invalidateAccess, userHandle } from '@/components/access/access'
import { RemoveAssignmentButton, RoleBadge } from '@/components/access/shared'
import { useAccess } from '@/components/auth/useAccess'
import { PageHeader } from '@/components/PageHeader'
import { useDebouncedValue } from '@/components/palette/usePaletteSearch'
import { toastError } from '@/components/studio/lib'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { LENS_ROLES, ROLE_LABELS, canRemoveAssignment, groupAccess } from '@/lib/access'

const SEARCH_LIMIT = 8

/* ------------------------------- user picker -------------------------------- */

/** Search users by name, email or username and pick one. */
function UserPicker({ value, onChange }: { value: User | null; onChange: (user: User | null) => void }) {
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search.trim(), 250)
  const results = useQuery({
    queryKey: qk.userList(debounced, SEARCH_LIMIT),
    queryFn: () => users.listUsers({ search: debounced, limit: SEARCH_LIMIT }),
    enabled: value === null && debounced !== '',
  })

  if (value !== null) {
    return (
      <div className="flex h-8 items-center gap-2 rounded-md border px-2 text-[13px]">
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{value.displayName}</span>
          {userHandle(value) !== null && (
            <span className="text-muted-foreground"> · {userHandle(value)}</span>
          )}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Choose another user"
          onClick={() => {
            onChange(null)
            setSearch('')
          }}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    )
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-4 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        id="access-user"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search users…"
        autoComplete="off"
        className="h-8 pl-8 text-[13px]"
      />
      {debounced !== '' && (
        <div className="mt-1 overflow-hidden rounded-md border bg-popover">
          {results.isPending ? (
            <Skeleton className="m-2 h-5 w-2/3" />
          ) : results.isError ? (
            <p className="px-3 py-2 text-[12px] text-destructive">{results.error.message}</p>
          ) : results.data.items.length === 0 ? (
            <p className="px-3 py-2 text-[12px] text-muted-foreground">No user matches “{debounced}”.</p>
          ) : (
            <ul>
              {results.data.items.map((user) => (
                <li key={user.id}>
                  <button
                    type="button"
                    onClick={() => onChange(user)}
                    className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
                  >
                    <span className="font-medium">{user.displayName}</span>
                    {userHandle(user) !== null && (
                      <span className="truncate text-[12px] text-muted-foreground">{userHandle(user)}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/* ---------------------------------- add ------------------------------------- */

/** User → lens → Reader, Proposer or Writer. A user's role on a lens replaces the one held before. */
function AddAccessForm({ ontologyKey }: { ontologyKey: string }) {
  const queryClient = useQueryClient()
  const { data: lenses } = useLenses(ontologyKey)
  const [user, setUser] = useState<User | null>(null)
  const [lensKey, setLensKey] = useState('')
  const [role, setRole] = useState<Role>('reader')

  const add = useMutation({
    mutationFn: () => users.addAssignment(user!.id, { role, ontologyKey, lensKey }),
    onSuccess: () => {
      invalidateAccess(queryClient)
      toast.success(`${user!.displayName} is now ${ROLE_LABELS[role]} on ${lensKey}`)
      setUser(null)
    },
    onError: toastError,
  })

  const ready = user !== null && lensKey !== ''

  return (
    <form
      className="grid items-start gap-3 rounded-xl border bg-card p-4 md:grid-cols-[minmax(0,1fr)_12rem_9rem_auto]"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready && !add.isPending) add.mutate()
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="access-user" className="text-[12px]">
          User
        </Label>
        <UserPicker value={user} onChange={setUser} />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-[12px]">Lens</Label>
        <Select value={lensKey} onValueChange={setLensKey}>
          <SelectTrigger className="w-full text-[13px]" aria-label="Lens">
            <SelectValue placeholder="Lens" />
          </SelectTrigger>
          <SelectContent>
            {(lenses ?? []).map((l) => (
              <SelectItem key={l.lensId} value={l.key}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label className="text-[12px]">Role</Label>
        <Select value={role} onValueChange={(value) => setRole(value as Role)}>
          <SelectTrigger className="w-full text-[13px]" aria-label="Role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LENS_ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={!ready || add.isPending} className="md:mt-[1.125rem]">
        <Plus className="size-3.5" /> Add
      </Button>
    </form>
  )
}

/* ---------------------------------- list ------------------------------------ */

function AccessSection({
  title,
  subtitle,
  rows,
  empty,
}: {
  title: string
  subtitle?: string
  rows: AccessAssignment[]
  empty: string
}) {
  const access = useAccess()
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {subtitle !== undefined && (
          <span className="truncate font-mono text-[11.5px] text-muted-foreground">{subtitle}</span>
        )}
      </header>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {rows.map((a) => (
            <li key={a.id} className="flex items-center gap-2 px-4 py-1.5">
              <span className="min-w-0 truncate text-[13px] font-medium">{a.user.displayName}</span>
              {userHandle(a.user) !== null && (
                <span className="min-w-0 truncate text-[12px] text-muted-foreground">
                  {userHandle(a.user)}
                </span>
              )}
              {a.user.status === 'disabled' && (
                <span className="text-[11px] text-destructive">disabled</span>
              )}
              <span className="ml-auto shrink-0">
                <RoleBadge role={a.role} />
              </span>
              {canRemoveAssignment(access, a) ? (
                <RemoveAssignmentButton
                  userId={a.user.id}
                  assignmentId={a.id}
                  label={`${ROLE_LABELS[a.role]} of ${a.user.displayName}`}
                />
              ) : (
                <span className="size-6 shrink-0" />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * `/o/:ontologyKey/studio/access` — who may use this ontology: its
 * administrators, and the lens roles on each lens.
 */
export function AccessPage() {
  const { ontologyKey } = useParams<{ ontologyKey: string }>()
  const { data: lenses } = useLenses(ontologyKey)
  const list = useQuery({
    queryKey: qk.access(ontologyKey ?? ''),
    queryFn: () => users.listOntologyAccess(ontologyKey!),
    enabled: ontologyKey !== undefined,
  })

  if (ontologyKey === undefined) return null

  const { admins, byLens } = groupAccess(list.data?.assignments ?? [])

  return (
    <div>
      <PageHeader
        title="Access"
        description="Who may use this ontology: its administrators, and who reads or writes through each lens."
      />
      <div className="space-y-4 p-6">
        <AddAccessForm ontologyKey={ontologyKey} />
        {list.isPending || lenses === undefined ? (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </div>
        ) : list.isError ? (
          <p className="text-[13px] text-destructive">{list.error.message}</p>
        ) : (
          <>
            <AccessSection
              title={`${ROLE_LABELS.ontology_admin}s`}
              rows={admins}
              empty="No administrator."
            />
            {lenses.length === 0 && (
              <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Layers className="size-4" /> No lenses yet: Reader, Proposer and Writer roles are held on a lens.
              </p>
            )}
            {lenses.map((lens) => (
              <AccessSection
                key={lens.lensId}
                title={lens.name}
                subtitle={lens.key}
                rows={byLens.get(lens.key) ?? []}
                empty="No one reads or writes through this lens."
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
