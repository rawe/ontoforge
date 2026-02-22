import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import Layout from './components/Layout';
import OntologyListPage from './pages/OntologyListPage';
import OntologyDetailPage from './pages/OntologyDetailPage';
import EntityTypeEditorPage from './pages/EntityTypeEditorPage';
import RelationTypeEditorPage from './pages/RelationTypeEditorPage';
import { RuntimeSchemaProvider } from './context/RuntimeSchemaContext';
import RuntimeDashboardPage from './pages/RuntimeDashboardPage';
import EntityInstanceListPage from './pages/EntityInstanceListPage';
import RelationInstanceListPage from './pages/RelationInstanceListPage';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/ontologies" replace />} />
          <Route path="/ontologies" element={<OntologyListPage />} />
          <Route path="/ontologies/:ontologyId" element={<OntologyDetailPage />} />
          <Route path="/ontologies/:ontologyId/entity-types/:entityTypeId" element={<EntityTypeEditorPage />} />
          <Route path="/ontologies/:ontologyId/relation-types/:relationTypeId" element={<RelationTypeEditorPage />} />
          <Route path="/data/:ontologyKey" element={<RuntimeSchemaProvider><RuntimeDashboardPage /></RuntimeSchemaProvider>} />
          <Route path="/data/:ontologyKey/entities/:entityTypeKey" element={<RuntimeSchemaProvider><EntityInstanceListPage /></RuntimeSchemaProvider>} />
          <Route path="/data/:ontologyKey/relations/:relationTypeKey" element={<RuntimeSchemaProvider><RelationInstanceListPage /></RuntimeSchemaProvider>} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
