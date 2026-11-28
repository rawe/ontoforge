/**
 * The runtime skills of one lens on its runtime MCP mounts, through the MCP
 * skills extension (`docs/capabilities/runtime-skills.md`). Each record is
 * one skill: `skill://<key>/SKILL.md`, its frontmatter `name` the key and
 * `description` the record's, its body the record's content; the wire
 * metadata (size, digest) is derived from that text on every request.
 *
 * The catalog is read through the caller's `read`, which is bound to the
 * mount's ontology and lens, so a request can only ever reach that lens's
 * records: a key the lens does not hold is not served, whatever another
 * lens or ontology holds under it.
 */

import { skillEntry, SkillsExtension, type SkillSource } from "@modelcontextprotocol/server/ext/skills";

import type { RuntimeSkill } from "../core/runtimeSkill.js";

/** A string as double-quoted YAML (JSON is valid YAML), with the two
 * Unicode line separators JSON leaves literal escaped too, so the value
 * stays on its line whatever text it holds. */
function quoted(text: string): string {
  return JSON.stringify(text).replace(/[\u2028\u2029]/g, (c) => (c === "\u2028" ? "\\u2028" : "\\u2029"));
}

/** The `SKILL.md` of a runtime skill. Name and description are quoted, so
 * any description text and a key such as `123` or `true` stay strings. */
export function runtimeSkillMarkdown(skill: RuntimeSkill): string {
  return `---\nname: ${quoted(skill.key)}\ndescription: ${quoted(skill.description)}\n---\n` + skill.content;
}

/** The key a `SKILL.md` URI names; undefined for any other URI. */
function keyOf(uri: string): string | undefined {
  return /^skill:\/\/([^/]+)\/SKILL\.md$/.exec(uri)?.[1];
}

/** A skills extension serving the skills `read` yields, read once per
 * request that needs them. */
export function runtimeSkillsExtension(read: () => Promise<Record<string, RuntimeSkill>>): SkillsExtension {
  const entry = (skill: RuntimeSkill) => skillEntry(skill.key, { "SKILL.md": runtimeSkillMarkdown(skill) });
  const find = async (uri: string): Promise<RuntimeSkill | undefined> => {
    const key = keyOf(uri);
    if (key === undefined) return undefined;
    const skills = await read();
    return Object.hasOwn(skills, key) ? skills[key] : undefined;
  };
  const source: SkillSource = {
    async list() {
      return { skills: await Promise.all(Object.values(await read()).map(entry)) };
    },
    async get(uri) {
      const skill = await find(uri);
      return skill === undefined ? undefined : entry(skill);
    },
    async read(uri) {
      const skill = await find(uri);
      return skill === undefined ? undefined : { text: runtimeSkillMarkdown(skill), mimeType: "text/markdown" };
    },
  };
  return new SkillsExtension({ source });
}
