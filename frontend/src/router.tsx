import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { StudioLayout } from '@/components/layout/StudioLayout'
import { WorkbenchLayout } from '@/components/layout/WorkbenchLayout'
import { RouteFallback } from '@/components/RouteFallback'
import { RootRedirect } from '@/pages/RootRedirect'
import { WelcomePage } from '@/pages/WelcomePage'
import { EntityDetailPage } from '@/pages/workbench/EntityDetailPage'
import { HomePage } from '@/pages/workbench/HomePage'
import { TypeTablePage } from '@/pages/workbench/TypeTablePage'

// Heavy routes are code-split: React Flow, CodeMirror, and react-markdown load
// only when their route is visited. Home / tables / entity detail stay eager.
const ExplorePage = lazy(() =>
  import('@/pages/workbench/ExplorePage').then((m) => ({ default: m.ExplorePage })),
)
const QueryPage = lazy(() =>
  import('@/pages/workbench/QueryPage').then((m) => ({ default: m.QueryPage })),
)
const AiPage = lazy(() =>
  import('@/pages/workbench/AiPage').then((m) => ({ default: m.AiPage })),
)
const StudioHomePage = lazy(() =>
  import('@/pages/studio/StudioHomePage').then((m) => ({ default: m.StudioHomePage })),
)
const EntityTypePage = lazy(() =>
  import('@/pages/studio/EntityTypePage').then((m) => ({ default: m.EntityTypePage })),
)
const RelationTypePage = lazy(() =>
  import('@/pages/studio/RelationTypePage').then((m) => ({ default: m.RelationTypePage })),
)
const OntologiesPage = lazy(() =>
  import('@/pages/studio/OntologiesPage').then((m) => ({ default: m.OntologiesPage })),
)
const OntologyDetailPage = lazy(() =>
  import('@/pages/studio/OntologyDetailPage').then((m) => ({
    default: m.OntologyDetailPage,
  })),
)
const TransferPage = lazy(() =>
  import('@/pages/studio/TransferPage').then((m) => ({ default: m.TransferPage })),
)

const suspended = (node: ReactNode) => (
  <Suspense fallback={<RouteFallback />}>{node}</Suspense>
)

export const router = createBrowserRouter([
  { path: '/', element: <RootRedirect /> },
  { path: '/welcome', element: <WelcomePage /> },
  {
    path: '/w/:ontologyKey',
    element: <WorkbenchLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 't/:typeKey', element: <TypeTablePage /> },
      { path: 'e/:typeKey/:id', element: <EntityDetailPage /> },
      { path: 'explore', element: suspended(<ExplorePage />) },
      { path: 'query', element: suspended(<QueryPage />) },
      { path: 'ai', element: suspended(<AiPage />) },
    ],
  },
  {
    path: '/studio',
    element: <StudioLayout />,
    children: [
      { index: true, element: suspended(<StudioHomePage />) },
      { path: 'entity-types/:id', element: suspended(<EntityTypePage />) },
      { path: 'relation-types/:id', element: suspended(<RelationTypePage />) },
      { path: 'ontologies', element: suspended(<OntologiesPage />) },
      { path: 'ontologies/:id', element: suspended(<OntologyDetailPage />) },
      { path: 'transfer', element: suspended(<TransferPage />) },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
