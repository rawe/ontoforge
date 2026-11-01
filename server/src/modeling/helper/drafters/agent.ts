/**
 * The agent drafter: fills the open agent editor's draft. A proposal is
 * checked as a save would check it — the agent config shape and the
 * grantable tool names (`service.checkAgentTools`) — and, beyond a save, a
 * tool this deployment cannot run is refused. It writes nothing.
 */

import { z } from "zod";

import { NotFoundError, ValidationError } from "../../../core/exceptions.js";
import { supportsKeywordRanking } from "../../../core/ports.js";
import { unavailableTools } from "../../../runtime/assistants/agents/runtime.js";
import { VALID_AGENT_TOOLS, VALID_AGENT_TOOLS_CSV } from "../../../runtime/toolNames.js";
import * as service from "../../service.js";
import { parsed, type Drafter } from "../drafter.js";

type Row = Record<string, unknown>;

/** The agent editor's values; `tools` null grants every tool. */
export const AgentFields = z
  .object({
    name: z.string(),
    description: z.string(),
    systemPrompt: z.string(),
    tools: z.array(z.string()).nullable(),
  })
  .strict();
export type AgentFields = z.infer<typeof AgentFields>;

const shown = (text: string) => (text === "" ? "(empty)" : text);

const list = (names: readonly string[]) => names.join(", ");

/** The grantable agent tools this server cannot run. */
async function lackingTools(): Promise<string[]> {
  const keyword = await supportsKeywordRanking();
  return unavailableTools([...VALID_AGENT_TOOLS], { supportsKeywordRanking: () => keyword });
}

/** The guide, for a server that cannot run `lacking`. */
export function agentGuide(lacking: readonly string[]): string {
  return (
    "Fill the open agent editor's draft (the Agent draft block) with fill_draft, only when the person asks " +
    "you to draft, write or change that agent. First read what the agent's lens shows, so its instructions " +
    "and tools fit. Pass only the fields you change: name — the agent's name, not empty; description — what " +
    "the agent is for, shown to the people who chat with it; systemPrompt — the agent's instructions, to " +
    "which the schema its lens shows is appended when it runs; tools — null grants every tool, otherwise a " +
    `non-empty list of: ${VALID_AGENT_TOOLS_CSV}.` +
    (lacking.length === 0 ? "" : ` This server cannot run ${list(lacking)}: never grant them.`)
  );
}

export const agentDrafter: Drafter<AgentFields> = {
  kind: "agent",
  label: "Agent draft",
  fields: AgentFields,
  show: (fields) => [
    `name: ${shown(fields.name)}`,
    `description: ${shown(fields.description)}`,
    `tools: ${fields.tools === null ? "all tools" : shown(fields.tools.join(", "))}`,
    "system prompt:",
    shown(fields.systemPrompt),
  ],
  guide: async () => agentGuide(await lackingTools()),
  fill: async (draft, proposed, store) => {
    const values = parsed(AgentFields.partial(), proposed);
    const fields: Row = {};
    if (values.name !== undefined) {
      if (values.name.trim() === "") throw new ValidationError("name: an agent needs a name; leave name out to keep it.");
      fields.name = values.name;
    }
    if (values.description !== undefined) fields.description = values.description;
    if (values.systemPrompt !== undefined) fields.systemPrompt = values.systemPrompt;
    if (values.tools === null) fields.tools = null;
    else if (values.tools !== undefined) {
      if (values.tools.length === 0) throw new ValidationError("tools: grant at least one tool, or null for every tool.");
      service.checkAgentTools(values.tools);
      const lacking = await lackingTools();
      const gated = values.tools.filter((tool) => lacking.includes(tool));
      if (gated.length > 0) throw new ValidationError(`This server cannot run ${list(gated)}; grant other tools.`);
      fields.tools = [...new Set(values.tools)];
    }
    if (Object.keys(fields).length === 0) {
      throw new ValidationError("Propose at least one of name, description, systemPrompt or tools.");
    }
    const lens = draft.target.kind === "agent" ? draft.target.lens : "";
    if (!(await store.getLensByKey(lens))) throw new NotFoundError(`Lens '${lens}' not found`);
    return fields;
  },
};
