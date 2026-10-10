/**
 * Transfer format 6.0 → 7.0: each lens's `aiAgents` and `retrieverAgents`
 * move under `assistants`, as `agents` and `retrievers`. The entries'
 * portable form is the same in both versions, so they are checked with
 * the current entry schemas — at their 6.0 paths.
 */

import { z } from "zod";

import { ExportAiAgent, ExportRetrieverAgent } from "../schemas.js";
import { readFields, type Upgrader } from "./upgrader.js";

/** What this upgrader reads of a 6.0 payload. */
const Payload6 = z.looseObject({
  lenses: z.array(
    z.looseObject({
      aiAgents: z.array(ExportAiAgent).default([]),
      retrieverAgents: z.array(ExportRetrieverAgent).optional(),
    }),
  ),
});

export const upgrade6to7: Upgrader = (raw) => {
  const payload = readFields(Payload6, raw);
  return {
    payload: {
      ...payload,
      formatVersion: "7.0",
      lenses: payload.lenses.map(({ aiAgents, retrieverAgents, ...lens }) => ({
        ...lens,
        // An adapter without search indices exported no retriever agents.
        assistants: retrieverAgents === undefined
          ? { agents: aiAgents }
          : { agents: aiAgents, retrievers: retrieverAgents },
      })),
    },
    retrieverWarnings: new Map(),
  };
};
