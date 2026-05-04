# M4 frontend follow-up — expose `displayNameProperty` and `defaultSearchProperties` in the EntityType editor

**Status:** plan settled, awaiting implementation.
**Backend:** M4 backend has shipped to working tree (see `m4-plan.md`); both fields exist on `EntityType` create/update API. Backend smoke + integration tests are green.

---

## 1. Goal

Surface the two new optional EntityType fields in the frontend so a user can configure them through the schema UI:

- `displayNameProperty: string | null` — single property key on the type, used by the cross-type semantic search response and (eventually) by other UIs that need a human-readable label.
- `defaultSearchProperties: string[] | null` — ordered list of property keys to include in the cross-type semantic search response when the caller does not specify a projection. Order is preserved.

These fields are validated on the backend: each referenced key must exist as a `PropertyDefinition` on the same EntityType. Cascade is automatic: if a referenced property is deleted, the backend silently clears the reference. Property keys are immutable today, so the rename-cascade safety net does not need a UI surface.

## 2. Out of scope

- Display name showing up in any other UI surface (entity instance list, entity detail panel, graph node labels, etc.). Those callers can adopt `displayNameProperty` later as a separate, larger piece of work.
- Server-driven `defaultSearchProperties` projection in any UI other than the cross-type semantic search consumer (no such consumer exists in the frontend yet — this is a configuration surface only).
- Any change to the create flow at `SchemaPage` for these two fields (see §6.3).
- Any touching of `RelationTypeForm` — the symmetric work for relation types is deferred per `m4-plan.md` §3 #12.

## 3. Required research (intensive — do not skip)

The implementer must read enough of the frontend to make non-stupid UX choices. At minimum:

- `frontend/src/components/forms/EntityTypeForm.tsx` — the existing form (key + displayName + description). Plain controlled inputs, no form library.
- `frontend/src/pages/EntityTypeEditorPage.tsx` — the edit-mode page that loads the type and its properties via `api.getEntityType` and `api.listProperties`. This is where the new fields belong.
- `frontend/src/pages/SchemaPage.tsx` — uses `EntityTypeForm` in create mode (twice, around lines 259 and 307). The new fields must NOT appear in create mode; the type has no properties yet.
- `frontend/src/api/client.ts` — `getEntityType`, `createEntityType`, `updateEntityType`. The request/response payload for the two new fields needs to plumb through.
- `frontend/src/types/models.ts` — `EntityType` interface; needs the two new fields.
- `frontend/src/components/PropertyTable.tsx` — read it to understand how property add/edit/delete already triggers reloads, so the new dropdowns can stay in sync after property mutations.
- Any toast / error rendering pattern already in use (`sonner`) — the form must surface backend 422 messages cleanly when an invalid key is submitted.
- `frontend/src/pages/RelationTypeEditorPage.tsx` and `frontend/src/components/forms/RelationTypeForm.tsx` — read for stylistic consistency only. Do NOT add the new fields here.
- `frontend/package.json` — confirm available dependencies. There is no form library, no select library beyond `@radix-ui/react-dialog`. Native `<select>` is fine.

The implementer is expected to read every file above before writing any code. If the actual structure deviates from what this plan describes, surface the deviation in the report rather than silently working around it.

## 4. Constraints

- **No new dependencies** unless absolutely necessary. The codebase has no form library, no select library, no DnD library. Plain HTML elements with Tailwind are the established pattern.
- **No AI attribution** anywhere — no "Generated with Claude", no `Co-Authored-By` lines.
- **Do not commit.** Leave changes in the working tree.
- **TypeScript must build cleanly.** Run `npm run build` (or `tsc -b`) and report.
- **ESLint must pass.** Run `npm run lint` and report.
- **The fields are EDIT-MODE ONLY.** Do not put them in create form. (See §6.3 for the rationale.)

## 5. UX decisions

These are decided. The implementer should follow them.

