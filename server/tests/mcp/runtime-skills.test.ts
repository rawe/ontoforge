/**
 * Runtime skills on the runtime MCP server (`mcp/runtimeSkills.ts`): the
 * lens's records listed, fetched by URI and read back with the digest and
 * size of their entry, the SKILL.md generated from key, description and
 * content. Only the mount's own lens is reachable: a key another lens holds
 * is not served, nor a built-in skill. A lens without skills lists none,
 * every role level reads them, and a ruleset mount serves the same skills
 * once its ruleset exists.
 */

import { createHash } from "node:crypto";

import type { Client } from "@modelcontextprotocol/client";
import { SKILLS_EXTENSION_ID, SkillsClient } from "@modelcontextprotocol/client/ext/skills";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectServer } from "../mcpClient.js";
import type { WriteAccess } from "../../src/core/ports.js";
import type { RuntimeSkill } from "../../src/core/runtimeSkill.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import type { Binding } from "../../src/runtime/writeAccess.js";
import { createMockRuntimeStore, makeFullSchema, type MockRuntimeStore } from "../runtime/helpers.js";

const holder: { store: MockRuntimeStore } = { store: createMockRuntimeStore() };

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: async () => ({}),
  getRuntimeStore: async () => holder.store,
  getSearchIndexStore: async () => holder.store.indices,
}));

const { createRuntimeMcpServer } = await import("../../src/mcp/runtime.js");
const { runtimeSkillMarkdown } = await import("../../src/mcp/runtimeSkills.js");

const GUIDE: RuntimeSkill = {
  key: "find-people",
  description: 'Find people: by "name" or role.\nUse it before list_entities.',
  content: "# Find people\n\nSearch first, then read.\n",
};
const NUMBER: RuntimeSkill = { key: "123", description: "true", content: "Numbers stay text." };
const ELSEWHERE: RuntimeSkill = { key: "only-elsewhere", description: "Another lens's skill.", content: "Not here." };

/** Lens `all` holds GUIDE and NUMBER, lens `other` a namesake of GUIDE and
 * ELSEWHERE, lens `empty` nothing. */
const SKILLS: Record<string, RuntimeSkill[]> = {
  all: [NUMBER, GUIDE],
  other: [{ ...GUIDE, description: "The other lens's namesake.", content: "Other body." }, ELSEWHERE],
  empty: [],
};

let client: Client | undefined;

async function connect(lensKey: string, binding?: Binding, role: WriteAccess = "full"): Promise<SkillsClient> {
  client = await connectServer("runtime-skills-tests", () => createRuntimeMcpServer("test_ont", lensKey, binding, role));
  return new SkillsClient(client);
}

beforeEach(() => {
  holder.store = createMockRuntimeStore();
  invalidateLoadedSchemaCache();
  holder.store.getFullSchemaWithLensInclusions.mockImplementation(async (lensKey: string) =>
    lensKey in SKILLS ? makeFullSchema({ lensKey }) : null,
  );
  holder.store.getRuntimeSkills.mockImplementation(async (lensKey: string) =>
    (SKILLS[lensKey] ?? []).map((skill) => ({ ...skill })),
  );
  holder.store.rulesetStore.get.mockImplementation(async (key: string) =>
    key === "agent-a" ? { key, anchor: null, anchorFound: false, writeAccess: "none" } : null,
  );
});

afterEach(async () => {
  await client?.close();
  client = undefined;
});

describe("the SKILL.md of a runtime skill", () => {
  it("carries the key as name, the description, and the content as its body", () => {
    expect(runtimeSkillMarkdown(GUIDE)).toBe(
      '---\nname: "find-people"\ndescription: "Find people: by \\"name\\" or role.\\nUse it before list_entities."\n---\n' +
        "# Find people\n\nSearch first, then read.\n",
    );
  });
});

