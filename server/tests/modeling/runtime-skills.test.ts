/**
 * Runtime-skill modeling endpoints over mocked stores: list, read, upsert
 * and delete by key; the key rule (the Agent Skill name rule), the
 * description's 1 to 1024 characters and non-empty content, every
 * violation reported together.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockRuntimeStore, type MockRuntimeStore } from "../runtime/helpers.js";
import { createMockModelingStore, NOW, type MockModelingStore } from "./helpers.js";

type Row = Record<string, unknown>;

const holder: { store: MockModelingStore; runtimeStore: MockRuntimeStore } = {
  store: createMockModelingStore(),
  runtimeStore: createMockRuntimeStore(),
};

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: async () => holder.store,
  getSearchIndexStore: async () => holder.store.searchIndices(),
  getRuntimeStore: async () => holder.runtimeStore,
}));

const MOCK_LENS = { lensId: "lens-1", key: "full_lens", name: "Full", description: null, createdAt: NOW, updatedAt: NOW };

const STORED = {
  runtimeSkillId: "rs-1",
  key: "find-people",
  description: "Find people by name or role.",
  content: "# Find people\n",
  createdAt: NOW,
  updatedAt: NOW,
};

const RESPONSE = {
  key: "find-people",
  description: "Find people by name or role.",
  content: "# Find people\n",
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
};

const URL = "/api/ontologies/onto/model/lenses/full_lens/skills";

let app: FastifyInstance;

beforeAll(async () => {
  const { createApp } = await import("../../src/app.js");
  app = await createApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  holder.store = createMockModelingStore();
  holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
});

async function put(key: string, body: Row = { description: STORED.description, content: STORED.content }) {
  return app.inject({ method: "PUT", url: `${URL}/${key}`, payload: body });
}

const errorsOf = (res: { json: () => Row }) =>
  ((res.json().error as Row).details as { errors: unknown[] }).errors;

describe("list and read", () => {
  it("lists the lens's runtime skills with their content", async () => {
    holder.store.listRuntimeSkills.mockResolvedValue([STORED]);
    const res = await app.inject({ method: "GET", url: URL });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([RESPONSE]);
    expect(holder.store.listRuntimeSkills).toHaveBeenCalledWith("lens-1");
  });

  it("lists none for a lens without runtime skills", async () => {
    const res = await app.inject({ method: "GET", url: URL });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("reads one by key, and answers 404 for a key the lens does not hold", async () => {
    holder.store.listRuntimeSkills.mockResolvedValue([STORED]);
    const found = await app.inject({ method: "GET", url: `${URL}/find-people` });
    expect(found.statusCode).toBe(200);
    expect(found.json()).toEqual(RESPONSE);
    const missing = await app.inject({ method: "GET", url: `${URL}/ghost` });
    expect(missing.statusCode).toBe(404);
    expect((missing.json().error as Row).message).toBe("Runtime skill 'ghost' not found");
  });

  it("an unknown lens key answers 404", async () => {
    holder.store.getLensByKey.mockResolvedValue(null);
    expect((await app.inject({ method: "GET", url: "/api/ontologies/onto/model/lenses/nope/skills" })).statusCode).toBe(404);
  });
});

describe("upsert", () => {
  it("create answers 201 and stores key, description and content in the lens", async () => {
    holder.store.upsertRuntimeSkill.mockResolvedValue([STORED, true]);
    const res = await put("find-people");
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toEqual(RESPONSE);
    const [lensId, , key, description, content] = holder.store.upsertRuntimeSkill.mock.calls[0]!;
    expect([lensId, key, description, content]).toEqual(["lens-1", "find-people", STORED.description, STORED.content]);
    expect(holder.store.changeDesign).toHaveBeenCalled();
  });

  it("replace answers 200", async () => {
    holder.store.upsertRuntimeSkill.mockResolvedValue([STORED, false]);
    expect((await put("find-people")).statusCode).toBe(200);
  });

  it.each([
    ["an underscore", "find_people"],
    ["an upper-case letter", "Find-people"],
    ["a leading hyphen", "-find"],
    ["a trailing hyphen", "find-"],
    ["a double hyphen", "find--people"],
    ["65 characters", "a".repeat(65)],
  ])("a key with %s is refused 422", async (_label, key) => {
    const res = await put(key);
    expect(res.statusCode).toBe(422);
    expect(errorsOf(res)).toEqual([expect.stringContaining("1 to 64 lowercase letters, digits and single hyphens")]);
    expect(holder.store.upsertRuntimeSkill).not.toHaveBeenCalled();
  });

  it("accepts a key of digits and one of 64 characters", async () => {
    holder.store.upsertRuntimeSkill.mockResolvedValue([STORED, true]);
    expect((await put("123")).statusCode).toBe(201);
    expect((await put("a".repeat(64))).statusCode).toBe(201);
  });

  it("refuses an empty description, one over 1024 characters and empty content, every violation together", async () => {
    const res = await put("Bad_Key", { description: "", content: "" });
    expect(res.statusCode).toBe(422);
    expect(errorsOf(res)).toEqual([
      expect.stringContaining("Invalid runtime skill key 'Bad_Key'"),
      "description must be 1 to 1024 characters",
      "content must not be empty",
    ]);
    expect(errorsOf(await put("long", { description: "x".repeat(1025), content: "c" }))).toEqual([
      "description must be 1 to 1024 characters",
    ]);
    expect(holder.store.upsertRuntimeSkill).not.toHaveBeenCalled();
  });

  it("counts the description in characters, not UTF-16 units", async () => {
    holder.store.upsertRuntimeSkill.mockResolvedValue([STORED, true]);
    expect((await put("emoji", { description: "😀".repeat(1024), content: "c" })).statusCode).toBe(201);
  });

  it("a body without content is refused at the request shape", async () => {
    const res = await put("find-people", { description: "d" });
    expect(res.statusCode).toBe(422);
  });
});

describe("delete", () => {
  it("answers 204", async () => {
    holder.store.deleteRuntimeSkill.mockResolvedValue(true);
    const res = await app.inject({ method: "DELETE", url: `${URL}/find-people` });
    expect(res.statusCode).toBe(204);
    expect(holder.store.deleteRuntimeSkill).toHaveBeenCalledWith("lens-1", "find-people");
  });

  it("answers 404 for a key the lens does not hold", async () => {
    const res = await app.inject({ method: "DELETE", url: `${URL}/ghost` });
    expect(res.statusCode).toBe(404);
  });
});
