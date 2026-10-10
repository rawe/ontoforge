# OntoForge UI

The OntoForge frontend — a single-page app. The start page (`/`) lists the server's ontologies; each ontology has two surfaces:

- **Workbench** (`/o/:ontologyKey/w/:lensKey`) — work with instance data through one lens: overview dashboard, schema-driven type tables, entity detail, Explorer canvas, OQL query workbench, Assistants (agent chat, retriever chat).
- **Studio** (`/o/:ontologyKey/studio`) — design one ontology: entity/relation type editors, lenses (scope, agents, retriever agents with a test panel, saved queries, connect), search indices and search settings, export/import.

What the surfaces offer: [../docs/product-surface.md](../docs/product-surface.md).
System architecture: [../docs/architecture.md](../docs/architecture.md).

## Stack

React 19 + TypeScript (strict) + Vite 7, Tailwind CSS v4, shadcn/ui (Radix), TanStack Query 5, TanStack Table 8, react-router-dom 7, @xyflow/react + dagre (Explorer canvas), cmdk (command palette), sonner (toasts), lucide-react (icons).

## Development

```bash
npm install
npm run dev        # dev server on http://localhost:5173
npm run build      # tsc -b && vite build
npm run lint       # eslint
npm run typecheck  # tsc -b --noEmit
```

The dev server proxies `/api` and `/mcp` to the backend at `http://localhost:8000` (see `vite.config.ts`) — start the backend first, or use `../dev.sh` to start the full stack.

## Docker

The production image (nginx serving the built app, `BACKEND_URL` injected via envsubst into `default.conf.template`) is built from this directory. From the repo root:

```bash
make release-ui VERSION=x.y.z
```

## Source Layout

```
src/
├── api/         # fetch wrapper (http.ts), modeling/runtime clients, wire types, query keys + hooks
├── components/
│   ├── layout/  # app shells: WorkbenchLayout, StudioLayout, Sidebar
│   ├── ui/      # shadcn/ui primitives
│   ├── schema/  # schema-driven inputs (PropertyField)
│   ├── quickadd/# EntityForm + Quick Add dialog
│   ├── palette/ # Cmd+K search palette
│   ├── explore/ # Explorer canvas (React Flow nodes, edges, working set)
│   ├── table/   # type table building blocks
│   ├── entity/  # entity detail building blocks
│   ├── query/   # query console (OQL) + saved-query library
│   ├── ai/      # Assistants page tabs: agent chat, retriever chat
│   ├── retrieverAgent/ # retriever-agent editor parts, chat + diagnostics (Studio test panel and Workbench)
│   ├── search/  # Studio Search area: index list parts, index designer, managed index view
│   ├── studio/  # Studio editors (types, scope, agents, retriever agents, saved queries, transfer)
│   └── home/    # Workbench Home cards
├── lib/         # displayLabel, matchedVia, typeColors, storage (of.* localStorage keys), recents
├── pages/       # route components (StartPage, workbench/, studio/)
└── router.tsx   # route table
```
