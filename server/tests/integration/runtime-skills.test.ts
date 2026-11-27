/**
 * Runtime skills against the real database: modeling REST and MCP create,
 * list, read, replace and delete by key within a lens; same-key skills in
 * two lenses stay independent; deleting the lens deletes its skills;
 * export/import carry them inside their lens, an older payload without
 * them importing none; and the runtime MCP mount serves exactly its own
 * lens's skills — listed, fetched by URI and read — never another lens's
 * or another ontology's, a change visible on the next request.
 */

import { type Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { SkillsClient } from "@modelcontextprotocol/client/ext/skills";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { mcpClient } from "../mcpClient.js";
import { createApp } from "../../src/app.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { buildFixture, createOntology, modelPrefix } from "./fixture.js";
import { wipeDatabase } from "./reset.js";

type Row = Record<string, unknown>;

const MODEL = modelPrefix("test_ont");

let app: FastifyInstance;
let baseUrl: string;

async function inject(method: "GET" | "PUT" | "POST" | "DELETE", url: string, payload?: unknown) {
  const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as Row }) });
  return { statusCode: res.statusCode, body: res.body === "" ? null : (res.json() as unknown) };
}

const skillsUrl = (lensKey: string, ontologyKey = "test_ont") => `${modelPrefix(ontologyKey)}/lenses/${lensKey}/skills`;

const put = (lensKey: string, key: string, description: string, content: string, ontologyKey = "test_ont") =>
  inject("PUT", `${skillsUrl(lensKey, ontologyKey)}/${key}`, { description, content });

/** Key and content of each listed skill. */
async function listed(lensKey: string, ontologyKey = "test_ont"): Promise<[unknown, unknown][]> {
  const res = await inject("GET", skillsUrl(lensKey, ontologyKey));
  expect(res.statusCode).toBe(200);
  return (res.body as Row[]).map((skill) => [skill.key, skill.content]);
}