| Decision | Resolution |
|---|---|
| Where the fields appear | EntityType editor page only, inside `EntityTypeForm` when rendered in edit mode. Hidden in create mode. |
| Control for `displayNameProperty` | Native `<select>` dropdown. Options: blank "(none — no display name)", followed by every existing string-typed property of the type, by `key` (with `displayName` shown in parens for readability). |
| Type-filter for the displayName dropdown | Only include properties where `dataType === 'string'`. The backend doesn't enforce string-typed (per `m4-plan.md` decision #13, it coerces with `str(value)`), but the UI should guide the user toward the sensible choice. Surface the filter in helper text. |
| Control for `defaultSearchProperties` | Ordered multi-select. A simple, low-dependency implementation: render the property list with a checkbox + an order index input next to each, OR use a two-list pattern (available / selected with up/down move buttons). Implementer picks the cleanest one. Order MUST be preserved on submit. |
| Empty-state for both controls | If the type has zero properties, show an inline note ("Add a property first to configure these fields") and disable both controls. |
| Validation surfacing | On submit, if backend returns 422, render the error message via `toast.error` and keep the form open with current values. |
| Cascade visibility | The backend auto-clears references on property delete. The UI does not need to warn before deleting a referenced property — the backend is silent and idempotent. After a property delete, reload the editor data so the form reflects the cleared state. |
| What `displayName` text to show in dropdowns | `"{property.displayName} ({property.key})"`. |
| Initial values when editing | Load from the EntityType payload. If the field is `null` / `[]`, render the empty state in the dropdowns (no preselection). |
| Submit payload shape | Always send both fields on submit. Use `null` for cleared `displayNameProperty`; use `[]` for empty `defaultSearchProperties`. The backend handles both. |

## 6. Implementation plan by area

### 6.1 Types — `src/types/models.ts`

Extend `EntityType`:

```ts
export interface EntityType {
  entityTypeId: string;
  key: string;
  displayName: string;
  description: string | null;
  displayNameProperty: string | null;
  defaultSearchProperties: string[] | null;
  createdAt: string;
  updatedAt: string;
}
```

### 6.2 API client — `src/api/client.ts`

`getEntityType` already returns the full payload — verify it now includes the two fields and TypeScript is happy. Adjust the return type if `client.ts` defines an inline response shape.

`updateEntityType`: extend the body type to accept the two new optional fields. Send them when present in the form data.

`createEntityType`: do NOT send the two new fields. They are not configurable at creation time.

### 6.3 EntityTypeForm — `src/components/forms/EntityTypeForm.tsx`

This component is used in three places: one edit-mode call site (the editor page) and two create-mode call sites (`SchemaPage`). The form needs a way to know which mode it is in; currently it infers via `isEdit = !!initial`. Reuse this signal.

**Required changes:**

- Extend `Props.initial` to include `displayNameProperty` and `defaultSearchProperties`.
- Add an optional prop `properties?: PropertyDefinition[]` for the dropdown options. When `isEdit` is true and `properties` is provided, render the two new controls; otherwise hide them.
- Extend `Props.onSubmit` to include the two new fields.
- Track form state for both fields with `useState`.
- Render the controls per §5 UX decisions.
- On submit: include `displayNameProperty` (string or null) and `defaultSearchProperties` (string[] — possibly empty) in the data passed to `onSubmit`. Trim/normalize empty selections to the right shape.

**Preserve existing behavior:** the form must continue to work in create mode without breaking — the new controls are gated behind `isEdit && properties`.

### 6.4 EntityTypeEditorPage — `src/pages/EntityTypeEditorPage.tsx`

- Pass the loaded `properties` array into `EntityTypeForm` when rendering in edit mode.
- Pass `displayNameProperty` and `defaultSearchProperties` into `initial`.
- Update `handleUpdate` to accept and forward the two new fields to `api.updateEntityType`.
- After a property delete, the existing `load()` call already refetches; verify the form's local state for the two fields gets refreshed when the user re-opens the editor (the backend will have cleared references, so the loaded EntityType reflects truth).

### 6.5 SchemaPage — `src/pages/SchemaPage.tsx`

No code changes if `EntityTypeForm` correctly hides the new controls in create mode (no `properties` prop passed). Verify by walking through both create call sites in the diff.

### 6.6 PropertyTable interaction

