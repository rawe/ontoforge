import {
  describe,
  it,
  expect,
  vi
} from 'vitest';
import {
  validateConfig,
  type Config
} from '../../../src/runtime/retrievalPrototype/config.js';
import {
  validatePlan,
  retrieve,
  boundContext,
  type Plan
} from '../../../src/runtime/retrievalPrototype/search.js';
import {
  walk,
  vector,
  readSnapshot,
  type Snapshot,
  type EmbeddingStats
} from '../../../src/runtime/retrievalPrototype/snapshot.js';
import type {
  SchemaCacheValue
} from '../../../src/runtime/schemaCache.js';
import type {
  EmbeddingProvider
} from '../../../src/core/embedding.js';
import type {
  RuntimeStore
} from '../../../src/core/ports.js';
const prop=(key:string)=>({
  key,
  displayName:key,
  dataType:'string',
  required:true,
  defaultValue:null,
  description:null
});
const schema:SchemaCacheValue={
  lensId:'l',
  lensKey:'same',
  lensName:'Lens',
  lensDescription:null,
  entityTypes:Object.fromEntries(['product','vendor','hall'].map(key=>[key,{
    key,
    displayName:key,
    description:null,
    properties:{
      name:prop('name'),
      description:prop('description')
    }
  }])),
  relationTypes:{
    offers:{
      key:'offers',
      displayName:'offers',
      description:null,
      fromEntityTypeKey:'vendor',
      toEntityTypeKey:'product',
      properties:{
      }
    },
    located:{
      key:'located',
      displayName:'located',
      description:null,
      fromEntityTypeKey:'vendor',
      toEntityTypeKey:'hall',
      properties:{
      }
    }
  }
};
const config=validateConfig({
  buckets:[{
    entityTypeKey:'product',
    searchFields:['name',
    'description'],
    answerFields:['name'],
    conditions:[{
      id:'hall',
      mode:'hard',
      path:[{
        relationTypeKey:'offers',
        direction:'incoming'
      },
      {
        relationTypeKey:'located',
        direction:'outgoing'
      }],
      targetField:'name',
      textFields:['name']
    }]
  }],
  threshold:.35
},schema);
function snap(n=2):Snapshot{
  return{
    schema,
    config,
    entities:{
      product:Array.from({
        length:n
      },(_,i)=>({
        _id:'p'+i,
        name:'Product '+i,
        description:'sensor'
      })),
      vendor:[{
        _id:'v',
        name:'Vendor'
      }],
      hall:[{
        _id:'h3',
        name:'Halle 3'
      }]
    },
    relations:{
      offers:Array.from({
        length:n
      },(_,i)=>({
        _id:'o'+i,
        fromEntityId:'v',
        toEntityId:'p'+i
      })),
      located:[{
        _id:'l',
        fromEntityId:'v',
        toEntityId:'h3'
      }]
    },
    fingerprint:'hash',
    entityCount:n+2,
    relationCount:n+1,
    scope:'ontology/same'
  };
}
const hard:Plan={
  buckets:[{
    entityTypeKey:'product',
    all:true,
    semanticQuery:null,
    softConditionIds:[],
    variants:[],
    filters:[{
      conditionId:'hall',
      value:'Halle 3',
      quote:'Halle 3'
    }]
  }]
};
const signal=()=>new AbortController().signal;
const stats=():EmbeddingStats=>({
  embeddingRequests:0,
  cacheHits:0
});
describe('V2 scoped deterministic retrieval',()=>{
  it('allows complete hard-result references but rejects semantic candidates and incomplete hard responses', () => {
    const plan = structuredClone(hard);
    plan.buckets[0]!.filters = [];
    plan.buckets[0]!.previous = { conditionId: null, quote: 'those' };
    const previous = { complete: true, plan: structuredClone(hard), results: [{ entityTypeKey: 'product', ids: ['p0', 'p1'] }] };
    expect(validatePlan(plan, snap(), 'Which of those?', [], previous).buckets).toHaveLength(1);
    previous.plan.buckets[0]!.semanticQuery = 'sensor';
    // Every candidate may be visible, yet the response's recommendation subset is still unknown.
    expect(() => validatePlan(plan, snap(), 'Which of those?', [], previous)).toThrow('not verified recommendations');
    previous.plan.buckets[0]!.semanticQuery = null;
    previous.complete = false;
    expect(() => validatePlan(plan, snap(), 'Which of those?', [], previous)).toThrow('incomplete');
    plan.buckets[0]!.previous = null;
    expect(validatePlan(plan, snap(), 'List products', [], previous).buckets).toHaveLength(1);
  });

  it('keeps all twelve answer records when large source diagnostics stay outside the response context', () => {
    const items = Array.from({ length: 12 }, (_, index) => ({
      id: 'p' + index,
      score: 0.9,
      fields: { name: 'Product ' + index, description: 'A short factual description.' },
      relations: [{ id: 'v', field: 'name', value: 'Supplier' }],
      sources: [{ kind: 'diagnostic', repeatedQuote: 'x'.repeat(10000) }],
    }));
    const original = { results: [{ entityTypeKey: 'product', totalHardMatches: 12, totalAccepted: 12, items, omitted: 0 }], limitations: [] };
    const context = boundContext(original);
    expect(context.results[0]!.items).toHaveLength(12);
    expect(context.results[0]!.omitted).toBe(0);
    expect(context.results[0]!.items[0]).not.toHaveProperty('sources');
    expect(context.results[0]!.items[0]).not.toHaveProperty('score');
    expect(original.results[0]!.items[0]!.sources[0]).toHaveProperty('repeatedQuote');
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(8000);
  });

  it('accepts object-topic evidence independently of supplier context', () => {
    const plan = structuredClone(hard);
    plan.buckets[0]!.semanticQuery = 'Sensoren und Messgeräte';
    const question = 'Welche Sensoren und Messgeräte finde ich bei Ausstellern in Halle 3? Nenne den Anbieter.';
    expect(validatePlan(plan, snap(), question, []).buckets[0]!.entityTypeKey).toBe('product');
  });
  it('supports English and German verified previous-result references but rejects ambiguous singulars', () => {
    const plan = structuredClone(hard);
    plan.buckets[0]!.filters = [];
    plan.buckets[0]!.previous = { conditionId: 'hall', quote: 'this hall' };
    const prior = { plan: hard, results: [{ entityTypeKey: 'hall', ids: ['h3'] }] };
    expect(validatePlan(plan, snap(), 'Which products are in this hall?', [], prior).buckets).toHaveLength(1);
    prior.results[0]!.ids.push('h4');
    expect(() => validatePlan(plan, snap(), 'Which products are in this hall?', [], prior)).toThrow('ambiguous');
    prior.results[0]!.ids = ['h3'];
    plan.buckets[0]!.previous!.quote = 'dieser';
    expect(validatePlan(plan, snap(), 'Welche Produkte stehen in dieser?', [], prior).buckets).toHaveLength(1);
  });

  it('rejects hidden text fields and disconnected paths',()=>{
    expect(()=>validateConfig({
      ...config,
      buckets:[{
        ...config.buckets[0]!,
        searchFields:['hidden']
      }]
    },schema)).toThrow();
    expect(()=>validateConfig({
      ...config,
      buckets:[{
        ...config.buckets[0]!,
        conditions:[{
          ...config.buckets[0]!.conditions[0]!,
          path:[{
            relationTypeKey:'offers',
            direction:'outgoing'
          }]
        }]
      }]
    },schema)).toThrow();
  });
  it('does exact two-hop traversal and retains complete hard lists beyond semantic cap',async()=>{
    const s=snap(120);
    expect(walk(s,'product','p0',config.buckets[0]!.conditions[0]!.path)[0]?.name).toBe('Halle 3');
    const got=await retrieve(s,hard,null,signal(),stats());
    expect(got.results[0]!.items).toHaveLength(120);
    expect(got.results[0]!.totalHardMatches).toBe(120);
    const absent=structuredClone(hard);
    absent.buckets[0]!.filters[0]!.value='Halle 99';
    expect((await retrieve(s,absent,null,signal(),stats())).results[0]!.items).toHaveLength(0);
  });
  it('rejects invented filter values even when catalog-valid, and assistant-only provenance',()=>{
    expect(()=>validatePlan(hard,snap(),'Zeige Produkte',[])).toThrow();
    expect(()=>validatePlan(hard,snap(),'Zeige Produkte',[{
      role:'assistant',
      content:'Halle 3'
    }])).toThrow();
    const forged=structuredClone(hard);
    forged.buckets[0]!.filters[0]!.quote='Produkte';
    expect(()=>validatePlan(forged,snap(),'Produkte Halle 3',[])).toThrow();
    expect(validatePlan(hard,snap(),'Alle Produkte in Halle 3',[]).buckets).toHaveLength(1);
  });
  it('permits a bounded data-gap response with no invented bucket',()=>{
    expect(validatePlan({
      buckets:[],
      unsupportedReason:'Keine Umsatzdaten.'
    },snap(),'Umsatz?',[]).buckets).toHaveLength(0);
  });
  it('makes hard/context omissions explicit',async()=>{
    const result=await retrieve(snap(120),hard,null,signal(),stats());
    const context=boundContext(result);
    expect(context.results[0]!.omitted).toBeGreaterThan(0);
    expect(context.limitations.join()).toContain('incomplete');
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(8000);
  });
  it('never embeds a hard-rejected row and monotonically applies score threshold',async()=>{
    const s=snap();
    s.entities.product![1]!.name='Different';
    s.relations.offers=s.relations.offers!.slice(0,1);
    const embed=vi.fn(async()=>[1,0]);
    const p:EmbeddingProvider={
      dimensions:2,
      embed
    };
    const plan=structuredClone(hard);
    plan.buckets[0]!.semanticQuery='sensor';
    await retrieve(s,plan,p,signal(),stats());
    expect(embed.mock.calls.flat().join()).not.toContain('Different');
    s.config={
      ...s.config,
      threshold:1
    };
    const got=await retrieve(s,plan,p,signal(),stats());
    expect(got.results[0]!.items).toHaveLength(1);
  });
});
describe('V2 bounded content cache',()=>{
  it('deduplicates in-flight texts, keeps ontology isolation, and invalidates changed text',async()=>{
    const embed=vi.fn(async()=>[1,0]);
    const p:EmbeddingProvider={
      dimensions:2,
      embed
    };
    await Promise.all([vector(p,'a/l','same',signal(),stats()),vector(p,'a/l','same',signal(),stats())]);
    expect(embed).toHaveBeenCalledTimes(1);
    await vector(p,'b/l','same',signal(),stats());
    await vector(p,'a/l','changed',signal(),stats());
    expect(embed).toHaveBeenCalledTimes(3);
  });
  it('cancels a provider flight only when its last caller cancels',async()=>{
    let aborted=false;
    const p:EmbeddingProvider={
      dimensions:2,
      embed:(_text,s)=>new Promise((_resolve,reject)=>s!.addEventListener('abort',()=>{
        aborted=true;
        reject(s!.reason);
      }))
    };
    const a=new AbortController(),
    b=new AbortController();
    const first=vector(p,'a','x',a.signal,stats());
    const second=vector(p,'a','x',b.signal,stats());
    a.abort();
    await expect(first).rejects.toBeDefined();
    expect(aborted).toBe(false);
    b.abort();
    await expect(second).rejects.toBeDefined();
    expect(aborted).toBe(true);
  });
  it('reads fresh scoped values, discards hidden values, sees edits/deletions',async()=>{
    let rows=[{
      _id:'p',
      name:'old',
      description:'visible',
      hidden:'secret'
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
          key:'product',
          displayName:'Product',
          properties:[prop('name'),
          prop('description')]
        }],
        relationTypes:[],
        entityInclusions:[],
        relationInclusions:[]
      }),
      getAiAgentConfigs:async()=>[],
      getSavedQueries:async()=>[],
      listEntities:async()=>[rows,
      rows.length]
    } as unknown as RuntimeStore;
    const c:Config={
      ...config,
      buckets:[{
        ...config.buckets[0]!,
        conditions:[]
      }]
    };
    const one=await readSnapshot('l',store,c,signal());
    expect(one.entities.product![0]).not.toHaveProperty('hidden');
    rows=[{
      ...rows[0]!,
      name:'edited'
    }];
    const two=await readSnapshot('l',store,c,signal());
    expect(two.fingerprint).not.toBe(one.fingerprint);
    rows=[];
    expect((await readSnapshot('l',store,c,signal())).entityCount).toBe(0);
  });
});
