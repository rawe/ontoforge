import { createContext, useContext, useCallback, useRef, useState, type ReactNode } from 'react';
import type { AiQueryResponse, AiExtractResponse, AiChatToolCall } from '../types/runtime';

// --- State shapes ---

export interface QueryState {
  question: string;
  response: AiQueryResponse | null;
  error: string | null;
}

export interface ExtractState {
  text: string;
  selectedTypes: Set<string>;
  create: boolean;
  response: AiExtractResponse | null;
  error: string | null;
}

export interface ChatEntry {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: AiChatToolCall[];
}

export interface ChatState {
  messages: ChatEntry[];
  input: string;
  showToolCalls: boolean;
  agentKey: string;
}

interface OntologyAiState {
  query: QueryState;
  extract: ExtractState;
  chat: ChatState;
}

// --- Defaults ---

const defaultQuery = (): QueryState => ({
  question: '',
  response: null,
  error: null,
});

const defaultExtract = (): ExtractState => ({
  text: '',
  selectedTypes: new Set(),
  create: false,
  response: null,
  error: null,
});

const defaultChat = (): ChatState => ({
  messages: [],
  input: '',
  showToolCalls: false,
  agentKey: '_default',
});

const defaultState = (): OntologyAiState => ({
  query: defaultQuery(),
  extract: defaultExtract(),
  chat: defaultChat(),
});

// --- Context ---

interface AiStateContextValue {
  getState: (ontologyKey: string) => OntologyAiState;
  updateQuery: (ontologyKey: string, patch: Partial<QueryState>) => void;
  updateExtract: (ontologyKey: string, patch: Partial<ExtractState>) => void;
  updateChat: (ontologyKey: string, patch: Partial<ChatState>) => void;
  resetQuery: (ontologyKey: string) => void;
  resetExtract: (ontologyKey: string) => void;
  resetChat: (ontologyKey: string) => void;
}

const AiStateContext = createContext<AiStateContextValue | null>(null);

export function AiStateProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<Map<string, OntologyAiState>>(new Map());
  // Trigger re-renders when state changes
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  const getOrCreate = useCallback((key: string): OntologyAiState => {
    let s = storeRef.current.get(key);
    if (!s) {
      s = defaultState();
      storeRef.current.set(key, s);
    }
    return s;
  }, []);

  const getState = useCallback((key: string) => getOrCreate(key), [getOrCreate]);

  const updateQuery = useCallback((key: string, patch: Partial<QueryState>) => {
    const s = getOrCreate(key);
    s.query = { ...s.query, ...patch };
    bump();
  }, [getOrCreate, bump]);

  const updateExtract = useCallback((key: string, patch: Partial<ExtractState>) => {
    const s = getOrCreate(key);
    s.extract = { ...s.extract, ...patch };
    bump();
  }, [getOrCreate, bump]);

  const updateChat = useCallback((key: string, patch: Partial<ChatState>) => {
    const s = getOrCreate(key);
    s.chat = { ...s.chat, ...patch };
    bump();
  }, [getOrCreate, bump]);

  const resetQuery = useCallback((key: string) => {
    const s = getOrCreate(key);
    s.query = defaultQuery();
    bump();
  }, [getOrCreate, bump]);

  const resetExtract = useCallback((key: string) => {
    const s = getOrCreate(key);
    s.extract = defaultExtract();
    bump();
  }, [getOrCreate, bump]);

  const resetChat = useCallback((key: string) => {
    const s = getOrCreate(key);
    s.chat = defaultChat();
    bump();
  }, [getOrCreate, bump]);

  return (
    <AiStateContext.Provider value={{ getState, updateQuery, updateExtract, updateChat, resetQuery, resetExtract, resetChat }}>
      {children}
    </AiStateContext.Provider>
  );
}

export function useAiState() {
  const ctx = useContext(AiStateContext);
  if (!ctx) throw new Error('useAiState must be used within AiStateProvider');
  return ctx;
}
