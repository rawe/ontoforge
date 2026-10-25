import { useId, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Search, UserX, Users } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useLenses, useOntologies } from '@/api/hooks'
import { qk } from '@/api/queryKeys'
import type { Role, User } from '@/api/types'
import * as users from '@/api/users'
import { invalidateAccess, userHandle } from '@/components/access/access'
import { RemoveAssignmentButton, RoleBadge } from '@/components/access/shared'
import { NoAccess } from '@/components/auth/NoAccess'
import { useAccess } from '@/components/auth/useAccess'
import { UserMenu } from '@/components/auth/UserMenu'
import { EmptyState } from '@/components/EmptyState'
import { useDocumentTitle } from '@/components/layout/useDocumentTitle'
import { Logo } from '@/components/Logo'
import { useDebouncedValue } from '@/components/palette/usePaletteSearch'
import { toastError } from '@/components/studio/lib'
import { absoluteTime, relativeTime } from '@/components/table/format'
import { Badge } from '@/components/ui/badge'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  ROLE_LABELS,
  assignmentTarget,
  canRemoveAssignment,
  grantableRoles,
  roleScope,
} from '@/lib/access'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 50

function StatusBadge({ status }: { status: User['status'] }) {
  return status === 'active' ? (
    <Badge variant="outline" className="text-[11px]">
      Active
    </Badge>
  ) : (
    <Badge variant="destructive" className="text-[11px]">
      Disabled
    </Badge>
  )
}

function LastSignIn({ at }: { at: string | null }) {
  if (at === null) return <span className="text-muted-foreground">Never</span>
  return <span title={absoluteTime(at)}>{relativeTime(at)}</span>
}

/* --------------------------------- add role --------------------------------- */

/**
 * Role → ontology → lens, as far as the role needs. Ontology Administrators
 * grant Reader, Proposer or Writer on lenses of the ontologies they
 * administer only.
 */
