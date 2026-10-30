/**
 * Transfer format 7.0 → 8.0: a saved query's `search` step is an entity
 * search. Each lens's saved queries are converted
 * (`core/legacySearchStep.ts`); one that cannot be converted is left out
 * and named beside the payload.
 */

import { z } from "zod";

import { convertLegacySearchSteps } from "../../core/legacySearchStep.js";
import { readFields, type LeftOutSavedQuery, type Upgrader } from "./upgrader.js";

/** What this upgrader reads of a 7.0 payload. */
const Payload7 = z.looseObject({
  lenses: z.array(
    z.looseObject({
      key: z.string(),
      savedQueries: z.array(z.looseObject({ key: z.string(), steps: z.array(z.looseObject({})) })).optional(),
    }),
  ),
});

export const upgrade7to8: Upgrader = (raw) => {
  const payload = readFields(Payload7, raw);
  const leftOutSavedQueries: LeftOutSavedQuery[] = [];
  return {
    payload: {
      ...payload,
      formatVersion: "8.0",
      lenses: payload.lenses.map((lens) =>
        lens.savedQueries === undefined
          ? lens
          : {
              ...lens,
              savedQueries: lens.savedQueries.flatMap((query) => {
                const steps = convertLegacySearchSteps(query.steps);
                if (steps === null) {
                  leftOutSavedQueries.push({ lens: lens.key, key: query.key });
                  return [];
                }
                return [{ ...query, steps }];
              }),
            },
      ),
    },
    retrieverWarnings: new Map(),
    leftOutSavedQueries,
  };
};
