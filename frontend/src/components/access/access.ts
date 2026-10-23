import type { QueryClient } from '@tanstack/react-query'
import { qk } from '@/api/queryKeys'
import type { User } from '@/api/types'

/** After any change of a user or an assignment: the lists, the detail, and one's own roles. */
export function invalidateAccess(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: qk.users })
  void queryClient.invalidateQueries({ queryKey: ['access'] })
  void queryClient.invalidateQueries({ queryKey: qk.auth.me })
}

/** Email, else username: how a user is told apart besides its name. */
export function userHandle(user: User): string | null {
  return user.email ?? user.username
}
