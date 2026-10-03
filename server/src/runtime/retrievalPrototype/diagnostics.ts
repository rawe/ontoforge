import type { ResultItem, Retrieval, ResponseContext } from './search.js';
import type { Row } from './snapshot.js';

/** Independent transport budget; diagnostic truncation never changes retrieval or response evidence. */
export const TRACE_CHARACTERS = 2_000_000;

function fieldsWithin(fields: Row, characters: number, count = 12): Row {
  return Object.fromEntries(Object.entries(fields).slice(0, count).map(([key, value]) =>
    [key, typeof value === 'string' ? value.slice(0, characters) : value]));
}

export function diagnosticResults(retrieval: Retrieval, context: ResponseContext) {
  let results = retrieval.results.map(bucket => ({
    ...bucket,
    omitted: context.results.find(value => value.entityTypeKey === bucket.entityTypeKey)?.omitted ?? 0,
  }));
  const originalCharacters = JSON.stringify(results).length;
  let truncated = false;
  if (originalCharacters > TRACE_CHARACTERS) {
    truncated = true;
    const slim = (item: ResultItem, minimal: boolean) => ({
      ...item,
      fields: fieldsWithin(item.fields, minimal ? 64 : 160, minimal ? 2 : 12),
      relations: minimal ? [] : item.relations.slice(0, 8),
      sources: minimal ? [] : item.sources.slice(0, 8),
      traceTruncation: {
        fieldsShortened: true,
        relationDetailsOmitted: minimal ? item.relations.length : Math.max(0, item.relations.length - 8),
        sourceDetailsOmitted: minimal ? item.sources.length : Math.max(0, item.sources.length - 8),
      },
    });
    results = results.map(bucket => ({ ...bucket, items: bucket.items.map(item => slim(item, false)) }));
    if (JSON.stringify(results).length > TRACE_CHARACTERS) {
      // Preserve every candidate ID and final score even when detail text is exceptionally large.
      results = retrieval.results.map(bucket => ({
        ...bucket,
        omitted: context.results.find(value => value.entityTypeKey === bucket.entityTypeKey)?.omitted ?? 0,
        items: bucket.items.map(item => slim(item, true)),
      }));
    }
  }
  return {
    results,
    trace: {
      budgetCharacters: TRACE_CHARACTERS,
      characters: JSON.stringify(results).length,
      originalCharacters,
      truncated,
      completeCandidateIds: true,
    },
    limitations: truncated
      ? ['Trace detail text was truncated to its separate diagnostic budget. All candidate IDs and final scores are preserved; retrieval and response evidence are unchanged.']
      : [],
  };
}