function AddRoleForm({ user }: { user: User }) {
  const queryClient = useQueryClient()
  const access = useAccess()
  const roles = grantableRoles(access)
  const [role, setRole] = useState<Role | ''>('')
  const [ontologyKey, setOntologyKey] = useState('')
  const [lensKey, setLensKey] = useState('')
  const scope = role === '' ? null : roleScope(role)
  const { data: ontologies } = useOntologies()
  const choosable = (ontologies ?? []).filter(
    (o) => access.isPlatformAdmin || access.canDesign(o.key),
  )
  const { data: lenses } = useLenses(scope === 'lens' && ontologyKey !== '' ? ontologyKey : undefined)

  const ready =
    scope === 'platform' ||
    (scope === 'ontology' && ontologyKey !== '') ||
    (scope === 'lens' && ontologyKey !== '' && lensKey !== '')

  const add = useMutation({
    mutationFn: () =>
      users.addAssignment(user.id, {
        role: role as Role,
        ...(scope === 'platform' ? {} : { ontologyKey }),
        ...(scope === 'lens' ? { lensKey } : {}),
      }),
    onSuccess: () => {
      invalidateAccess(queryClient)
      toast.success(`${ROLE_LABELS[role as Role]} added`)
      setRole('')
      setOntologyKey('')
      setLensKey('')
    },
    onError: toastError,
  })

  if (roles.length === 0) return null

  return (
    <form
      className="grid gap-2 border-t pt-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready && !add.isPending) add.mutate()
      }}
    >
      <Label className="text-[12px]">Add role</Label>
      <Select
        value={role}
        onValueChange={(value) => {
          setRole(value as Role)
          setLensKey('')
        }}
      >
        <SelectTrigger size="sm" className="w-full text-[13px]" aria-label="Role">
          <SelectValue placeholder="Role" />
        </SelectTrigger>
        <SelectContent>
          {roles.map((r) => (
            <SelectItem key={r} value={r}>
              {ROLE_LABELS[r]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {scope !== null && scope !== 'platform' && (
        <Select
          value={ontologyKey}
          onValueChange={(value) => {
            setOntologyKey(value)
            setLensKey('')
          }}
        >
          <SelectTrigger size="sm" className="w-full text-[13px]" aria-label="Ontology">
            <SelectValue placeholder="Ontology" />
          </SelectTrigger>
          <SelectContent>
            {choosable.map((o) => (
              <SelectItem key={o.ontologyId} value={o.key}>
                {o.displayName ?? o.key}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {scope === 'lens' && ontologyKey !== '' && (
        <Select value={lensKey} onValueChange={setLensKey}>
          <SelectTrigger size="sm" className="w-full text-[13px]" aria-label="Lens">
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
      )}
      <Button type="submit" size="sm" disabled={!ready || add.isPending} className="justify-self-start">
        <Plus className="size-3.5" /> Add
      </Button>
    </form>
  )
}

/* ------------------------------- admit service ------------------------------ */

/**
 * A service principal signs in with its own token, never in the browser, so it
 * is added by hand: a name and the identity provider's subject of its account.
 */
function AdmitServiceForm({ onAdmitted }: { onAdmitted: (user: User) => void }) {
  const queryClient = useQueryClient()
  const id = useId()
  const [displayName, setDisplayName] = useState('')
  const [subject, setSubject] = useState('')
  const ready = displayName.trim() !== '' && subject.trim() !== ''

  const admit = useMutation({
    mutationFn: () =>
      users.createServiceUser({ displayName: displayName.trim(), subject: subject.trim() }),
    onSuccess: (user) => {
      invalidateAccess(queryClient)
      toast.success(`${user.displayName} admitted`)
      setDisplayName('')
      setSubject('')
      onAdmitted(user)
    },
    onError: toastError,
  })

  return (
    <form
      className="grid gap-2 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready && !admit.isPending) admit.mutate()
      }}
    >
      <h2 className="text-sm font-semibold">Admit service</h2>
      <Label htmlFor={`${id}-name`} className="text-[12px]">
        Display name
      </Label>
      <Input
        id={`${id}-name`}
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        className="h-8 text-[13px]"
      />
      <Label htmlFor={`${id}-subject`} className="text-[12px]">
        Subject at the identity provider
      </Label>
      <Input
        id={`${id}-subject`}
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        className="h-8 font-mono text-[12.5px]"
      />
      <Button
        type="submit"
        size="sm"
        disabled={!ready || admit.isPending}
        className="justify-self-start"
      >
        <Plus className="size-3.5" /> Admit
      </Button>
    </form>
  )
}

/* ---------------------------------- detail ---------------------------------- */

/** One user: who it is, its assignments (an Ontology Administrator sees those within its ontologies). */
function UserDetail({ userId }: { userId: string }) {
  const queryClient = useQueryClient()
  const access = useAccess()
  const detail = useQuery({ queryKey: qk.user(userId), queryFn: () => users.getUser(userId) })

  const setStatus = useMutation({
    mutationFn: (status: User['status']) => users.setUserStatus(userId, status),
    onSuccess: (user) => {
      invalidateAccess(queryClient)
      toast.success(user.status === 'active' ? 'User enabled' : 'User disabled')
    },
    onError: toastError,
  })

  if (detail.isPending) {
    return (
      <div className="space-y-2 rounded-xl border bg-card p-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }
  if (detail.isError) {
    return (
      <p className="rounded-xl border bg-card p-4 text-[13px] text-destructive">
        {detail.error.message}
      </p>
    )
  }

  const user = detail.data
  const handle = userHandle(user)
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{user.displayName}</h2>
          {handle !== null && (
            <p className="truncate text-[12px] text-muted-foreground">{handle}</p>
          )}
        </div>
        <StatusBadge status={user.status} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
        <dt className="text-muted-foreground">Kind</dt>
        <dd>{user.kind === 'service' ? 'Service' : 'User'}</dd>
        {user.username !== null && user.email !== null && (
          <>
            <dt className="text-muted-foreground">Username</dt>
            <dd className="truncate">{user.username}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Last sign-in</dt>
        <dd>
          <LastSignIn at={user.lastLoginAt} />
        </dd>
        <dt className="text-muted-foreground">Added</dt>
        <dd title={absoluteTime(user.createdAt)}>{relativeTime(user.createdAt)}</dd>
      </dl>
      {access.isPlatformAdmin && (
        <Button
          size="sm"
          variant="outline"
          disabled={setStatus.isPending}
          className={cn(user.status === 'active' && 'text-destructive hover:text-destructive')}
          onClick={() => setStatus.mutate(user.status === 'active' ? 'disabled' : 'active')}
        >
          {user.status === 'active' ? 'Disable' : 'Enable'}
        </Button>
      )}

      <div className="border-t pt-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Roles
        </p>
        {user.assignments.length === 0 ? (
          <p className="mt-1.5 text-[13px] text-muted-foreground">No roles.</p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {user.assignments.map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                <RoleBadge role={a.role} />
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted-foreground">
                  {assignmentTarget(a)}
                </span>
                {canRemoveAssignment(access, a) && (
                  <RemoveAssignmentButton
                    userId={user.id}
                    assignmentId={a.id}
                    label={`${ROLE_LABELS[a.role]} ${assignmentTarget(a)}`.trim()}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <AddRoleForm key={user.id} user={user} />
    </section>
  )
}

/* ----------------------------------- page ----------------------------------- */

/**
 * `/admin/users` — find users, see and change their roles. Platform
 * Administrators manage every role and a user's status, and admit services; Ontology
 * Administrators grant the lens roles on lenses of their ontologies.
 */
export function UsersPage() {
  const access = useAccess()
  const [searchParams, setSearchParams] = useSearchParams()
  const selected = searchParams.get('user')
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search.trim(), 250)
  useDocumentTitle('Users')

  const list = useQuery({
    queryKey: qk.userList(debounced, PAGE_SIZE),
    queryFn: () =>
      users.listUsers({ ...(debounced === '' ? {} : { search: debounced }), limit: PAGE_SIZE }),
    enabled: access.canManageUsers,
    placeholderData: keepPreviousData,
  })

  if (!access.canManageUsers) {
    return (
      <NoAccess
        title="No access to users"
        description="Managing users needs the Platform Administrator or an Ontology Administrator role."
      />
    )
  }

  const select = (userId: string) => {
    const next = new URLSearchParams(searchParams)
    next.set('user', userId)
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Ontologies
        </Link>
        <div className="mt-3 flex items-center gap-3">
          <Logo className="size-9 shrink-0 rounded-xl" />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">Users</h1>
            <p className="text-[13px] text-muted-foreground">
              {access.isPlatformAdmin
                ? 'Everyone who signed in or was added, with their roles.'
                : 'Give users Reader, Proposer or Writer roles on lenses of the ontologies you administer.'}
            </p>
          </div>
          <div className="ml-auto shrink-0">
            <UserMenu side="bottom" />
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-3">
            <div className="relative max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, email or username…"
                aria-label="Search users"
                className="h-8 pl-8 text-[13px]"
              />
            </div>
            {list.isPending ? (
              <div className="space-y-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : list.isError ? (
              <p className="text-[13px] text-destructive">{list.error.message}</p>
            ) : list.data.items.length === 0 ? (
              <EmptyState
                icon={debounced === '' ? Users : UserX}
                title={debounced === '' ? 'No users yet' : 'No users found'}
                description={
                  debounced === ''
                    ? 'Users appear here after their first sign-in.'
                    : `No user matches “${debounced}”.`
                }
              />
            ) : (
              <>
                <div className="rounded-xl border">
                  {/* Fixed columns: long names and emails truncate rather than widen the
                      table; kind and last sign-in, also in the detail, leave on a phone. */}
                  <Table className="table-fixed">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="truncate">Name</TableHead>
                        <TableHead className="truncate">Email or username</TableHead>
                        <TableHead className="hidden w-20 sm:table-cell">Kind</TableHead>
                        <TableHead className="w-24">Status</TableHead>
                        <TableHead className="hidden w-28 sm:table-cell">Last sign-in</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {list.data.items.map((user) => (
                        <TableRow
                          key={user.id}
                          className="cursor-pointer"
                          data-state={user.id === selected ? 'selected' : undefined}
                          onClick={() => select(user.id)}
                        >
                          <TableCell className="truncate text-[13px] font-medium">
                            <button
                              type="button"
                              title={user.displayName}
                              className="max-w-full truncate text-left hover:underline focus-visible:outline-2 focus-visible:outline-ring/60"
                              onClick={(e) => {
                                e.stopPropagation()
                                select(user.id)
                              }}
                            >
                              {user.displayName}
                            </button>
                          </TableCell>
                          <TableCell
                            className="truncate text-[13px] text-muted-foreground"
                            title={userHandle(user) ?? undefined}
                          >
                            {userHandle(user) ?? '—'}
                          </TableCell>
                          <TableCell className="hidden text-[13px] sm:table-cell">
                            {user.kind === 'service' ? 'Service' : 'User'}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={user.status} />
                          </TableCell>
                          <TableCell className="hidden text-[12.5px] sm:table-cell">
                            <LastSignIn at={user.lastLoginAt} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {list.data.total > list.data.items.length && (
                  <p className="text-[12px] text-muted-foreground">
                    Showing {list.data.items.length} of {list.data.total} — narrow the search to
                    find others.
                  </p>
                )}
              </>
            )}
          </div>

          <aside className="space-y-3 lg:sticky lg:top-6">
            {selected === null ? (
              <p className="rounded-xl border border-dashed p-4 text-center text-[13px] text-muted-foreground">
                Choose a user to see and change its roles.
              </p>
            ) : (
              <UserDetail userId={selected} />
            )}
            {access.isPlatformAdmin && <AdmitServiceForm onAdmitted={(user) => select(user.id)} />}
          </aside>
        </div>
      </div>
    </div>
  )
}
