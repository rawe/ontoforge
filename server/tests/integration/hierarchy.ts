/**
 * An in-test hierarchy, built through the registry, modeling and runtime
 * APIs in its own ontology (`hier_ont`), beside the main fixture:
 *
 * - customer › project › task, through `has_project` and `has_task`
 *   (parent: source), and the self-relation `has_subtask` (task → task,
 *   parent: source), a second parent relation into task;
 * - `belongs_to` (milestone → project, parent: target), up-pointing;
 * - `assigned_to` (task → person), ordinary.
 *
 * Entities: ACME › P1 › T1 › T1a, ACME › P2 › T2, M1 belongs to P1, T1 is
 * assigned to Ben. Lenses: `all` (unscoped) and `portfolio` (customer,
 * project and milestone; task and its relations hidden).
 */

import type { FastifyInstance } from "fastify";
import { expect } from "vitest";

import { createOntology, modelPrefix, runtimePrefix } from "./fixture.js";

type Row = Record<string, unknown>;

export const HIERARCHY_ONTOLOGY_KEY = "hier_ont";

/** The ids of the hierarchy's entities, by name. */
export type HierarchyIds = Record<
  "ACME" | "P1" | "P2" | "T1" | "T1a" | "T2" | "M1" | "Ben",
  string
>;

async function post(app: FastifyInstance, url: string, payload: Row): Promise<Row> {
  const res = await app.inject({ method: "POST", url, payload });
  expect(res.statusCode, `POST ${url}: ${res.body}`).toBe(201);
  return res.json() as Row;
}

export async function buildHierarchy(app: FastifyInstance): Promise<HierarchyIds> {
  await createOntology(app, HIERARCHY_ONTOLOGY_KEY);
  const model = modelPrefix(HIERARCHY_ONTOLOGY_KEY);

  for (const key of ["customer", "project", "task", "milestone", "person"]) {
    await post(app, `${model}/entity-types`, { key, displayName: key });
  }
  for (const [key, source, target, parent] of [
    ["has_project", "customer", "project", "source"],
    ["has_task", "project", "task", "source"],
    ["has_subtask", "task", "task", "source"],
    ["belongs_to", "milestone", "project", "target"],
    ["assigned_to", "task", "person", null],
  ] as const) {
    await post(app, `${model}/relation-types`, {
      key,
      displayName: key,
      sourceEntityTypeKey: source,
      targetEntityTypeKey: target,
      parent,
    });
  }

  await post(app, `${model}/lenses`, { key: "all", name: "All" });
  const portfolio = await post(app, `${model}/lenses`, { key: "portfolio", name: "Portfolio" });
  const portfolioId = portfolio.lensId as string;
  for (const key of ["customer", "project", "milestone"]) {
    await post(app, `${model}/lenses/${portfolioId}/includes/entity-types`, { key });
  }
  for (const key of ["has_project", "belongs_to"]) {
    await post(app, `${model}/lenses/${portfolioId}/includes/relation-types`, { key });
  }

  const runtime = runtimePrefix(HIERARCHY_ONTOLOGY_KEY, "all");
  const entity = async (type: string, name: string): Promise<string> =>
    (await post(app, `${runtime}/entities/${type}`, { name }))._id as string;
  const relate = async (type: string, from: string, to: string): Promise<void> => {
    await post(app, `${runtime}/relations/${type}`, { fromEntityId: from, toEntityId: to });
  };

  const ids: HierarchyIds = {
    ACME: await entity("customer", "ACME"),
    P1: await entity("project", "P1"),
    P2: await entity("project", "P2"),
    T1: await entity("task", "T1"),
    T1a: await entity("task", "T1a"),
    T2: await entity("task", "T2"),
    M1: await entity("milestone", "M1"),
    Ben: await entity("person", "Ben"),
  };
  await relate("has_project", ids.ACME, ids.P1);
  await relate("has_project", ids.ACME, ids.P2);
  await relate("has_task", ids.P1, ids.T1);
  await relate("has_subtask", ids.T1, ids.T1a);
  await relate("has_task", ids.P2, ids.T2);
  await relate("belongs_to", ids.M1, ids.P1);
  await relate("assigned_to", ids.T1, ids.Ben);
  return ids;
}

