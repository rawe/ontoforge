import { describe, it, expect } from 'vitest';
import { modelInputTrace, MODEL_INPUT_TRACE_CHARACTERS } from '../../../src/runtime/retrieverAgents/modelTrace.js';

describe('bounded model input diagnostics', () => {
  it('preserves separate system instructions and human input when within the shared trace budget', () => {
    expect(modelInputTrace('System instructions', '{"question":"hello"}')).toEqual({
      systemPrompt: 'System instructions', input: '{"question":"hello"}', inputTruncated: false,
    });
  });
  it('marks human trace truncation without modifying either original message', () => {
    const system = 's'.repeat(1000);
    const human = 'h'.repeat(MODEL_INPUT_TRACE_CHARACTERS);
    const trace = modelInputTrace(system, human);
    expect(trace.systemPrompt).toBe(system);
    expect(trace.input.length + trace.systemPrompt.length).toBe(MODEL_INPUT_TRACE_CHARACTERS);
    expect(trace.inputTruncated).toBe(true);
    expect(human).toHaveLength(MODEL_INPUT_TRACE_CHARACTERS);
    expect(system).toHaveLength(1000);
  });
});
