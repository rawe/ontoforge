import { PLANNER_RESPONSE_FORMAT } from '../../../src/runtime/retrievalPrototype/plannerFormat.js';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach
} from 'vitest';
const fake=vi.hoisted(()=>({
  invoke:vi.fn(),
  stream:vi.fn(),
  withConfig:vi.fn()
}));
vi.mock('../../../src/config.js',()=>({
  settings:{
    AI_PROVIDER:'fake',
    AI_MODEL:'test',
    AI_BASE_URL:'http://unused'
  }
}));
vi.mock('../../../src/core/ai.js',()=>({
  createAiModel:vi.fn(()=>fake)
}));
vi.mock('../../../src/core/embedding.js',()=>({
  getEmbeddingProvider:()=>null
}));
import {
  chat
} from '../../../src/runtime/retrievalPrototype/runtime.js';
import type {
  RuntimeStore
} from '../../../src/core/ports.js';
import {
  createAiModel
} from '../../../src/core/ai.js';
const props=[{
  key:'name',
  displayName:'Name',
  dataType:'string',
  required:true
}];
const store={
  ontologyKey:'a',
  getFullSchemaWithLensInclusions:async()=>({
    lens:{
      lensId:'l',
      key:'l',
      name:'Lens'
    },
    entityTypes:[{
      key:'thing',
      displayName:'Thing',
      properties:props
    }],
    relationTypes:[],
    entityInclusions:[],
    relationInclusions:[]
  }),
  getAiAgentConfigs:async()=>[],
  getSavedQueries:async()=>[],
  listEntities:async()=>[[{
    _id:'1',
    name:'Alpha'
  }],
  1]
} as unknown as RuntimeStore;
const config={
  buckets:[{
    entityTypeKey:'thing',
    searchFields:['name'],
    answerFields:['name'],
    conditions:[]
  }],
  threshold:.35
};
const plan={
  buckets:[{
    entityTypeKey:'thing',
    all:true,
    semanticQuery:null,
    softConditionIds:[],
    variants:[],
    filters:[]
  }]
};
beforeEach(()=>{
  vi.clearAllMocks();
  fake.withConfig.mockReturnValue({ invoke: fake.invoke });
  fake.invoke.mockResolvedValue({
    content:JSON.stringify(plan),
    usage_metadata:{
      input_tokens:1,
      output_tokens:2
    }
  });
  fake.stream.mockImplementation(async()=>async function*(){
    yield{
      content:'Alpha',
      usage_metadata:{
        input_tokens:1,
        output_tokens:1
      }
    };
    yield{
      content:'.'
    };
  }
  ());
});
describe('fixed LangGraph prototype pipeline',()=>{
  it('emits visible planner diagnostics before a parse failure and does not call the response model', async () => {
    fake.invoke.mockResolvedValue({ content: '{"buckets":[', usage_metadata: { output_tokens: 1800 }, response_metadata: { finish_reason: 'length' } });
    const events: Record<string, unknown>[] = [];
    await expect(chat('l', store, config, 'List entries', [], {
      signal: new AbortController().signal,
      onToolEvent: async event => { events.push(event); },
    }, undefined, true)).rejects.toThrow('token limit');
    const metadata = events.find(event => event.type === 'meta' && event.modelIO);
    expect(metadata?.modelIO).toEqual([expect.objectContaining({ output: '{"buckets":[', finishReason: 'length', usage: { output_tokens: 1800 } })]);
    expect(fake.invoke).toHaveBeenCalledTimes(1);
    expect(fake.withConfig).toHaveBeenCalledWith({ response_format: PLANNER_RESPONSE_FORMAT });
    expect(fake.stream).not.toHaveBeenCalled();
  });

  it('performs exactly Planner+Response, streams matching final text, and emits verified turn token',async()=>{
    const events:Record<string,
    unknown>[]=[];
    const result=await chat('l',store,config,'List all entries',[],{
      signal:new AbortController().signal,
      onToolEvent:async e=>{
        events.push(e);
      }
    },undefined,true);
    expect(fake.invoke).toHaveBeenCalledTimes(1);
    expect(fake.withConfig).toHaveBeenCalledWith({ response_format: PLANNER_RESPONSE_FORMAT });
    expect(fake.stream).toHaveBeenCalledTimes(1);
    expect(createAiModel).toHaveBeenCalledWith('fake','test','http://unused',{
      maxRetries:0
    });
    expect(result.reply).toBe(events.filter(e=>e.type==='delta').map(e=>e.text).join(''));
    expect(events.at(-1)).toHaveProperty('turnToken');
    const summary = events.find(e => e.type === 'meta' && e.llmCalls !== undefined)!;
    expect(summary).toHaveProperty('llmCalls',2);
    const entries = summary.modelIO as { phase: string; input: string; systemPrompt: string; inputTruncated: boolean }[];
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.systemPrompt.length).toBeGreaterThan(0);
      expect(entry.systemPrompt.length + entry.input.length).toBeLessThanOrEqual(24000);
      expect(entry.inputTruncated).toBe(false);
    }
    const plannerMessages = fake.invoke.mock.calls[0]![0];
    const responseMessages = fake.stream.mock.calls[0]![0];
    expect(entries[0]!.systemPrompt).toBe(plannerMessages[0].content);
    expect(entries[0]!.input).toBe(plannerMessages[1].content);
    expect(entries[1]!.systemPrompt).toBe(responseMessages[0].content);
    expect(entries[1]!.input).toBe(responseMessages[1].content);

  });
  it('without diagnostics streams progress, answer and only the turn token as metadata', async () => {
    const events: Record<string, unknown>[] = [];
    await chat('l', store, config, 'List all entries', [], {
      signal: new AbortController().signal,
      onToolEvent: async event => { events.push(event); },
    }, undefined, false);
    const metadata = events.filter(event => event.type === 'meta');
    expect(metadata).toEqual([{ type: 'meta', turnToken: expect.any(String) }]);
    expect(events.some(event => event.type === 'phase')).toBe(true);
    expect(events.some(event => event.type === 'delta')).toBe(true);
  });
  it('rejects unsupported invented semantics before any response call',async()=>{
    fake.invoke.mockResolvedValue({
      content:JSON.stringify({
        buckets:[{
          ...plan.buckets[0],
          semanticQuery:'Revenue millions'
        }]
      })
    });
    await expect(chat('l',store,config,'List entries',[],{
      signal:new AbortController().signal,
      onToolEvent:async()=>{
      }
    },undefined,false)).rejects.toThrow('user evidence');
    expect(fake.invoke).toHaveBeenCalledTimes(1);
    expect(fake.withConfig).toHaveBeenCalledWith({ response_format: PLANNER_RESPONSE_FORMAT });
    expect(fake.stream).not.toHaveBeenCalled();
  });
  it('propagates cancellation before planning',async()=>{
    const controller=new AbortController();
    controller.abort();
    await expect(chat('l',store,config,'List entries',[],{
      signal:controller.signal,
      onToolEvent:async()=>{
      }
    },undefined,false)).rejects.toBeDefined();
    expect(fake.invoke).not.toHaveBeenCalled();
    expect(fake.stream).not.toHaveBeenCalled();
  });
});
