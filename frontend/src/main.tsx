import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import Layout from './components/Layout';
import OntologyListPage from './pages/OntologyListPage';
import OntologyDetailPage from './pages/OntologyDetailPage';
import EntityTypeEditorPage from './pages/EntityTypeEditorPage';
import RelationTypeEditorPage from './pages/RelationTypeEditorPage';
import RuntimeDashboardPage from './pages/RuntimeDashboardPage';
import EntityInstanceListPage from './pages/EntityInstanceListPage';
import RelationInstanceListPage from './pages/RelationInstanceListPage';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/ontologies" replace />} />
            <Route path="/ontologies" element={<OntologyListPage />} />
            <Route path="/ontologies/:ontologyId" element={<OntologyDetailPage />} />
            <Route path="/ontologies/:ontologyId/entity-types/:entityTypeId" element={<EntityTypeEditorPage />} />
            <Route path="/ontologies/:ontologyId/relation-types/:relationTypeId" element={<RelationTypeEditorPage />} />
            <Route path="/data/:ontologyKey" element={<RuntimeDashboardPage />} />
            <Route path="/data/:ontologyKey/entities/:entityTypeKey" element={<EntityInstanceListPage />} />
            <Route path="/data/:ontologyKey/relations/:relationTypeKey" element={<RelationInstanceListPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
