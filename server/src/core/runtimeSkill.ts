/**
 * A runtime skill: a lens-owned design record — key, description and
 * Markdown content — that the lens's runtime MCP mount publishes as a skill
 * (`docs/capabilities/runtime-skills.md`). The rules here are the ones every
 * entrance shares: REST, the modeling MCP tools and import.
 *
 * Pure — no storage, no I/O.
 */

import { MAX_KEY_LENGTH, RUNTIME_SKILL_KEY_PATTERN } from "./schemas.js";

export interface RuntimeSkill {
  key: string;
  description: string;
  content: string;
}

/** The skill description a client shows, in characters: the Agent Skill
 * rule, which MCP clients enforce on the wire. */
export const MAX_RUNTIME_SKILL_DESCRIPTION_LENGTH = 1024;

/** Characters as the Agent Skill rule counts them: code points. */
function characters(text: string): number {
  return [...text].length;
}

/** Every rule the key breaks, as messages naming the key. */
export function runtimeSkillKeyErrors(key: string): string[] {
  if (key.length === 0 || key.length > MAX_KEY_LENGTH || !RUNTIME_SKILL_KEY_PATTERN.test(key)) {
    return [
      `Invalid runtime skill key '${key}'. Must be 1 to ${MAX_KEY_LENGTH} lowercase letters, digits ` +
        `and single hyphens (pattern ${RUNTIME_SKILL_KEY_PATTERN.source})`,
    ];
  }
  return [];
}

/** Every rule the description and content break. */
export function runtimeSkillFieldErrors(description: string, content: string): string[] {
  const errors: string[] = [];
  const length = characters(description);
  if (length === 0 || length > MAX_RUNTIME_SKILL_DESCRIPTION_LENGTH) {
    errors.push(`description must be 1 to ${MAX_RUNTIME_SKILL_DESCRIPTION_LENGTH} characters`);
  }
  if (content.length === 0) {
    errors.push("content must not be empty");
  }
  return errors;
}
