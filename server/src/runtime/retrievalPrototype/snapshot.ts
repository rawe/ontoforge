import {
  createHash
} from 'node:crypto';
import type {
  RuntimeStore
} from '../../core/ports.js';
import type {
  EmbeddingProvider
} from '../../core/embedding.js';
import {
  ValidationError
} from '../../core/exceptions.js';
import {
  loadSchemaUncached,
  type SchemaCacheValue
} from '../schemaCache.js';
import {
  LIMITS,
  validateConfig,
  targetType,
  type Config,
  type Hop,
  type Bucket
} from './config.js';
export type Row=Record<string,unknown>;
export interface Snapshot{
  schema:SchemaCacheValue;
  config:Config;
  entities:Record<string,
  Row[]>;
  relations:Record<string,
  Row[]>;
  fingerprint:string;
  entityCount:number;
  relationCount:number;
  scope:string;
  schemaReadMs?:number;
  dataReadMs?:number;
}
export async function readSnapshot(lens:string,store:RuntimeStore,raw:unknown,signal:AbortSignal):Promise<Snapshot>{
  signal.throwIfAborted();
  const readStart=performance.now();
  const schema=(await loadSchemaUncached(lens,store)).scoped;
  const schemaReadMs=performance.now()-readStart;
  const dataStart=performance.now();
  const config=validateConfig(raw,schema);
  const types=new Set(config.buckets.map(b=>b.entityTypeKey));
  const rels=new Set<string>();
  for(const b of config.buckets)for(const r of b.conditions){
    let current=b.entityTypeKey;
    for(const hop of r.path){
      rels.add(hop.relationTypeKey);
      current=targetType(schema,current,[hop]);
      types.add(current);
    }
  }
  const entities:Record<string,
  Row[]>={
  };
  const relations:Record<string,
  Row[]>={
  };
  let entityCount=0,
  relationCount=0;
  for(const typ of [...types].sort()){
    const t=schema.entityTypes[typ]!;
    const rows:Row[]=[];
    let offset=0;
    let expected:number|undefined;
    do{
      signal.throwIfAborted();
      const [rawRows,
      total]=await store.listEntities(typ,t.properties,[],null,[],'_id','asc',200,offset);
      if(expected!==undefined&&total!==expected)throw new ValidationError('Data changed during preparation; please try again.');
      expected=total;
      if(entityCount+total>LIMITS.entities)throw new ValidationError('Prototype limit: too many entities.');
      for(const row of rawRows){
        const scoped:Row={
          _id:row._id,
          _entityTypeKey:typ
        };
        for(const k of Object.keys(t.properties))if(k in row)scoped[k]=row[k];
        rows.push(scoped);
      }
      offset+=rawRows.length;
      if(!rawRows.length&&offset<total)throw new ValidationError('Incomplete entity read.');
    }
    while(offset<(expected??0));
    entities[typ]=rows;
    entityCount+=rows.length;
  }
  for(const typ of [...rels].sort()){
    const t=schema.relationTypes[typ]!;
    const rows:Row[]=[];
    let offset=0;
    let expected:number|undefined;
    do{
      signal.throwIfAborted();
      const [rawRows,
      total]=await store.listRelations(typ,t.properties,[],null,null,'_id','asc',200,offset);
      if(expected!==undefined&&total!==expected)throw new ValidationError('Relations changed during preparation.');
      expected=total;
      if(relationCount+total>LIMITS.relations)throw new ValidationError('Prototype limit: too many relations.');
      for(const row of rawRows)rows.push({
        _id:row._id,
        fromEntityId:row.fromEntityId,
        toEntityId:row.toEntityId
      });
      offset+=rawRows.length;
      if(!rawRows.length&&offset<total)throw new ValidationError('Incomplete relation read.');
    }
    while(offset<(expected??0));
    relations[typ]=rows;
    relationCount+=rows.length;
  }
  const scope=store.ontologyKey+'/'+lens;
  const fingerprint=createHash('sha256').update(JSON.stringify({
    scope,
    schema,
    config,
    entities,
    relations
  })).digest('hex');
  return{
    schema,
    config,
    entities,
    relations,
    fingerprint,
    entityCount,
    relationCount,
    scope,
    schemaReadMs,
    dataReadMs:performance.now()-dataStart
  };
}
export function walk(s:Snapshot,typ:string,id:string,path:Hop[]):Row[]{
  let current=typ;
  let ids=new Set([id]);
  for(const hop of path){
    const next=new Set<string>();
    for(const r of s.relations[hop.relationTypeKey]??[]){
      const from=String(r[hop.direction==='outgoing'?'fromEntityId':'toEntityId']);
      if(ids.has(from))next.add(String(r[hop.direction==='outgoing'?'toEntityId':'fromEntityId']));
    }
    ids=next;
    current=targetType(s.schema,current,[hop]);
  }
  return(s.entities[current]??[]).filter(r=>ids.has(String(r._id)));
}
export function selectedText(row:Row,fields:string[]):string{
  return fields.map(k=>`${k}: ${String(row[k]??'').slice(0,LIMITS.textCharacters)}`).join('\n').slice(0,LIMITS.textCharacters);
}
export function entityText(s:Snapshot,b:Bucket,row:Row):string{
  const segments=[selectedText(row,b.searchFields)];
  for(const r of b.conditions.filter(r=>r.mode==='soft'))for(const related of walk(s,b.entityTypeKey,String(row._id),r.path))segments.push(selectedText(related,r.textFields));
  return segments.join('\n').slice(0,LIMITS.textCharacters);
}
export interface EmbeddingStats{
  embeddingRequests:number;
  cacheHits:number;
  queryEmbeddingMs?:number;
  candidateEmbeddingMs?:number;
  scoringMs?:number;
}
interface Flight{
  controller:AbortController;
  promise:Promise<number[]>;
  waiters:number;
}
const caches=new WeakMap<EmbeddingProvider,Map<string,number[]>>();
const flights=new WeakMap<EmbeddingProvider,Map<string,Flight>>();
/** In-flight sharing retains the provider request until the last consumer aborts. */
export async function vector(provider:EmbeddingProvider,scope:string,text:string,signal:AbortSignal,stats:EmbeddingStats):Promise<number[]>{
  signal.throwIfAborted();
  let cache=caches.get(provider);
  if(!cache){
    cache=new Map();
    caches.set(provider,cache);
  }
  const key=createHash('sha256').update(scope+'\0'+text).digest('hex');
  const cached=cache.get(key);
  if(cached){
    stats.cacheHits++;
    return cached;
  }
  let pending=flights.get(provider);
  if(!pending){
    pending=new Map();
    flights.set(provider,pending);
  }
  let f=pending.get(key);
  if(!f){
    const controller=new AbortController();
    stats.embeddingRequests++;
    const promise=provider.embed(text,controller.signal).then(v=>{
      if(!v||!v.length||v.some(x=>!Number.isFinite(x)))throw new ValidationError('Embedding unavailable; search stopped.');
      if(cache!.size>=2000)cache!.delete(cache!.keys().next().value!);
      cache!.set(key,v);
      return v;
    }).finally(()=>pending!.delete(key));
    f={
      controller,
      promise,
      waiters:0
    };
    pending.set(key,f);
  }else stats.cacheHits++;
  f.waiters++;
  const shared=f;
  return new Promise<number[]>((resolve,reject)=>{
    let finished=false;
    const done=()=>{
      if(finished)return false;
      finished=true;
      signal.removeEventListener('abort',abort);
      shared.waiters--;
      if(shared.waiters===0)shared.controller.abort();
      return true;
    };
    const abort=()=>{
      if(done())reject(signal.reason);
    };
    signal.addEventListener('abort',abort,{
      once:true
    });
    shared.promise.then(v=>{
      if(done())resolve(v);
    },e=>{
      if(done())reject(e);
    });
    if(signal.aborted)abort();
  });
}
export function cosine(a:number[],b:number[]):number{
  if(a.length!==b.length)throw new ValidationError('Embedding dimensions do not match.');
  let dot=0,
  aa=0,
  bb=0;
  for(let i=0;
  i<a.length;
  i++){
    dot+=a[i]!*b[i]!;
    aa+=a[i]!**2;
    bb+=b[i]!**2;
  }
  return aa&&bb?dot/Math.sqrt(aa*bb):0;
}
export async function warm(s:Snapshot,p:EmbeddingProvider,signal:AbortSignal,stats:EmbeddingStats){
  const texts=new Set<string>();
  for(const b of s.config.buckets){
    const soft=b.conditions.filter(r=>r.mode==='soft');
    if(soft.length>6)throw new ValidationError('Prototype limit: at most six soft rules per bucket.');
    for(const row of s.entities[b.entityTypeKey]??[]){
      for(let mask=0;
      mask<(1<<soft.length);
      mask++){
        const selected=soft.filter((_,i)=>mask&(1<<i));
        texts.add(entityText(s,{
          ...b,
          conditions:[...b.conditions.filter(r=>r.mode==='hard'),
          ...selected]
        },row));
      }
      for(const r of soft)for(const target of walk(s,b.entityTypeKey,String(row._id),r.path))texts.add(selectedText(target,r.textFields));
    }
  }
  if(texts.size>2000)throw new ValidationError('Prototype limit: too many selected text combinations.');
  const jobs=[...texts];
  let i=0;
  await Promise.all(Array.from({
    length:Math.min(4,jobs.length)
  },async()=>{
    while(i<jobs.length){
      signal.throwIfAborted();
      await vector(p,s.scope,jobs[i++]!,signal,stats);
    }
  }));
}
