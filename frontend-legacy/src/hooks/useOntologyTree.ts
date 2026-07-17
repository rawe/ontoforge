import { useQuery, useQueries } from '@tanstack/react-query';
import { listOntologies } from '../api/client';
import { getSchema } from '../api/runtimeClient';
import type { Ontology } from '../types/models';
import type { RuntimeSchema } from '../types/runtime';

export interface OntologyTreeNode {
  ontology: Ontology;
  schema: RuntimeSchema | null;
  schemaLoading: boolean;
}

export function useOntologyTree() {
  const {
    data: ontologies,
    isLoading: ontologiesLoading,
  } = useQuery({
    queryKey: ['ontologies'],
    queryFn: listOntologies,
  });

  const schemaQueries = useQueries({
    queries: (ontologies ?? []).map((o) => ({
      queryKey: ['schema', o.key],
      queryFn: () => getSchema(o.key),
      enabled: !!ontologies,
    })),
  });

  const tree: OntologyTreeNode[] = (ontologies ?? []).map((o, i) => ({
    ontology: o,
    schema: schemaQueries[i]?.data ?? null,
    schemaLoading: schemaQueries[i]?.isLoading ?? true,
  }));

  return {
    ontologies: tree,
    isLoading: ontologiesLoading,
  };
}
