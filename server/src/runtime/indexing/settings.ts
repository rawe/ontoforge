/**
 * Search settings: the ontology's keyword language set and which managed
 * indices are switched off — one record per ontology, edited in modeling.
 *
 * Every change reconciles the generations: a new language set yields new
 * keyword generations for every index (no embedding calls), switching a
 * managed index off retires its generations, switching it on builds them
 * anew. The ready generations keep serving until their successors are
 * finished.
 */

import { ValidationError } from "../../core/exceptions.js";
import type { KeywordLanguage, KeywordLanguageSet } from "../../core/keywordLanguage.js";
import type { SearchIndexStore, SearchSettings } from "../../core/ports.js";
import { disabledDefaultsOf, disabledIndexKeys } from "../../core/searchPipeline.js";
import { reconcileSearchGenerations } from "./generations.js";

/** The settings as the interfaces speak them. */
export interface SearchSettingsView {
  keywordLanguages: KeywordLanguage[];
  /** The managed indices switched off, in key order. */
  disabledIndices: string[];
}

/** A change of the settings; an absent field stays as it is. */
export interface SearchSettingsChange {
  keywordLanguages?: KeywordLanguageSet | undefined;
  /** Exactly these managed indices are off afterwards, every other on. */
  disabledIndices?: readonly string[] | undefined;
}

function viewOf(settings: SearchSettings): SearchSettingsView {
  return {
    keywordLanguages: [...settings.keywordLanguages],
    disabledIndices: [...disabledIndexKeys(settings)].sort(),
  };
}

export async function readSearchSettings(store: SearchIndexStore): Promise<SearchSettingsView> {
  return viewOf(await store.getSearchSettings());
}

/**
 * Change the settings, then reconcile the generations. A switched-off key
 * that names no managed index fails validation (`disabledIndices.<i>`)
 * before anything is written. Returns the settings now in force.
 */
export async function updateSearchSettings(
  store: SearchIndexStore,
  change: SearchSettingsChange,
): Promise<SearchSettingsView> {
  const current = await store.getSearchSettings();
  const next: SearchSettings = {
    keywordLanguages: change.keywordLanguages ?? current.keywordLanguages,
    disabledDefaults:
      change.disabledIndices === undefined
        ? current.disabledDefaults
        : await managedSwitches(store, change.disabledIndices),
  };
  const stored = await store.setSearchSettings(next);
  await reconcileSearchGenerations(store.ontologyKey);
  return viewOf(stored);
}

/** The stored form of switching exactly `keys` off; every key must name a
 * managed index. */
async function managedSwitches(
  store: SearchIndexStore,
  keys: readonly string[],
): Promise<Record<string, true>> {
  const managed = new Set(
    (await store.listIndices()).filter((index) => index.kind !== "custom").map((index) => index.key),
  );
  const fields: Record<string, string> = {};
  keys.forEach((key, i) => {
    if (!managed.has(key)) fields[`disabledIndices.${i}`] = `'${key}' is not a managed search index`;
  });
  if (Object.keys(fields).length > 0) {
    throw new ValidationError(Object.values(fields).join("; "), { fields });
  }
  return disabledDefaultsOf(keys);
}
