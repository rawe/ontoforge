import type { ReactNode } from 'react'
import { LogIn, LogOut, RotateCw } from 'lucide-react'
import { loginUrl } from '@/api/auth'
import { useAuthMe } from '@/api/hooks'
import { ApiError } from '@/api/http'
import type { User } from '@/api/types'
import { useSignOut } from '@/components/auth/useSignOut'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'

const LOGIN_MESSAGES: Record<string, string> = {
  disabled: 'This account is disabled.',
  failed: 'Sign-in failed. Please try again.',
}

/** Centered product mark above one short message and its action. */
function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <Logo className="size-11 rounded-xl" />
        <h1 className="text-xl font-semibold tracking-tight">OntoForge</h1>
        {children}
      </div>
    </div>
  )
}

/** Sign-in is a full-page navigation; the server brings the browser back to this address. */
function SignInScreen() {
  const params = new URLSearchParams(window.location.search)
  const message = LOGIN_MESSAGES[params.get('login') ?? '']
  // The outcome of the last attempt is not part of where to return.
  params.delete('login')
  const search = params.toString()
  const returnTo = window.location.pathname + (search === '' ? '' : `?${search}`)

  return (
    <AuthScreen>
      {message !== undefined && (
        <p className="w-full rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
          {message}
        </p>
      )}
      <Button
        onClick={() => {
          window.location.href = loginUrl(returnTo)
        }}
      >
        <LogIn className="size-4" /> Sign in
      </Button>
    </AuthScreen>
  )
}

function NoAccessScreen({ user }: { user: User }) {
  const signOut = useSignOut()
  return (
    <AuthScreen>
      <div className="space-y-1">
        <h2 className="text-sm font-medium">No access assigned</h2>
        <p className="text-[13px] text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{user.displayName}</span>.
          An administrator has not given this account a role yet.
        </p>
      </div>
      <Button variant="outline" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
        <LogOut className="size-4" /> Sign out
      </Button>
    </AuthScreen>
  )
}

/** The auth state could not be read: nothing is shown as allowed until it can. */
function UnavailableScreen({
  error,
  retrying,
  onRetry,
}: {
  error: Error | null
  retrying: boolean
  onRetry: () => void
}) {
  return (
    <AuthScreen>
      <div className="space-y-1">
        <h2 className="text-sm font-medium">OntoForge cannot check your sign-in right now</h2>
        {error instanceof ApiError && (
          <p className="text-[13px] text-muted-foreground">{error.message}</p>
        )}
      </div>
      <Button variant="outline" disabled={retrying} onClick={onRetry}>
        <RotateCw className="size-4" /> Retry
      </Button>
    </AuthScreen>
  )
}

/**
 * Decides what the app shows from `GET /api/auth/me`: nothing while loading;
 * an error screen with Retry when it cannot be read; with authentication off
 * the app as it is; signed out the sign-in screen; signed in without any role
 * a "No access assigned" screen; else the app.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const me = useAuthMe()
  if (me.isPending) return null
  // A failed refetch keeps the last answer; only a first read that failed has none.
  if (me.data === undefined) {
    return (
      <UnavailableScreen
        error={me.error}
        retrying={me.isFetching}
        onRetry={() => void me.refetch()}
      />
    )
  }
  if (!me.data.authentication) return children
  if (me.data.user === null) return <SignInScreen />
  if (me.data.assignments.length === 0) return <NoAccessScreen user={me.data.user} />
  return children
}
