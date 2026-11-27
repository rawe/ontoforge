/**
 * The built-in skills (`mcp/builtInSkills.ts`): the modeling server serves
 * them through the MCP skills extension — listed, fetched by URI and read
 * back with the digest and size of their entry — and a runtime server
 * neither declares the extension nor serves them.
 */

import { createHash } from "node:crypto";

import type { Client } from "@modelcontextprotocol/client";
import { SKILLS_EXTENSION_ID, SkillsClient } from "@modelcontextprotocol/client/ext/skills";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { connectServer } from "../mcpClient.js";
import { builtInSkills } from "../../src/mcp/builtInSkills.js";
import { createModelingMcpServer } from "../../src/mcp/modeling.js";
import { createRuntimeMcpServer } from "../../src/mcp/runtime.js";

const SKILL = "skill://property-or-relation/SKILL.md";

let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
});

describe("the modeling server", () => {
  it("declares the skills extension and lists every built-in skill", async () => {
    client = await connectServer("skills-tests", () => createModelingMcpServer("test_ont"));
    const skills = new SkillsClient(client);
    expect(skills.supported).toBe(true);
    const { skills: listed } = await skills.list();
    expect(listed).toEqual(builtInSkills.entries);
    expect(listed.map((skill) => skill.frontmatter.name)).toContain("property-or-relation");
  });

  it("gets a skill by its SKILL.md URI and reads the file its entry describes", async () => {
    client = await connectServer("skills-tests", () => createModelingMcpServer("test_ont"));
    const skills = new SkillsClient(client);
    const { skill } = await skills.get(SKILL);
    expect(skill.uri).toBe(SKILL);
    expect(skill.frontmatter.name).toBe("property-or-relation");

    const file = await skills.read(skill);
    expect(file.verified).toBe(true);
    expect(file.body).toContain("## The property-or-relation checklist");
    const resource = skill.resources.find((entry) => entry.uri === SKILL)!;
    expect(file.bytes.byteLength).toBe(resource.size);
    expect(`sha256:${createHash("sha256").update(file.bytes).digest("hex")}`).toBe(resource.digest);

    // The plain resource read answers the same text.
    const read = await client.readResource({ uri: SKILL });
    expect(read.contents[0]).toMatchObject({ uri: SKILL, text: file.text });
  });
});

describe("a runtime server", () => {
  it("neither declares the skills extension nor serves a built-in skill", async () => {
    client = await connectServer("skills-tests", () => createRuntimeMcpServer("test_ont", "all"));
    const skills = new SkillsClient(client);
    expect(skills.supported).toBe(false);
    expect(client.getServerCapabilities()?.extensions?.[SKILLS_EXTENSION_ID]).toBeUndefined();
    await expect(client.request({ method: "skills/list", params: {} }, z.object({}))).rejects.toThrow(/not found/i);
    await expect(client.readResource({ uri: SKILL })).rejects.toThrow(/not found/i);
  });
});