/** Give `has_task` a required string property `phase`, as the
 * development fixture has it. The relations already stored keep none. */
export async function requirePhaseOnHasTask(app: FastifyInstance): Promise<void> {
  const model = modelPrefix(HIERARCHY_ONTOLOGY_KEY);
  const listed = await app.inject({ method: "GET", url: `${model}/relation-types` });
  const hasTask = (listed.json() as Row[]).find((rt) => rt.key === "has_task")!;
  await post(app, `${model}/relation-types/${hasTask.relationTypeId as string}/properties`, {
    key: "phase",
    displayName: "Phase",
    dataType: "string",
    required: true,
  });
}

/** Add the lens `delivery`: customer and task, with `has_subtask`; the
 * middle level, project, is hidden. */
export async function addLensHidingProject(app: FastifyInstance): Promise<void> {
  const model = modelPrefix(HIERARCHY_ONTOLOGY_KEY);
  const lens = await post(app, `${model}/lenses`, { key: "delivery", name: "Delivery" });
  const lensId = lens.lensId as string;
  for (const key of ["customer", "task"]) {
    await post(app, `${model}/lenses/${lensId}/includes/entity-types`, { key });
  }
  await post(app, `${model}/lenses/${lensId}/includes/relation-types`, { key: "has_subtask" });
}

export const PROJECT_HIERARCHY_ONTOLOGY_KEY = "proj_hier";

/** The names of the project hierarchy's entities. */
export type ProjectHierarchyName =
  | "ACME" | "BETA" | "P1" | "P2" | "P3"
  | "T1" | "T1a" | "T1a1" | "T2" | "T2a" | "T3" | "T4" | "T5" | "T6"
  | "M1" | "M2" | "Lea" | "Ben" | "Kim" | "Ana" | "open";

export interface ProjectHierarchyIds {
  entities: Record<ProjectHierarchyName, string>;
  /** Relation ids by `<from> <type> <to>`, for example `P1 has_task T1`. */
  relations: Record<string, string>;
}

/**
 * The development fixture `project_hierarchy` in its own ontology
 * (`proj_hier`), trimmed to what the write guard's tests need:
 *
 * - customer › project › task through `has_project` and `has_task`
 *   (required string `phase`), the self-relation `has_subtask`, and the
 *   up-pointing `belongs_to` (milestone → project, parent: target);
 * - `manages` (person → person, parent: source), a separate hierarchy;
 * - the ordinary `assigned_to` (task → person), `has_status` (task →
 *   status) and `mentors` (person → person), plus `reviews` (person →
 *   task), which the fixture lacks: an ordinary relation into the
 *   hierarchy at its target end;
 * - task carries the document property `notes`.
 *
 * Entities: ACME › P1 › T1 › T1a › T1a1, P1 › T2 › T2a, P1 › T3,
 * ACME › P2 › T4 and T5, BETA › P3 › T6, M1 → P1, M2 → P3; Lea manages Ben,
 * Kim and Ana; T1 → Ben, T3 → Ana, T6 → Ana; T1 has status `open`; Ben
 * mentors Kim. Lenses: `all`; `portfolio` (customer, project, milestone);
 * `no_projects` (customer, task, milestone: project hidden, and with it
 * `belongs_to`, milestone's only parent relation).
 */
