import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import Layout from './components/Layout';
import SchemaPage from './pages/SchemaPage';
import OntologyListPage from './pages/OntologyListPage';
import OntologyDetailPage from './pages/OntologyDetailPage';
import EntityTypeEditorPage from './pages/EntityTypeEditorPage';
import RelationTypeEditorPage from './pages/RelationTypeEditorPage';
import RuntimeDashboardPage from './pages/RuntimeDashboardPage';
import EntityInstanceListPage from './pages/EntityInstanceListPage';
import RelationInstanceListPage from './pages/RelationInstanceListPage';
import DataGraphPage from './pages/DataGraphPage';
import AiQueryPage from './pages/AiQueryPage';
import AiExtractPage from './pages/AiExtractPage';
import AiChatPage from './pages/AiChatPage';
import { AiStateProvider } from './hooks/useAiState';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AiStateProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/schema" replace />} />
            <Route path="/schema" element={<SchemaPage />} />
            <Route path="/schema/entity-types/:entityTypeId" element={<EntityTypeEditorPage />} />
            <Route path="/schema/relation-types/:relationTypeId" element={<RelationTypeEditorPage />} />
            <Route path="/ontologies" element={<OntologyListPage />} />
            <Route path="/ontologies/:ontologyId" element={<OntologyDetailPage />} />
            <Route path="/data/:ontologyKey" element={<RuntimeDashboardPage />} />
            <Route path="/data/:ontologyKey/entities/:entityTypeKey" element={<EntityInstanceListPage />} />
            <Route path="/data/:ontologyKey/relations/:relationTypeKey" element={<RelationInstanceListPage />} />
            <Route path="/data/:ontologyKey/graph" element={<DataGraphPage />} />
            <Route path="/data/:ontologyKey/ai/query" element={<AiQueryPage />} />
            <Route path="/data/:ontologyKey/ai/extract" element={<AiExtractPage />} />
            <Route path="/data/:ontologyKey/ai/chat" element={<AiChatPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </AiStateProvider>
    </QueryClientProvider>
  </StrictMode>,
);
