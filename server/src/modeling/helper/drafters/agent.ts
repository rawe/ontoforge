/**
 * The agent drafter: fills the open agent editor's draft. Its tool checks
 * a proposal as a save would — the agent config shape and the grantable
 * tool names (`service.checkAgentTools`) — and, beyond a save, refuses a
 * tool this deployment cannot run. It writes nothing.
 */

import { z } from "zod";

import type { Tool } from "../../../assistants/index.js";
import { NotFoundError, ValidationError } from "../../../core/exceptions.js";
import { supportsKeywordRanking, type ModelingStore } from "../../../core/ports.js";
import { unavailableTools } from "../../../runtime/assistants/agents/runtime.js";
import { VALID_AGENT_TOOLS, VALID_AGENT_TOOLS_CSV } from "../../../runtime/toolNames.js";
import * as service from "../../service.js";
import { draftProposal, type Draft, type Drafter } from "../drafter.js";
import { expectedError } from "../tools.js";

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

export const FILL_AGENT_DRAFT = "fill_agent_draft";

const shown = (text: string) => (text === "" ? "(empty)" : text);

const list = (names: string[]) => names.join(", ");

/** The draft tool: proposes values for the open agent editor's draft;
 * `lacking` are the grantable tools this deployment cannot run. */
export function fillAgentDraftTool(draft: Draft<AgentFields>, store: ModelingStore, lacking: readonly string[]): Tool<unknown> {
  const lens = draft.target.kind === "agent" ? draft.target.lens : "";
  return {
    name: FILL_AGENT_DRAFT,
    description:
      "Propose new values for the agent in the editor the person has open (the Agent draft block with their " +
      "message). Call it only when they ask you to draft, write or change that agent; first read what the " +
      "agent's lens shows, so its instructions and tools fit. Pass " +
      "only the fields you change. name: the agent's name, not empty. description: what the agent is for, " +
      "shown to the people who chat with it. system_prompt: the agent's instructions; when it runs, the " +
      "schema its lens shows is appended. Grant tools with either all_tools: true (every tool) or tools: a " +
      `non-empty list of: ${VALID_AGENT_TOOLS_CSV}.` +
      (lacking.length === 0 ? "" : ` This server cannot run ${list([...lacking])}: never grant them.`) +
      " Nothing is saved: the person fills the editor from your proposal, reviews it and saves it. Returns " +
      "the proposal {target, sourceVersion, fields}; a refused field returns an error with the reason.",
    input: z.object({
      name: z.string().nullish(),
      description: z.string().nullish(),
      system_prompt: z.string().nullish(),
      all_tools: z.boolean().nullish(),
      tools: z.array(z.string()).nullish(),
    }),
    run: async (args) => {
      const fields: Row = {};
      const name = args.name as string | null | undefined;
      if (name != null) {
        if (name.trim() === "") throw new ValidationError("name: an agent needs a name; leave name out to keep it.");
        fields.name = name;
      }
      if (args.description != null) fields.description = args.description;
      if (args.system_prompt != null) fields.systemPrompt = args.system_prompt;
      const tools = args.tools as string[] | null | undefined;
      if (args.all_tools === true) {
        if (tools != null) throw new ValidationError("Give either all_tools: true or a tools list, not both.");
        fields.tools = null;
      } else if (tools != null) {
        if (tools.length === 0) throw new ValidationError("tools: grant at least one tool, or all_tools: true for every tool.");
        service.checkAgentTools(tools);
        const gated = tools.filter((tool) => lacking.includes(tool));
        if (gated.length > 0) throw new ValidationError(`This server cannot run ${list(gated)}; grant other tools.`);
        fields.tools = [...new Set(tools)];
      }
      if (Object.keys(fields).length === 0) {
        throw new ValidationError("Propose at least one of name, description, system_prompt, all_tools or tools.");
      }
      if (!(await store.getLensByKey(lens))) {
        throw new NotFoundError(`Lens '${lens}' not found`);
      }
      return draftProposal(draft, fields);
    },
    expected: expectedError,
  };
}

/** The grantable agent tools this server cannot run. */
async function lackingTools(): Promise<string[]> {
  const keyword = await supportsKeywordRanking();
  return unavailableTools([...VALID_AGENT_TOOLS], { supportsKeywordRanking: () => keyword });
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
  tools: async (draft, store) => [fillAgentDraftTool(draft, store, await lackingTools())],
};