export async function buildProjectHierarchy(app: FastifyInstance): Promise<ProjectHierarchyIds> {
  const o = PROJECT_HIERARCHY_ONTOLOGY_KEY;
  await createOntology(app, o);
  const model = modelPrefix(o);

  const typeIds: Record<string, string> = {};
  for (const key of ["customer", "project", "task", "milestone", "person", "status"]) {
    typeIds[key] = (await post(app, `${model}/entity-types`, { key, displayName: key })).entityTypeId as string;
  }
  await post(app, `${model}/entity-types/${typeIds.task!}/properties`, {
    key: "notes",
    displayName: "Notes",
    dataType: "document",
  });
  for (const [key, source, target, parent] of [
    ["has_project", "customer", "project", "source"],
    ["has_task", "project", "task", "source"],
    ["has_subtask", "task", "task", "source"],
    ["belongs_to", "milestone", "project", "target"],
    ["manages", "person", "person", "source"],
    ["assigned_to", "task", "person", null],
    ["has_status", "task", "status", null],
    ["mentors", "person", "person", null],
    ["reviews", "person", "task", null],
  ] as const) {
    const rt = await post(app, `${model}/relation-types`, {
      key,
      displayName: key,
      sourceEntityTypeKey: source,
      targetEntityTypeKey: target,
      parent,
    });
    if (key === "has_task") {
      await post(app, `${model}/relation-types/${rt.relationTypeId as string}/properties`, {
        key: "phase",
        displayName: "Phase",
        dataType: "string",
        required: true,
      });
    }
  }

  await post(app, `${model}/lenses`, { key: "all", name: "All" });
  for (const [lens, types] of [
    ["portfolio", ["customer", "project", "milestone"]],
    ["no_projects", ["customer", "task", "milestone"]],
  ] as const) {
    const lensId = (await post(app, `${model}/lenses`, { key: lens, name: lens })).lensId as string;
    for (const key of types) {
      await post(app, `${model}/lenses/${lensId}/includes/entity-types`, { key });
    }
  }

  const runtime = runtimePrefix(o, "all");
  const types: Record<ProjectHierarchyName, string> = {
    ACME: "customer", BETA: "customer", P1: "project", P2: "project", P3: "project",
    T1: "task", T1a: "task", T1a1: "task", T2: "task", T2a: "task", T3: "task",
    T4: "task", T5: "task", T6: "task", M1: "milestone", M2: "milestone",
    Lea: "person", Ben: "person", Kim: "person", Ana: "person", open: "status",
  };
  const entities = {} as Record<ProjectHierarchyName, string>;
  for (const [name, type] of Object.entries(types) as [ProjectHierarchyName, string][]) {
    const props = type === "task" ? { name, notes: `Notes of ${name}` } : { name };
    entities[name] = (await post(app, `${runtime}/entities/${type}`, props))._id as string;
  }

  const relations: Record<string, string> = {};
  for (const [from, type, to] of [
    ["ACME", "has_project", "P1"], ["ACME", "has_project", "P2"], ["BETA", "has_project", "P3"],
    ["P1", "has_task", "T1"], ["P1", "has_task", "T2"], ["P1", "has_task", "T3"],
    ["P2", "has_task", "T4"], ["P2", "has_task", "T5"], ["P3", "has_task", "T6"],
    ["T1", "has_subtask", "T1a"], ["T1a", "has_subtask", "T1a1"], ["T2", "has_subtask", "T2a"],
    ["M1", "belongs_to", "P1"], ["M2", "belongs_to", "P3"],
    ["Lea", "manages", "Ben"], ["Lea", "manages", "Kim"], ["Lea", "manages", "Ana"],
    ["T1", "assigned_to", "Ben"], ["T3", "assigned_to", "Ana"], ["T6", "assigned_to", "Ana"],
    ["T1", "has_status", "open"], ["Ben", "mentors", "Kim"],
  ] as [ProjectHierarchyName, string, ProjectHierarchyName][]) {
    const props = type === "has_task" ? { phase: "build" } : {};
    const created = await post(app, `${runtime}/relations/${type}`, {
      fromEntityId: entities[from],
      toEntityId: entities[to],
      ...props,
    });
    relations[`${from} ${type} ${to}`] = created._id as string;
  }
  return { entities, relations };
}
