import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import type { RuntimeSchema } from '../types/runtime';
import * as runtimeApi from '../api/runtimeClient';

interface RuntimeSchemaContextValue {
  schema: RuntimeSchema | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const RuntimeSchemaContext = createContext<RuntimeSchemaContextValue | null>(null);

export function RuntimeSchemaProvider({ children }: { children: ReactNode }) {
  const { ontologyKey } = useParams<{ ontologyKey: string }>();
  const [schema, setSchema] = useState<RuntimeSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSchema = useCallback(async () => {
    if (!ontologyKey) return;
    setLoading(true);
    setError(null);
    try {
      setSchema(await runtimeApi.getSchema(ontologyKey));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load schema');
    } finally {
      setLoading(false);
    }
  }, [ontologyKey]);

  useEffect(() => { fetchSchema(); }, [fetchSchema]);

  return (
    <RuntimeSchemaContext.Provider value={{ schema, loading, error, refetch: fetchSchema }}>
      {children}
    </RuntimeSchemaContext.Provider>
  );
}

export function useRuntimeSchema(): RuntimeSchemaContextValue {
  const ctx = useContext(RuntimeSchemaContext);
  if (!ctx) throw new Error('useRuntimeSchema must be used within RuntimeSchemaProvider');
  return ctx;
}
