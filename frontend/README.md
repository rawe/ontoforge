# OntoForge UI

The OntoForge frontend (v3) — a single-page app with two surfaces:

- **Workbench** (`/w/:ontologyKey`) — work with instance data through one ontology lens: overview dashboard, schema-driven type tables, entity detail, Explorer canvas, OQL query workbench, AI assistant.
- **Studio** (`/studio`) — design the global schema: entity/relation type editors, ontology scope configuration, agents, saved queries, export/import.

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
│   ├── ai/      # chat / ask / extract
│   ├── studio/  # Studio editors (types, scope, agents, saved queries, transfer)
│   └── home/    # Workbench Home cards
├── lib/         # displayLabel, typeColors, storage (of.* localStorage keys), recents
├── pages/       # route components (workbench/, studio/, welcome)
└── router.tsx   # route table
```
