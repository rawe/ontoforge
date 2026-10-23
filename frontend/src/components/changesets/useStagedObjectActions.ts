import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { qk } from '@/api/queryKeys'
import * as runtime from '@/api/runtime'

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)

/**
 * The changes a draft takes on its staged objects: remove one, cut one of
 * its values, accept the current stored value as a value's before. Each
 * refreshes the changeset's reads.
 */
export function useStagedObjectActions(ontologyKey: string, lensKey: string, changesetId: string) {
  const queryClient = useQueryClient()
  const onSettled = () => queryClient.invalidateQueries({ queryKey: qk.changesets(ontologyKey, lensKey) })
  const remove = useMutation({
    mutationFn: (objectId: string) => runtime.unstageObject(ontologyKey, lensKey, changesetId, objectId),
    onSuccess: () => toast.success('Removed from the changeset'),
    onError: (err) => toast.error(errorText(err, 'Failed to remove')),
    onSettled,
  })
  const cut = useMutation({
    mutationFn: ({ objectId, property }: { objectId: string; property: string }) =>
      runtime.cutValue(ontologyKey, lensKey, changesetId, objectId, property),
    onSuccess: (_, { property }) => toast.success(`Cut ${property} from the changeset`),
    onError: (err) => toast.error(errorText(err, 'Failed to cut')),
    onSettled,
  })
  const acceptCurrent = useMutation({
    mutationFn: ({ objectId, property }: { objectId: string; property: string }) =>
      runtime.rebaseObject(ontologyKey, lensKey, changesetId, objectId, [property]),
    onSuccess: (_, { property }) => toast.success(`Accepted the current ${property}`),
    onError: (err) => toast.error(errorText(err, 'Failed to accept the current value')),
    onSettled,
  })
  return { remove, cut, acceptCurrent, busy: remove.isPending || cut.isPending || acceptCurrent.isPending }
}
