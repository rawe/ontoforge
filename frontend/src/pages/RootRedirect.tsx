import { Navigate } from 'react-router-dom'
import { useOntologies } from '@/api/hooks'
import { Logo } from '@/components/Logo'
import { readString, remove, storageKeys } from '@/lib/storage'

/**
 * `/` — routes to the last-used ontology's workbench if it still exists,
 * otherwise to the welcome picker.
 */
export function RootRedirect() {
  const { data: ontologies, isPending, isError } = useOntologies()

  if (isPending) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Logo className="size-10 animate-pulse rounded-xl" />
      </div>
    )
  }

  const last = readString(storageKeys.lastOntology)
  if (!isError && last !== null && ontologies.some((o) => o.key === last)) {
    return <Navigate to={`/w/${last}`} replace />
  }
  if (last !== null) remove(storageKeys.lastOntology)
  return <Navigate to="/welcome" replace />
}
