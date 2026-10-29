import { QueryClient } from '@tanstack/react-query'
import { ApiError, onUnauthenticated } from './http'
import { qk } from './queryKeys'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Client errors (4xx) will not resolve on retry.
        if (error instanceof ApiError && error.status < 500) return false
        return failureCount < 2
      },
    },
  },
})

// An ended session refetches the auth state, which brings up the sign-in screen.
onUnauthenticated(() => void queryClient.invalidateQueries({ queryKey: qk.auth.me }))
