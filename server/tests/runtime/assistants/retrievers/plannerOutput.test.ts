import { describe, it, expect } from 'vitest';
import { parsePlannerOutput } from '../../../../src/runtime/assistants/retrievers/plannerOutput.js';

describe('visible planner output parsing', () => {
  it('accepts plain JSON and a single whole JSON fence', () => {
    const plan = { subQueries: [], unsupportedReason: "No records." };
    expect(parsePlannerOutput(JSON.stringify(plan))).toEqual(plan);
    expect(parsePlannerOutput('```json\n' + JSON.stringify(plan) + '\n```')).toEqual(plan);
  });
  it('rejects prose extraction, multiple fences, and partial JSON', () => {
    expect(() => parsePlannerOutput('Here is the plan: {"subQueries":[]}')).toThrow('invalid JSON');
    expect(() => parsePlannerOutput('```json\n{}\n```\n```json\n{}\n```')).toThrow('invalid JSON');
    expect(() => parsePlannerOutput('{"subQueries":[', 'length')).toThrow('token limit');
  });
  it('distinguishes empty visible output from output-limit exhaustion', () => {
    expect(() => parsePlannerOutput('')).toThrow('empty plan');
    expect(() => parsePlannerOutput(' ', 'length')).toThrow('output limit');
  });
});
