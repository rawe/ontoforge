# Visual Data Editor

The Visual Data Editor provides a graph-based interface for exploring and managing runtime entity instances and their relations. It complements the existing list-based data management pages with an interactive canvas view powered by React Flow.

## Access

- **Route**: `/data/:ontologyKey/graph`
- **Sidebar**: Under each ontology's "Data" section as "Visual Editor"
- **Dashboard**: "Visual Editor" button on the runtime dashboard page

## Architecture

### Working Set

The editor operates on a **client-managed working set** — a collection of entity instance GUIDs that determines what is displayed on the graph canvas. This is the central concept of the editor.

The working set is stored as a `Map<string, EntityInstance>` keyed by entity GUID. Relations are derived: the editor fetches all relations of each schema-defined relation type and includes only those where both endpoints exist in the working set. This is stored in a parallel `Map<string, RelationInstance>`.

**Why client-managed?** Runtime datasets can be very large. Rather than loading everything, the user builds up a focused view by selectively adding entities of interest. The working set cap is 200 entities to keep the graph readable and the UI responsive.

### Adding Entities

Entities enter the working set through several paths:

- **Browse**: Select an entity type, page through instances, select and add
- **Text search**: Filter by entity type and search query (server-side `q` parameter)
- **Semantic search**: Natural language search if the backend has the `semanticSearch` feature enabled
- **Create**: Create a new entity via form — it is automatically added to the working set
- **Add Neighbors**: From a selected entity, fetch all related entities and add them to the working set

### Removing Entities

- **Delete**: Permanently delete from server and remove from working set
- **Auto-refresh**: When enabled (5-second interval), entities deleted externally are automatically detected and removed

### Refresh Mechanism

When auto-refresh is enabled, the editor periodically re-fetches each entity in the working set by GUID:

- If the fetch succeeds and `_updatedAt` has changed, the local copy is updated
- If the fetch returns 404, the entity is removed from the working set
- After entity updates, relations are re-fetched to reflect any changes

## Components

### Page: `DataGraphPage`

Orchestrates all state and sub-components. Owns the working set maps, filter state, selection state, and modal state for create operations. Located at `src/pages/DataGraphPage.tsx`.

### Graph: `DataGraph`

Wraps React Flow with custom node and edge types. Receives the working set entities, relations, filters, and selection state as props. Applies visibility filters and property filters before rendering. Located at `src/components/data-graph/DataGraph.tsx`.

### Node: `EntityInstanceNode`

Custom React Flow node for entity instances. Displays:
- Entity type badge with color coding (8-color palette cycling by type index)
- Display label (first non-system string property value, falling back to truncated GUID)
- Truncated GUID

### Edge: `RelationInstanceEdge`

Custom React Flow edge for relation instances. Shows the relation type display name as an inline label on the bezier curve.

### Layout: `dataGraphLayout`

Uses dagre for automatic hierarchical layout (left-to-right). Node dimensions are 220×60px with 60px horizontal and 100px vertical spacing.

### Filters: `DataGraphFilters`

Three levels of filtering, all client-side against the working set:

1. **Entity type visibility**: Toggle pills to show/hide entity types on the graph
2. **Relation type visibility**: Toggle pills to show/hide relation types
3. **Property filters**: Expandable section with text inputs for each property of visible entity types. Matches are case-insensitive substring matches. Filter count badge shown when active.

Filtering hides nodes/edges from display without removing them from the working set.

### Detail Panel: `DataGraphDetailPanel`

Right sidebar shown when a node or edge is selected. For entities: shows type badge, GUID, all property values, and action buttons (Edit, Add Neighbors, Delete). For relations: shows type badge, from/to labels, properties, and Delete button. Entity editing opens a modal with `DynamicForm`.

### Add Entity Panel: `AddEntityPanel`

Slide-out right panel for populating the working set. Features:
- Entity type dropdown selector
- Browse/Semantic search mode toggle
- Search input with 300ms debounce
- Paginated results (20 per page) with checkbox selection
- "In graph" indicator for entities already in the working set
- Semantic search shows similarity scores
- Bulk add via "Select All" and "Add Selected" buttons

## Schema Enforcement

All create operations respect the ontology schema:

- **Create Entity**: Type picker shows only schema-defined entity types. Property form is generated from the type's property definitions via `DynamicForm`.
- **Create Relation**: Type picker shows only relation types where both endpoint entity types have instances in the working set. `EntityPicker` components restrict source/target selection to the correct entity types. Property form generated from relation type definitions.

## Reused Components

The visual editor reuses several existing components:
- `DynamicForm` — schema-driven property input forms
- `EntityPicker` — autocomplete entity selection
- `Modal` — dialog wrapper
- `ConfirmDialog` — delete confirmation
- `useRuntimeSchema` hook — schema fetching
- `useFeatures` hook — feature detection for semantic search
- Runtime API client — all entity/relation CRUD operations
