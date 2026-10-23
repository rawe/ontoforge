/**
 * Authentication API client — `/api/auth`: the mode and the signed-in user,
 * the browser sign-in (a full-page navigation) and sign-out.
 */

import { request } from './http'
import type { AuthMe } from './types'

/** Always answers, never 401: `authentication: false` when sign-in is off. */
export const getMe = () => request<AuthMe>('/api/auth/me')

/** Ends the session; the client then goes to the returned identity-provider address. */
export const logout = () =>
  request<{ logoutUrl: string }>('/api/auth/logout', { method: 'POST' })

/** Where "Sign in" leads: the server's login, coming back to `returnTo` (path + search). */
export const loginUrl = (returnTo: string) =>
  `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`
