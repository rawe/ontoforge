# Runtime UI Architecture

Frontend architecture for generic, schema-driven data management in OntoForge.

## 1. Route Structure

Add to `main.tsx`, inside the existing `<Route element={<Layout />}>`:

```
/data/:ontologyKey                              → RuntimeDashboardPage
/data/:ontologyKey/entities/:entityTypeKey       → EntityInstanceListPage
/data/:ontologyKey/relations/:relationTypeKey    → RelationInstanceListPage
```

Runtime routes use `ontologyKey` (snake_case string) to match the runtime API base path `/api/runtime/{ontologyKey}/...`.

No entity detail page for now — create/edit via modals on the list page. Neighbors view deferred (YAGNI).

## 2. Page Components

### RuntimeDashboardPage

**Route:** `/data/:ontologyKey`
**Purpose:** Entry point for data management. Shows ontology info and links to each type.

- Fetches full schema via `GET /schema`
- Displays ontology name, key, description
- Lists entity types as clickable cards (displayName, key, property count)
- Lists relation types as clickable cards (displayName, from→to display)
- Each card links to the corresponding list page
- "Wipe Data" button (with confirmation) calls `DELETE /data`
- Breadcrumb: `Ontologies → {ontology name} → Data`

### EntityInstanceListPage

**Route:** `/data/:ontologyKey/entities/:entityTypeKey`
**Purpose:** CRUD for entity instances of a specific type.

- Fetches entity type schema (from cached schema context) for column/form definitions
- Fetches entity list via `GET /entities/{entityTypeKey}` with pagination, search, sort
- Renders DataTable with columns from property definitions + system columns (`_createdAt`)
- Search input (maps to `q` parameter)
- Column header click toggles sort
- Pagination controls (prev/next/page info)
- "Create" button opens DynamicForm in a modal
- Each row: Edit button (opens DynamicForm modal with initial values), Delete button (with confirm)
- Breadcrumb: `Ontologies → {ontology name} → Data → {entity type displayName}`

### RelationInstanceListPage

**Route:** `/data/:ontologyKey/relations/:relationTypeKey`
**Purpose:** CRUD for relation instances of a specific type.

- Same pattern as EntityInstanceListPage, plus:
- Columns include "From" and "To" (resolved to display labels, see Entity Display Labels below)
- Create form includes EntityPicker for `fromEntityId` and `toEntityId`, plus property fields
- Edit form shows from/to as read-only, only property fields editable
- Breadcrumb: `Ontologies → {ontology name} → Data → {relation type displayName}`

## 3. Shared Components

### DynamicForm

**File:** `components/runtime/DynamicForm.tsx`

Renders form fields from an array of property definitions. Used for entity and relation create/edit.

**Props:**
- `properties: RuntimePropertyDef[]` — schema property definitions
- `initialValues?: Record<string, unknown>` — for edit mode
- `onSubmit: (values: Record<string, unknown>) => void`
- `onCancel: () => void`
- `errors?: Record<string, string>` — field-level errors from backend 422
- `loading?: boolean`

**Data type → input mapping:**
| dataType | Input | Notes |
|----------|-------|-------|
| string | `<input type="text">` | |
| integer | `<input type="number" step="1">` | |
| float | `<input type="number" step="any">` | |
| boolean | `<input type="checkbox">` | |
| date | `<input type="date">` | |
| datetime | `<input type="datetime-local">` | |

**Behavior:**
- Required fields marked with asterisk, HTML `required` attribute set
- For edit mode: only submit changed fields (diff against `initialValues`)
- Null removal: if user clears an optional field, submit `null` for that key
- Show `errors` map below corresponding fields (from backend validation)

### DataTable

**File:** `components/runtime/DataTable.tsx`

Generic table for displaying instance data with sortable columns and actions.

**Props:**
- `columns: { key: string; label: string; sortable?: boolean }[]`
- `rows: Record<string, unknown>[]` — instance data
- `idKey?: string` — defaults to `_id`
- `sortKey: string` — current sort column
- `sortOrder: 'asc' | 'desc'`
- `onSort: (key: string) => void`
- `onEdit: (id: string) => void`
- `onDelete: (id: string) => void`

**Behavior:**
- Renders column headers with sort indicators (clickable for sortable columns)
- Action column with Edit/Delete buttons per row
- Booleans render as "Yes"/"No", dates formatted via `toLocaleDateString()`

