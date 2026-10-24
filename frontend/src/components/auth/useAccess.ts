import { useMemo } from 'react'
import { useAuthMe } from '@/api/hooks'
import { accessFrom, type Access } from '@/lib/access'

/** What the signed-in user may do; everything when authentication is off, nothing while unknown. */
export function useAccess(): Access {
  const { data } = useAuthMe()
  return useMemo(() => accessFrom(data), [data])
}
