import { PLANNER_RESPONSE_FORMAT } from '../../../src/runtime/retrieverAgents/plan.js';
import { describe, it, expect, vi } from 'vitest';
import type { ChatOpenAI } from '@langchain/openai';
import { createAiModel } from '../../../src/core/ai.js';
import { parsePlannerOutput } from '../../../src/runtime/retrieverAgents/plannerOutput.js';

function transport(model: unknown, fetchFn: typeof fetch) {
  (model as unknown as { completions: { clientConfig: { fetch?: typeof fetch } } }).completions.clientConfig.fetch = fetchFn;
}

function completion(content: string) {
  return new Response(JSON.stringify({
    id: 'fake-completion', object: 'chat.completion', created: 0, model: 'fake',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }), { headers: { 'content-type': 'application/json' } });
}

describe('planner JSON mode at the real SDK transport boundary', () => {
  it('transports the strict plan schema with every object closed and every property required', async () => {
    const requests: Record<string, unknown>[] = [];
    const model = createAiModel('ollama', 'fake', 'http://fake.invalid', { maxRetries: 0 }) as ChatOpenAI;
    const planner = model.withConfig({ response_format: PLANNER_RESPONSE_FORMAT });
    const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init!.body)));
      return completion('{"subQueries":[],"unsupportedReason":"No records."}');
    });
    transport(planner, fetchFn as typeof fetch);
    const output = await planner.invoke('Return a retrieval plan.');
    expect(output.content).toBe('{"subQueries":[],"unsupportedReason":"No records."}');
    expect(requests[0]).toHaveProperty('response_format', PLANNER_RESPONSE_FORMAT);
    const inspect = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      const node = value as Record<string, unknown>;
      if (node.type === 'object') {
        expect(node.additionalProperties).toBe(false);
        expect([...(node.required as string[])].sort()).toEqual(Object.keys(node.properties as object).sort());
      }
      for (const child of Object.values(node)) {
        if (Array.isArray(child)) child.forEach(inspect);
        else inspect(child);
      }
    };
    inspect(PLANNER_RESPONSE_FORMAT.json_schema.schema);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('sends json_object for the planner only and keeps the response stream in text mode', async () => {
    const requests: Record<string, unknown>[] = [];
    const model = createAiModel('ollama', 'fake', 'http://fake.invalid', { maxRetries: 0 }) as ChatOpenAI;
    const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      requests.push(body);
      if (!body.stream) return completion('{"subQueries":[]}');
      const chunk = { id: 'fake-chunk', object: 'chat.completion.chunk', created: 0, model: 'fake', choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello' }, finish_reason: null }] };
      const end = { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(end)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    });
    transport(model, fetchFn as typeof fetch);
    const planner = model.withConfig({ response_format: { type: 'json_object' } });
    transport(planner, fetchFn as typeof fetch);
    const output = await planner.invoke('Return one JSON object.');
    expect(output.content).toBe('{"subQueries":[]}');
    const stream = await model.stream('Answer in plain text.');
    let response = '';
    for await (const chunk of stream) response += chunk.content;
    expect(response).toBe('Hello');
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ response_format: { type: 'json_object' } });
    expect(requests[0]).not.toHaveProperty('max_tokens');
    expect(requests[1]).not.toHaveProperty('max_tokens');
    expect(requests[1]).not.toHaveProperty('response_format');
    expect(requests[1]).toHaveProperty('stream', true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('does not conceal provider noncompliance or repair malformed visible content', async () => {
    const model = createAiModel('ollama', 'fake', 'http://fake.invalid', { maxRetries: 0 }) as ChatOpenAI;
    const content = '{"subQueries":[]} (actually final only JSON) {"subQueries":[]}';
    const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(JSON.parse(String(init!.body))).toHaveProperty('response_format', { type: 'json_object' });
      return completion(content);
    });
    transport(model, fetchFn as typeof fetch);
    const planner = model.withConfig({ response_format: { type: 'json_object' } });
    transport(planner, fetchFn as typeof fetch);
    const output = await planner.invoke('Return one JSON object.');
    expect(output.content).toBe(content);
    expect(() => parsePlannerOutput(String(output.content), 'stop')).toThrow('invalid JSON');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