### Pagination

**File:** `components/runtime/Pagination.tsx`

**Props:**
- `total: number`
- `limit: number`
- `offset: number`
- `onChange: (offset: number) => void`

Renders: "Showing X–Y of Z" text, Previous/Next buttons, disabled at boundaries.

### EntityPicker

**File:** `components/runtime/EntityPicker.tsx`

Select input for choosing an entity instance (used in relation create form).

**Props:**
- `ontologyKey: string`
- `entityTypeKey: string`
- `value: string | null` — selected entity `_id`
- `onChange: (id: string) => void`
- `label: string` — e.g., "From (Person)"

**Behavior:**
- Loads entities via `GET /entities/{entityTypeKey}?limit=20&q={searchTerm}`
- Text input with debounced search — results shown as dropdown
- Each option shows the entity's display label (first string property value, fallback to `_id`)
- Selected entity shown by display label

### Modal

**File:** `components/runtime/Modal.tsx`

Simple overlay modal wrapper. No new dependencies — plain div with fixed positioning and backdrop.

**Props:**
- `open: boolean`
- `onClose: () => void`
- `title: string`
- `children: ReactNode`

## 4. API Client

Create `api/runtimeClient.ts` following the same pattern as `api/client.ts`.

```ts
const RUNTIME_BASE_URL = 'http://localhost:8000/api/runtime';

// Reuse the request helper and ApiError from client.ts (extract to shared api/request.ts)
```

**Functions:**

```ts
// Schema
getSchema(ontologyKey): RuntimeSchema

// Entities
listEntities(ontologyKey, entityTypeKey, params?): PaginatedResponse<EntityInstance>
createEntity(ontologyKey, entityTypeKey, data): EntityInstance
getEntity(ontologyKey, entityTypeKey, id): EntityInstance
updateEntity(ontologyKey, entityTypeKey, id, data): EntityInstance
deleteEntity(ontologyKey, entityTypeKey, id): void

// Relations
listRelations(ontologyKey, relationTypeKey, params?): PaginatedResponse<RelationInstance>
createRelation(ontologyKey, relationTypeKey, data): RelationInstance
getRelation(ontologyKey, relationTypeKey, id): RelationInstance
updateRelation(ontologyKey, relationTypeKey, id, data): RelationInstance
deleteRelation(ontologyKey, relationTypeKey, id): void

// Other
getNeighbors(ontologyKey, entityTypeKey, id, params?): NeighborResponse
wipeData(ontologyKey): WipeDataResponse
```

**List params type:**
```ts
interface ListParams {
  limit?: number;
  offset?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  q?: string;  // entities only
  filters?: Record<string, string>;  // serialized as filter.{key}={value}
  fromEntityId?: string;  // relations only
  toEntityId?: string;    // relations only
}
```

**Refactor:** Extract the `request` helper and `ApiError` class from `api/client.ts` into `api/request.ts`, shared by both clients. This avoids duplicating the fetch wrapper.

## 5. Type Definitions

Create `types/runtime.ts`:

```ts
import type { DataType } from './models';

// Schema introspection types
export interface RuntimeSchema {
  ontology: {
    ontologyId: string;
    name: string;
    key: string;
    description: string | null;
  };
  entityTypes: RuntimeEntityType[];
  relationTypes: RuntimeRelationType[];
}

export interface RuntimeEntityType {
  key: string;
  displayName: string;
  description: string | null;
  properties: RuntimePropertyDef[];
}

export interface RuntimeRelationType {
  key: string;
  displayName: string;
  description: string | null;
  fromEntityTypeKey: string;
  toEntityTypeKey: string;
  properties: RuntimePropertyDef[];
}

export interface RuntimePropertyDef {
  key: string;
  displayName: string;
  description: string | null;
  dataType: DataType;
  required: boolean;
  defaultValue: string | null;
}

// Instance types
export interface EntityInstance {
  _id: string;
  _entityTypeKey: string;
  _createdAt: string;
  _updatedAt: string;
  [key: string]: unknown;
}

export interface RelationInstance {
  _id: string;
  _relationTypeKey: string;
  _createdAt: string;
  _updatedAt: string;
  fromEntityId: string;
  toEntityId: string;
  [key: string]: unknown;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
```

## 6. Schema Caching Strategy

**Approach:** React context provider wrapping runtime routes.

