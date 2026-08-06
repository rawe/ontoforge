/**
 * Integration fixture, built through the modeling API:
 * person/company/works_for, an unscoped
 * lens `test_ontology`, and a scoped lens `hr_view` (person narrowed to
 * name+email, company whole, works_for included).
 */

import type { FastifyInstance } from "fastify";
import { expect } from "vitest";

type Row = Record<string, unknown>;

async function post(app: FastifyInstance, url: string, payload: Row): Promise<Row> {
  const res = await app.inject({ method: "POST", url, payload });
  expect(res.statusCode, `POST ${url}: ${res.body}`).toBe(201);
  return res.json() as Row;
}

export interface FixtureIds {
  personId: string;
  companyId: string;
  worksForId: string;
  testOntologyId: string;
  hrViewId: string;
}

export async function buildFixture(app: FastifyInstance): Promise<FixtureIds> {
  const person = await post(app, "/api/model/entity-types", {
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
    await post(app, `/api/model/entity-types/${personId}/properties`, prop);
  }

  const company = await post(app, "/api/model/entity-types", {
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
    await post(app, `/api/model/entity-types/${companyId}/properties`, prop);
  }

  const worksFor = await post(app, "/api/model/relation-types", {
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
    await post(app, `/api/model/relation-types/${worksForId}/properties`, prop);
  }

  const testOntology = await post(app, "/api/model/ontologies", {
    key: "test_ontology",
    name: "Test Ontology",
    description: "Person/Company ontology for testing",
  });

  const hrView = await post(app, "/api/model/ontologies", {
    key: "hr_view",
    name: "HR View",
    description: "HR-scoped view for testing",
  });
  const hrViewId = hrView.ontologyId as string;
  await post(app, `/api/model/ontologies/${hrViewId}/includes/entity-types`, {
    key: "person",
    properties: ["name", "email"],
  });
  await post(app, `/api/model/ontologies/${hrViewId}/includes/entity-types`, {
    key: "company",
  });
  await post(app, `/api/model/ontologies/${hrViewId}/includes/relation-types`, {
    key: "works_for",
  });

  return {
    personId,
    companyId,
    worksForId,
    testOntologyId: testOntology.ontologyId as string,
    hrViewId,
  };
}
