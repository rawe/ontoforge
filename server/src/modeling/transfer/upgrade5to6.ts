/**
 * Transfer format 5.0 → 6.0. A 5.0 payload differs in four ways:
 *
 * - one `textSearchLanguage` in place of `keywordLanguages` — the language
 *   alone becomes the set;
 * - no search indices — a `searchIndices` field and each lens's
 *   `indexInclusions` are dropped unread, so each scoped lens includes
 *   the managed indices import includes on its own;
 * - no name properties — each entity type's is derived by the legacy
 *   fallback (`core/legacyNameProperty.ts`), a type without a string
 *   property getting a new one;
 * - each lens's retrievers of configuration version 1 under `retrievers`
 *   in place of `retrieverAgents` — each converted
 *   (`core/legacyRetrieverConfig.ts`), a key with `-` renamed unique in
 *   its lens; the conversion's warnings and the rename travel beside the
 *   payload.
 *
 * Any 6.0 field the payload carries is ignored unchecked.
 */

import { z } from "zod";

import { ValidationError } from "../../core/exceptions.js";
import { KeywordLanguage } from "../../core/keywordLanguage.js";
import { legacyNameProperty } from "../../core/legacyNameProperty.js";
import {
  convertLegacyRetrieverConfig,
  LEGACY_RETRIEVER_CONFIG_VERSION,
  legacyRetrieverKey,
} from "../../core/legacyRetrieverConfig.js";
import { RETRIEVER_AGENT_CONFIG_VERSION } from "../../core/retrieverAgent.js";
import { NAME_PROPERTY_DATA_TYPE, namePropertyDisplayName } from "../../core/schemas.js";
import { ExportRetrieverAgent } from "../schemas.js";
import {
  readFields,
  retrieverWarningKey,
  type RetrieverWarnings,
  type Upgrader,
} from "./upgrader.js";

/** What this upgrader reads of a 5.0 payload. */
const Payload5 = z.looseObject({
  textSearchLanguage: KeywordLanguage,
  entityTypes: z
    .array(
      z.looseObject({
        key: z.string(),
        properties: z.array(z.looseObject({ key: z.string(), dataType: z.string() })).default([]),
      }),
    )
    .default([]),
  lenses: z.array(
    z.looseObject({
      key: z.string(),
      retrievers: z.array(ExportRetrieverAgent).default([]),
    }),
  ),
});

export const upgrade5to6: Upgrader = (raw) => {
  if (raw.textSearchLanguage === undefined) {
    throw new ValidationError("The payload carries no textSearchLanguage", {
      fields: { textSearchLanguage: "Required" },
    });
  }
  const payload = readFields(Payload5, raw);

  // The data type of a payload property, by entity type and key — what
  // the retriever conversion tells document fields by.
  const dataTypeOf = (entityType: string, field: string): string | undefined =>
    payload.entityTypes
      .find((et) => et.key === entityType)
      ?.properties.find((p) => p.key === field)?.dataType;

  const issues: { path: string; message: string }[] = [];
  const retrieverWarnings: RetrieverWarnings = new Map();
  const lenses = payload.lenses.map((lens, i) => {
    const { retrievers } = lens;
    const taken = new Set(retrievers.map((retriever) => retriever.key));
    const retrieverAgents = retrievers.map((retriever, j) => {
      const renamed = legacyRetrieverKey(retriever.key, taken);
      taken.add(renamed.key);
      const converted = retriever.configVersion === LEGACY_RETRIEVER_CONFIG_VERSION
        ? convertLegacyRetrieverConfig(retriever.config, dataTypeOf)
        : null;
      if (converted === null) {
        issues.push({
          path: `/lenses/${i}/retrievers/${j}`,
          message: `No valid configuration of version ${LEGACY_RETRIEVER_CONFIG_VERSION}`,
        });
        return retriever;
      }
      const warnings = renamed.warning === null ? converted.warnings : [...converted.warnings, renamed.warning];
      retrieverWarnings.set(retrieverWarningKey(lens.key, renamed.key), warnings);
      return {
        ...retriever,
        key: renamed.key,
        configVersion: RETRIEVER_AGENT_CONFIG_VERSION,
        config: converted.config,
      };
    });
    const upgraded: Record<string, unknown> = { ...lens, retrieverAgents };
    delete upgraded.retrievers;
    delete upgraded.indexInclusions;
    return upgraded;
  });
  if (issues.length > 0) {
    throw new ValidationError("Request validation failed", { errors: issues });
  }

  const upgraded: Record<string, unknown> = { ...payload };
  delete upgraded.textSearchLanguage;
  delete upgraded.searchIndices;
  return {
    payload: {
      ...upgraded,
      formatVersion: "6.0",
      keywordLanguages: [payload.textSearchLanguage],
      entityTypes: payload.entityTypes.map((et) => {
        const { key, create } = legacyNameProperty(et.properties);
        const properties = create
          ? [
              ...et.properties,
              {
                key,
                displayName: namePropertyDisplayName(key),
                description: null,
                dataType: NAME_PROPERTY_DATA_TYPE,
                required: false,
                defaultValue: null,
              },
            ]
          : et.properties;
        return { ...et, nameProperty: key, properties };
      }),
      lenses,
    },
    retrieverWarnings,
  };
};
