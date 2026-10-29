import { useMutation } from '@tanstack/react-query'
import * as auth from '@/api/auth'
import { toastError } from '@/components/studio/lib'

/** Ends the session, then leaves for the identity provider's sign-out page. */
export function useSignOut() {
  return useMutation({
    mutationFn: auth.logout,
    onSuccess: ({ logoutUrl }) => {
      window.location.href = logoutUrl
    },
    onError: toastError,
  })
}
