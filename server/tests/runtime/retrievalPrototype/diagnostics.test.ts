import { describe, it, expect } from 'vitest';
import { diagnosticResults, TRACE_CHARACTERS } from '../../../src/runtime/retrievalPrototype/diagnostics.js';
import { boundContext, type Retrieval } from '../../../src/runtime/retrievalPrototype/search.js';

function retrieval(count: number, detailCharacters: number): Retrieval {
  return {
    results: [{
      entityTypeKey: 'record', totalHardMatches: count, totalAccepted: count, omitted: 0,
      items: Array.from({ length: count }, (_, index) => ({
        id: 'r' + index, score: 0.5,
        fields: { name: 'Record ' + index, description: 'x'.repeat(detailCharacters) },
        relations: [], sources: [{ kind: 'source', detail: 'x'.repeat(detailCharacters) }],
      })),
    }],
    limitations: [],
  };
}

describe('independent trace budget', () => {
  it('keeps full diagnostics for ordinary results and exposes response-context omissions separately', () => {
    const original = retrieval(12, 100);
    const context = boundContext(original);
    const diagnostic = diagnosticResults(original, context);
    expect(diagnostic.trace.truncated).toBe(false);
    expect(diagnostic.results[0]!.items).toEqual(original.results[0]!.items);
    expect(diagnostic.results[0]!.omitted).toBe(context.results[0]!.omitted);
  });
  it('preserves all 1000 candidate IDs and scores while visibly truncating excessive trace details', () => {
    const original = retrieval(1000, 3000);
    const context = boundContext(original);
    const diagnostic = diagnosticResults(original, context);
    expect(diagnostic.trace.truncated).toBe(true);
    expect(diagnostic.trace.characters).toBeLessThanOrEqual(TRACE_CHARACTERS);
    expect(diagnostic.results[0]!.items.map(item => item.id)).toEqual(original.results[0]!.items.map(item => item.id));
    expect(diagnostic.results[0]!.items.every(item => item.score === 0.5)).toBe(true);
    expect(diagnostic.limitations.join()).toContain('unchanged');
    expect(original.results[0]!.items[0]!.fields.description).toHaveLength(3000);
  });
  it('describes context omissions as unassessed candidates, not proven additional recommendations', () => {
    const context = boundContext(retrieval(20, 700));
    expect(context.limitations.join()).toContain('technically selected candidates');
    expect(context.limitations.join()).toContain('relevance was not assessed');
  });
});
