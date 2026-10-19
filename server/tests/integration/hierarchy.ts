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
