/**
 * Integration fixture, built through the registry and modeling APIs: one
 * ontology (`test_ont`) holding person/company/works_for, an unscoped
 * lens `test_lens`, and a scoped lens `hr_view` (person narrowed to
 * name+email, company whole, works_for included).
 *
 * The MCP mounts, like REST, name their ontology in the URL — files
 * that hit them bind to `test_ont`.
 */

import type { FastifyInstance } from "fastify";
import { expect } from "vitest";

type Row = Record<string, unknown>;

async function post(app: FastifyInstance, url: string, payload: Row): Promise<Row> {
  const res = await app.inject({ method: "POST", url, payload });
  expect(res.statusCode, `POST ${url}: ${res.body}`).toBe(201);
  return res.json() as Row;
}

/** The fixture ontology every integration file models in. */
export const FIXTURE_ONTOLOGY_KEY = "test_ont";

/** The modeling tree of one ontology. */
export function modelPrefix(ontologyKey: string): string {
  return `/api/ontologies/${ontologyKey}/model`;
}

/** The runtime tree of one lens in one ontology. */
export function runtimePrefix(ontologyKey: string, lensKey: string): string {
  return `/api/ontologies/${ontologyKey}/runtime/lenses/${lensKey}`;
}

/** Create one bare ontology over the registry API. */
export async function createOntology(app: FastifyInstance, key: string): Promise<void> {
  await post(app, "/api/ontologies", { key });
}

export interface FixtureIds {
  ontologyKey: string;
  personId: string;
  companyId: string;
  worksForId: string;
  testLensId: string;
  hrViewId: string;
}

export async function buildFixture(app: FastifyInstance): Promise<FixtureIds> {
  await createOntology(app, FIXTURE_ONTOLOGY_KEY);
  const model = modelPrefix(FIXTURE_ONTOLOGY_KEY);

  const person = await post(app, `${model}/entity-types`, {
    key: "person",
    displayName: "Person",
    description: "A human being",
  });
  const personId = person.entityTypeId as string;
  for (const prop of [
    { key: "name", displayName: "Name", dataType: "string", required: true },
    { key: "age", displayName: "Age", dataType: "integer", required: false },
    { key: "email", displayName: "Email", dataType: "string", required: false },
    { key: "active", displayName: "Active", dataType: "boolean", required: false, defaultValue: "true" },
    { key: "hired_at", displayName: "Hired At", dataType: "datetime", required: false },
  ]) {
    await post(app, `${model}/entity-types/${personId}/properties`, prop);
  }

  const company = await post(app, `${model}/entity-types`, {
    key: "company",
    displayName: "Company",
    description: "A business organization",
  });
  const companyId = company.entityTypeId as string;
  for (const prop of [
    { key: "name", displayName: "Name", dataType: "string", required: true },
    { key: "founded", displayName: "Founded", dataType: "date", required: false },
    { key: "employee_count", displayName: "Employee Count", dataType: "integer", required: false },
  ]) {
    await post(app, `${model}/entity-types/${companyId}/properties`, prop);
  }

  const worksFor = await post(app, `${model}/relation-types`, {
    key: "works_for",
    displayName: "Works For",
    description: "Employment relationship",
    sourceEntityTypeKey: "person",
    targetEntityTypeKey: "company",
  });
  const worksForId = worksFor.relationTypeId as string;
  for (const prop of [
    { key: "since", displayName: "Since", dataType: "date", required: false },
    { key: "role", displayName: "Role", dataType: "string", required: false },
  ]) {
    await post(app, `${model}/relation-types/${worksForId}/properties`, prop);
  }

  const testLens = await post(app, `${model}/lenses`, {
    key: "test_lens",
    name: "Test Lens",
    description: "Person/Company lens for testing",
  });

  const hrView = await post(app, `${model}/lenses`, {
    key: "hr_view",
    name: "HR View",
    description: "HR-scoped view for testing",
  });
  const hrViewId = hrView.lensId as string;
  await post(app, `${model}/lenses/${hrViewId}/includes/entity-types`, {
    key: "person",
    properties: ["name", "email"],
  });
  await post(app, `${model}/lenses/${hrViewId}/includes/entity-types`, {
    key: "company",
  });
  await post(app, `${model}/lenses/${hrViewId}/includes/relation-types`, {
    key: "works_for",
  });

  return {
    ontologyKey: FIXTURE_ONTOLOGY_KEY,
    personId,
    companyId,
    worksForId,
    testLensId: testLens.lensId as string,
    hrViewId,
  };
}
