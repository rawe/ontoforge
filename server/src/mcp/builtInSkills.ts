/**
 * The built-in skills: modeling guides that ship with the server and are
 * served on the modeling mount through the MCP skills extension
 * (`docs/interfaces/mcp.md#skills`). Each is a `SKILL.md` held in a module
 * of `./skills/`, so the compiled server carries it without a copy step;
 * a guide is added with one line below. The catalog is built once, at
 * import: a guide that breaks the skill format fails the boot.
 */

import { memorySkillFiles, SkillsExtension } from "@modelcontextprotocol/server/ext/skills";

import propertyOrRelation from "./skills/propertyOrRelation.js";

const files: Record<string, string> = {
  "property-or-relation/SKILL.md": propertyOrRelation,
};

export const builtInSkills = await SkillsExtension.load(memorySkillFiles(files), { strict: true });