async function connect(path: string): Promise<Client> {
  const client = mcpClient("runtime-skills-tests");
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}${path}`)));
  return client;
}

const runtimeMount = (lensKey: string, ontologyKey = "test_ont") => `/mcp/ontologies/${ontologyKey}/runtime/lenses/${lensKey}`;

beforeAll(async () => {
  await initStores();
  await wipeDatabase();
  app = await createApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("Expected a bound TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;
  await buildFixture(app);
});

afterAll(async () => {
  await wipeDatabase();
  await app.close();
  await closeStores();
});

describe("modeling REST", () => {
  it("a lens without runtime skills lists none, and its runtime mount serves none", async () => {
    expect(await listed("test_lens")).toEqual([]);
    const client = await connect(runtimeMount("test_lens"));
    try {
      const skills = new SkillsClient(client);
      expect(skills.supported).toBe(true);
      expect((await skills.list()).skills).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it("creates (201), reads, replaces (200) and deletes (204) a skill by key", async () => {
    const created = await put("test_lens", "find-people", "Find people.", "# Find people\n");
    expect(created.statusCode, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ key: "find-people", description: "Find people.", content: "# Find people\n" });

    const replaced = await put("test_lens", "find-people", "Find people by role.", "# Find people\n\nBy role.\n");
    expect(replaced.statusCode).toBe(200);
    const read = await inject("GET", `${skillsUrl("test_lens")}/find-people`);
    expect(read.statusCode).toBe(200);
    expect(read.body).toMatchObject({ key: "find-people", description: "Find people by role.", content: "# Find people\n\nBy role.\n" });
    // Replaced, not duplicated.
    expect(await listed("test_lens")).toEqual([["find-people", "# Find people\n\nBy role.\n"]]);

    expect((await inject("DELETE", `${skillsUrl("test_lens")}/find-people`)).statusCode).toBe(204);
    expect((await inject("DELETE", `${skillsUrl("test_lens")}/find-people`)).statusCode).toBe(404);
    expect((await inject("GET", `${skillsUrl("test_lens")}/find-people`)).statusCode).toBe(404);
    expect(await listed("test_lens")).toEqual([]);
  });

  it("refuses a key outside the Agent Skill name rule, an over-long description and empty content", async () => {
    const res = await put("test_lens", "find_people", "x".repeat(1025), "");
    expect(res.statusCode).toBe(422);
    expect((((res.body as Row).error as Row).details as Row).errors).toHaveLength(3);
    expect(await listed("test_lens")).toEqual([]);
  });

  it("same-key skills of two lenses are independent: editing or deleting one leaves its namesake intact", async () => {
    expect((await put("test_lens", "guide", "Test lens guide.", "Test body.")).statusCode).toBe(201);
    expect((await put("hr_view", "guide", "HR guide.", "HR body.")).statusCode).toBe(201);

    expect((await put("test_lens", "guide", "Test lens guide.", "Test body, edited.")).statusCode).toBe(200);
    expect(await listed("hr_view")).toEqual([["guide", "HR body."]]);

    expect((await inject("DELETE", `${skillsUrl("test_lens")}/guide`)).statusCode).toBe(204);
    expect(await listed("test_lens")).toEqual([]);
    expect(await listed("hr_view")).toEqual([["guide", "HR body."]]);
  });

  it("deleting the lens deletes its skills", async () => {
    const created = await inject("POST", `${MODEL}/lenses`, { key: "cascade_probe", name: "Cascade Probe" });
    expect(created.statusCode).toBe(201);
    expect((await put("cascade_probe", "doomed", "Doomed.", "Gone with the lens.")).statusCode).toBe(201);

    const deleted = await inject("DELETE", `${MODEL}/lenses/${(created.body as Row).lensId as string}`);
    expect(deleted.statusCode).toBe(200);
    expect((await inject("POST", `${MODEL}/lenses`, { key: "cascade_probe", name: "Again" })).statusCode).toBe(201);
    expect(await listed("cascade_probe")).toEqual([]);
  });
});

describe("modeling MCP", () => {
  it("set_runtime_skill, list_runtime_skills, get_runtime_skill and delete_runtime_skill", async () => {
    const client = await connect("/mcp/ontologies/test_ont/model");
    type Result = { content: { text: string }[]; isError?: boolean };
    const call = async (name: string, args: Row) => (await client.callTool({ name, arguments: args })) as unknown as Result;
    try {
      const set = await call("set_runtime_skill", {
        lens_key: "test_lens",
        key: "by-mcp",
        description: "Set over MCP.",
        content: "# By MCP\n",
      });
      expect(set.isError, set.content[0]!.text).toBeFalsy();
      expect(JSON.parse(set.content[0]!.text)).toMatchObject({ key: "by-mcp", content: "# By MCP\n", created: true });
      const again = await call("set_runtime_skill", { lens_key: "test_lens", key: "by-mcp", description: "Again.", content: "# Again\n" });
      expect(JSON.parse(again.content[0]!.text)).toMatchObject({ description: "Again.", created: false });

      const refused = await call("set_runtime_skill", { lens_key: "test_lens", key: "By_MCP", description: "d", content: "c" });
      expect(refused.isError).toBe(true);
      expect(refused.content[0]!.text).toContain("lowercase letters, digits and single hyphens");

      const list = await call("list_runtime_skills", { lens_key: "test_lens" });
      expect(JSON.parse(list.content[0]!.text)).toEqual([{ key: "by-mcp", description: "Again." }]);
      const got = await call("get_runtime_skill", { lens_key: "test_lens", skill_key: "by-mcp" });
      expect(JSON.parse(got.content[0]!.text)).toMatchObject({ key: "by-mcp", description: "Again.", content: "# Again\n" });

      // The export carries the skill; get_schema leaves runtime skills out.
      const lensOf = async (tool: string) =>
        JSON.parse((await call(tool, {})).content[0]!.text).lenses.find((lens: Row) => lens.key === "test_lens");
      expect((await lensOf("export_schema")).skills).toEqual([{ key: "by-mcp", description: "Again.", content: "# Again\n" }]);
      expect(await lensOf("get_schema")).not.toHaveProperty("skills");

      const deleted = await call("delete_runtime_skill", { lens_key: "test_lens", skill_key: "by-mcp" });
      expect(deleted.isError).toBeFalsy();
      expect(JSON.parse((await call("list_runtime_skills", { lens_key: "test_lens" })).content[0]!.text)).toEqual([]);
      const missing = await call("get_runtime_skill", { lens_key: "test_lens", skill_key: "by-mcp" });
      expect(missing.isError).toBe(true);
    } finally {
      await client.close();
    }
  });
});

describe("runtime MCP", () => {
  it("serves exactly its own lens's skills — listed, by URI and as a resource — and a change on the next request", async () => {
    expect((await put("test_lens", "only-test", "Only in test_lens.", "Test only.")).statusCode).toBe(201);
    await createOntology(app, "other_ont");
    expect((await inject("POST", `${modelPrefix("other_ont")}/lenses`, { key: "test_lens", name: "Namesake" })).statusCode).toBe(201);
    expect((await put("test_lens", "only-other", "Only in the other ontology.", "Other only.", "other_ont")).statusCode).toBe(201);

    const own = await connect(runtimeMount("hr_view"));
    const sameOntology = await connect(runtimeMount("test_lens"));
    const otherOntology = await connect(runtimeMount("test_lens", "other_ont"));
    try {
      const hr = new SkillsClient(own);
      expect((await hr.list()).skills.map((skill) => skill.frontmatter)).toEqual([
        { name: "guide", description: "HR guide." },
      ]);
      const { skill } = await hr.get("skill://guide/SKILL.md");
      const file = await hr.read(skill);
      expect(file.verified).toBe(true);
      expect(file.body).toBe("HR body.");
      // The runtime get_schema tool carries no skills.
      const schema = (await own.callTool({ name: "get_schema", arguments: {} })) as unknown as { content: { text: string }[] };
      expect(schema.content[0]!.text).not.toContain("HR body.");
      expect(JSON.parse(schema.content[0]!.text)).not.toHaveProperty("skills");

      // Another lens's skill, by URI and as a resource: not served here.
      await expect(hr.get("skill://only-test/SKILL.md")).rejects.toThrow(/No skill is served/);
      await expect(own.readResource({ uri: "skill://only-test/SKILL.md" })).rejects.toThrow(/not found/i);
      // Nor another ontology's lens of the same key.
      const test = new SkillsClient(sameOntology);
      expect((await test.list()).skills.map((s) => s.frontmatter.name)).toEqual(["only-test"]);
      await expect(test.get("skill://only-other/SKILL.md")).rejects.toThrow(/No skill is served/);
      await expect(sameOntology.readResource({ uri: "skill://only-other/SKILL.md" })).rejects.toThrow(/not found/i);
      const other = new SkillsClient(otherOntology);
      expect((await other.list()).skills.map((s) => s.frontmatter.name)).toEqual(["only-other"]);
      await expect(other.get("skill://only-test/SKILL.md")).rejects.toThrow(/No skill is served/);

      // A design change is seen on the next request.
      expect((await put("hr_view", "guide", "HR guide, revised.", "HR body, revised.")).statusCode).toBe(200);
      const revised = await hr.get("skill://guide/SKILL.md");
      expect(revised.skill.frontmatter.description).toBe("HR guide, revised.");
      expect((await hr.read(revised.skill)).body).toBe("HR body, revised.");
    } finally {
      await own.close();
      await sameOntology.close();
      await otherOntology.close();
    }
  });
});

describe("transfer", () => {
  it("export carries a lens's skills; import into another ontology recreates them", async () => {
    const exported = (await inject("GET", `${MODEL}/export`)).body as { lenses: Row[] };
    const carried = Object.fromEntries(exported.lenses.map((lens) => [lens.key, lens.skills]));
    expect(carried["hr_view"]).toEqual([{ key: "guide", description: "HR guide, revised.", content: "HR body, revised." }]);
    expect(carried["test_lens"]).toEqual([{ key: "only-test", description: "Only in test_lens.", content: "Test only." }]);

    await createOntology(app, "skill_copy");
    const imported = await inject("POST", `${modelPrefix("skill_copy")}/import`, exported);
    expect(imported.statusCode, JSON.stringify(imported.body)).toBe(201);
    const reExported = (await inject("GET", `${modelPrefix("skill_copy")}/export`)).body as { lenses: Row[] };
    expect(Object.fromEntries(reExported.lenses.map((lens) => [lens.key, lens.skills]))).toEqual(carried);
  });

  it("an older payload without skills imports, with no skills", async () => {
    const exported = (await inject("GET", `${MODEL}/export`)).body as { lenses: Row[] };
    for (const lens of exported.lenses) delete lens.skills;
    await createOntology(app, "skill_less");
    const imported = await inject("POST", `${modelPrefix("skill_less")}/import`, exported);
    expect(imported.statusCode, JSON.stringify(imported.body)).toBe(201);
    expect(await listed("hr_view", "skill_less")).toEqual([]);
  });

  it("an import with a duplicate or invalid skill is refused, every violation named; nothing is written", async () => {
    const exported = (await inject("GET", `${MODEL}/export`)).body as { lenses: Row[] };
    const hrView = exported.lenses.find((lens) => lens.key === "hr_view")!;
    hrView.skills = [
      { key: "guide", description: "One.", content: "One." },
      { key: "guide", description: "Two.", content: "Two." },
      { key: "Bad_Key", description: "Bad.", content: "Bad." },
    ];
    await createOntology(app, "skill_refused");
    const res = await inject("POST", `${modelPrefix("skill_refused")}/import`, exported);
    expect(res.statusCode).toBe(422);
    expect((((res.body as Row).error as Row).details as Row).errors).toEqual([
      "Import error: duplicate runtime skill 'guide' in lens 'hr_view'",
      expect.stringMatching(/^Import error: Invalid runtime skill key 'Bad_Key'/),
    ]);
    const after = (await inject("GET", `${modelPrefix("skill_refused")}/export`)).body as Row;
    expect([after.entityTypes, after.lenses]).toEqual([[], []]);
  });
});