When the user adds, edits, or deletes a property, `EntityTypeEditorPage::load()` already refetches both the type and its properties. After the fetch:
- The dropdown options reflect current properties.
- If the form is currently open (editing), the new options should appear immediately. If implementing this requires lifting state, do it cleanly. Acceptable alternative: close the form on property mutations and require the user to reopen — but only if the cleaner refetch-while-open approach is hard.

## 7. Test plan

This is a UI feature — tests must exercise the actual UI, not just the type system.

### 7.1 Static checks

- `cd frontend && npm run build` — must succeed with zero TS errors.
- `cd frontend && npm run lint` — must succeed with zero violations.

### 7.2 Manual browser walkthrough

The team lead will independently verify, but the implementer must do this first and report observations.

Backend prerequisites (already running on the team lead's machine):
- Neo4j on `bolt://localhost:7687`, creds `neo4j:ontoforge_dev`.
- Ollama on `http://localhost:11434` with `nomic-embed-text`.
- Backend on `http://localhost:8000` with embedding env vars set.

Frontend dev server: `cd frontend && npm run dev` (default port 5173).

Walkthrough cases:

1. **Create a new EntityType.** Go to Schema page; create form should not show the two new fields.
2. **Open the new type in the editor.** Both new dropdowns should be present but disabled with the empty-state hint, because no properties exist yet.
3. **Add three properties** (e.g., `name` string required, `role` string optional, `bio` string optional).
4. **Re-open the editor form (Edit button).** Both controls should now be enabled. The displayName dropdown should list the three string properties. The defaultSearchProperties multi-select should also list them.
5. **Set `displayNameProperty=name`, `defaultSearchProperties=[role, bio]`** in that order. Save. The page should reload showing the saved values.
6. **Re-open the form** — values should be preselected correctly.
7. **Reorder `defaultSearchProperties` to [bio, role]**. Save. Verify the API received them in the new order (network tab) and the reload reflects it.
8. **Try setting an invalid key** by hand-editing the request (or via curl) — backend returns 422; UI should `toast.error` the message and keep the form open.
9. **Delete a property that is referenced** (e.g., delete `role`). The backend silently clears the reference. The editor should refetch and show the property removed from `defaultSearchProperties`.
10. **Negative — non-string property** (e.g., add an `integer` property). It should NOT appear in the displayName dropdown. It MAY appear in defaultSearchProperties (the backend accepts any property type for projection).
11. **No regression** — verify create flow on Schema page still works; verify RelationTypeEditor unchanged; verify entity instance list page still loads.

Implementer must capture each step's observed behavior in the final report.

## 8. Risk

| Risk | Mitigation |
|---|---|
| Form state leaks across mode toggles | Reset form state on `editing` prop changes — already true for the existing fields; just extend |
| TypeScript inferred any shows up because `EntityType` was loosely typed elsewhere | Run `npm run build` and fix all TS errors |
| Multi-select UX feels clunky | Keep it simple. Two-list move-buttons or checkbox-with-order-input. The user can iterate later |
| Backend has dropped or renamed an API field name during integration | Re-verify `getEntityType` response shape against `backend/src/ontoforge_server/modeling/schemas.py` before plumbing types |
| Lint config disallows specific patterns | Run `npm run lint` early and adapt |

## 9. Final report (return as your answer)

1. **Research summary** — files read, key findings.
2. **Files changed** — bullet list, grouped by area.
3. **Static check results** — `npm run build` and `npm run lint` outputs (final lines).
4. **Browser walkthrough** — for each of the 11 cases in §7.2, observed behavior. Be honest if a case wasn't tested or didn't pass.
5. **Deviations from the plan** — anything you decided differently and why.
6. **Known gotchas / TODOs surfaced.**

## 10. Documents to update when this ships

- `docs/api-contracts/modeling-api.md` — already updated by the backend implementer. Verify the frontend matches.
- `docs/feature-ideas/relation-facts/roadmap.md` — once frontend lands, M4 is fully shipped. Update the milestone row.
- This document — add a `**Status: shipped**` banner at the top with the PR link.
