import { CircleUser, LogOut, Users } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuthMe } from '@/api/hooks'
import { useAccess } from '@/components/auth/useAccess'
import { useSignOut } from '@/components/auth/useSignOut'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * The signed-in user: name, the Users page for administrators, sign out.
 * Renders nothing with authentication off.
 */
export function UserMenu({ side = 'top' }: { side?: 'top' | 'bottom' }) {
  const navigate = useNavigate()
  const { data: me } = useAuthMe()
  const access = useAccess()
  const signOut = useSignOut()
  if (me === undefined || !me.authentication || me.user === null) return null
  const user = me.user

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Signed in as ${user.displayName}`}>
          <CircleUser className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} align="start" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-[13px] font-medium">{user.displayName}</span>
          {(user.email ?? user.username) !== null && (
            <span className="block truncate text-[11px] text-muted-foreground">
              {user.email ?? user.username}
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {access.canManageUsers && (
          <DropdownMenuItem onSelect={() => navigate('/admin/users')} className="gap-2">
            <Users className="size-4" /> Users
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          disabled={signOut.isPending}
          onSelect={() => signOut.mutate()}
          className="gap-2"
        >
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
