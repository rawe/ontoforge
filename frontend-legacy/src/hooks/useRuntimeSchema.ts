import { useQuery } from '@tanstack/react-query';
import { getSchema } from '../api/runtimeClient';

export function useRuntimeSchema(ontologyKey: string | undefined) {
  return useQuery({
    queryKey: ['schema', ontologyKey],
    queryFn: () => getSchema(ontologyKey!),
    enabled: !!ontologyKey,
  });
}