**RuntimeSchemaProvider** (`context/RuntimeSchemaContext.tsx`):
- Reads `ontologyKey` from URL params
- Fetches `GET /schema` on mount and when `ontologyKey` changes
- Stores `RuntimeSchema` in state
- Provides `{ schema, loading, error, refetch }` via context
- `refetch()` available for manual refresh (e.g., after schema edits)

**Invalidation:**
- Schema is fetched fresh on every mount (entering runtime routes)
- If user edits schema in modeling UI and navigates back to runtime, the provider remounts and refetches
- No stale cache across navigations — React unmount/remount handles this naturally
- No TTL, no polling, no localStorage — keep it simple

**Usage in components:**
```ts
const { schema, loading } = useRuntimeSchema();
const entityType = schema?.entityTypes.find(et => et.key === entityTypeKey);
```

## 7. Navigation Integration

### Entry point: OntologyDetailPage

Add a "Manage Data" button next to the existing "Validate Schema" and "Export" buttons in `OntologyDetailPage.tsx`. Links to `/data/${ontology.key}`.

### Entry point: OntologyCard

Add a small "Data" link on each ontology card, linking to `/data/${ontology.key}`.

### Breadcrumbs

Each runtime page renders its own breadcrumb trail in the page content (same pattern as the existing `← Back to ontology` links):

- RuntimeDashboardPage: `← Back to ontology` → `/ontologies/${ontologyId}`
- EntityInstanceListPage: `← Back to data` → `/data/${ontologyKey}`
- RelationInstanceListPage: `← Back to data` → `/data/${ontologyKey}`

### Sidebar

No sidebar changes. Users enter runtime through the ontology detail page. The sidebar "Ontologies" link works for navigating back to the list.

### Cross-linking between modeling and runtime

The RuntimeDashboardPage shows a "Schema" link back to the modeling detail page (`/ontologies/${ontologyId}`), so users can switch between schema editing and data management. This requires the schema response's `ontology.ontologyId` field.

## 8. Backend Gaps

### Entity display labels on relation instances (nice-to-have)

**Problem:** Relation list responses include `fromEntityId` and `toEntityId` as UUIDs. To show meaningful labels in the UI (e.g., "Alice" instead of a UUID), the frontend must fetch each referenced entity individually.

**Impact:** For a page of 20 relations with ~15 unique entities, this means ~15 parallel GET requests after loading the relation list. Acceptable for MVP but not ideal.

**Suggested fix:** Add optional `_fromEntityDisplay` and `_toEntityDisplay` fields to relation list responses, each containing `{ _id, _entityTypeKey, <label> }` where `<label>` is the value of the entity's first string property.

**MVP workaround:** After loading a relation page, collect unique entity IDs, fetch them in parallel via `GET /entities/{entityTypeKey}/{id}`, and cache in a local lookup map. Use the first `string` property value as the display label.

### No other gaps identified

The 17 existing runtime endpoints cover all required CRUD operations, pagination, search, sorting, and filtering. No new endpoints needed for MVP.

## 9. File Summary

### New files

| File | Purpose |
|------|---------|
| `api/request.ts` | Shared `request` helper + `ApiError` (extracted from `client.ts`) |
| `api/runtimeClient.ts` | Runtime API client functions |
| `types/runtime.ts` | Runtime TypeScript types |
| `context/RuntimeSchemaContext.tsx` | Schema provider + `useRuntimeSchema` hook |
| `pages/RuntimeDashboardPage.tsx` | Data management entry point per ontology |
| `pages/EntityInstanceListPage.tsx` | Entity CRUD list page |
| `pages/RelationInstanceListPage.tsx` | Relation CRUD list page |
| `components/runtime/DynamicForm.tsx` | Schema-driven form fields |
| `components/runtime/DataTable.tsx` | Sortable instance data table |
| `components/runtime/Pagination.tsx` | Offset-based pagination controls |
| `components/runtime/EntityPicker.tsx` | Entity search/select for relations |
| `components/runtime/Modal.tsx` | Simple overlay modal |

### Modified files

| File | Change |
|------|--------|
| `main.tsx` | Add 3 runtime routes |
| `api/client.ts` | Import `request` + `ApiError` from `api/request.ts` instead of defining locally |
| `pages/OntologyDetailPage.tsx` | Add "Manage Data" button linking to `/data/${ontology.key}` |
| `components/OntologyCard.tsx` | Add "Data" link to `/data/${ontology.key}` |