describe("a runtime server", () => {
  it("declares the skills extension, advertises no list changes and lists the lens's skills", async () => {
    const skills = await connect("all");
    expect(skills.supported).toBe(true);
    const capabilities = client!.getServerCapabilities()!;
    expect(capabilities.extensions?.[SKILLS_EXTENSION_ID]).toBeDefined();
    expect(capabilities.resources?.listChanged).toBe(false);
    expect(capabilities.tools?.listChanged).toBe(false);
    const { skills: listed } = await skills.list();
    expect(listed.map((skill) => skill.uri)).toEqual(["skill://123/SKILL.md", "skill://find-people/SKILL.md"]);
    // The frontmatter reads back exactly as stored: quotes, newline, a numeric key.
    expect(listed.map((skill) => skill.frontmatter)).toEqual([
      { name: "123", description: "true" },
      { name: "find-people", description: GUIDE.description },
    ]);
  });

  it("gets a skill by its SKILL.md URI and reads the file its entry describes", async () => {
    const skills = await connect("all");
    const uri = "skill://find-people/SKILL.md";
    const { skill } = await skills.get(uri);
    expect(skill.uri).toBe(uri);
    const file = await skills.read(skill);
    expect(file.verified).toBe(true);
    expect(file.body).toBe(GUIDE.content);
    const resource = skill.resources.find((entry) => entry.uri === uri)!;
    expect(file.bytes.byteLength).toBe(resource.size);
    expect(`sha256:${createHash("sha256").update(file.bytes).digest("hex")}`).toBe(resource.digest);
    const read = await client!.readResource({ uri });
    expect(read.contents[0]).toMatchObject({ uri, mimeType: "text/markdown", text: runtimeSkillMarkdown(GUIDE) });
  });

  it("serves its own namesake of another lens's skill and never another lens's skill", async () => {
    const skills = await connect("other");
    const { skill } = await skills.get("skill://find-people/SKILL.md");
    expect(skill.frontmatter.description).toBe("The other lens's namesake.");
    expect((await skills.read(skill)).body).toBe("Other body.");

    const own = await connect("all");
    await expect(own.get("skill://only-elsewhere/SKILL.md")).rejects.toThrow(/No skill is served/);
    await expect(client!.readResource({ uri: "skill://only-elsewhere/SKILL.md" })).rejects.toThrow(/not found/i);
    // Nor a built-in skill of the modeling mount.
    await expect(own.get("skill://property-or-relation/SKILL.md")).rejects.toThrow(/No skill is served/);
    await expect(client!.readResource({ uri: "skill://property-or-relation/SKILL.md" })).rejects.toThrow(/not found/i);
  });

  it("lists no skills for a lens without any", async () => {
    const skills = await connect("empty");
    expect(skills.supported).toBe(true);
    expect((await skills.list()).skills).toEqual([]);
  });

  it("serves the skills at the Reader level", async () => {
    const skills = await connect("all", undefined, "none");
    expect((await skills.list()).skills).toHaveLength(2);
    expect((await skills.read((await skills.get("skill://123/SKILL.md")).skill)).body).toBe(NUMBER.content);
  });

  it("serves the same skills on a ruleset mount of the lens", async () => {
    const skills = await connect("all", { rulesetKey: "agent-a", writeAccess: "none" }, "none");
    expect((await skills.list()).skills.map((skill) => skill.frontmatter.name)).toEqual(["123", "find-people"]);
    expect(holder.store.rulesetStore.get).toHaveBeenCalledWith("agent-a");
  });

  it("serves nothing on a ruleset mount whose ruleset does not exist, nor for an unknown lens", async () => {
    const skills = await connect("all", { rulesetKey: "ghost", writeAccess: "full" });
    await expect(skills.list()).rejects.toThrow(/Ruleset 'ghost' not found/);
    const unknown = await connect("ghost");
    await expect(unknown.list()).rejects.toThrow(/Lens 'ghost' not found/);
  });
});
