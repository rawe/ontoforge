import {
  z
} from 'zod';
import {
  ValidationError
} from '../../core/exceptions.js';
import type {
  EmbeddingProvider
} from '../../core/embedding.js';
import type {
  Previous
} from './references.js';
import {
  LIMITS,
  targetType,
  type Bucket
} from './config.js';
import {
  walk,
  vector,
  cosine,
  entityText,
  selectedText,
  type Snapshot,
  type Row,
  type EmbeddingStats
} from './snapshot.js';
export const PlanSchema=z.object({
  buckets:z.array(z.object({
    entityTypeKey:z.string(),
    all:z.boolean(),
    previous:z.object({
      conditionId:z.string().nullable(),
      quote:z.string()
    }).nullable().optional(),
    semanticQuery:z.string().nullable(),
    softConditionIds:z.array(z.string()).max(12).default([]),
    variants:z.array(z.string().min(1).max(200)).max(3).default([]),
    filters:z.array(z.object({
      conditionId:z.string(),
      value:z.union([z.string(),z.number(),z.boolean()]),
      quote:z.string()
    })).max(8)
  })).max(8),
  unsupportedReason:z.string().max(500).nullable().optional()
});
export type Plan=z.infer<typeof PlanSchema>;
export interface History{
  role:'user'|'assistant';
  content:string;
}
const norm=(v:unknown)=>String(v).normalize('NFKC').toLocaleLowerCase('de').replace(/\s+/g,' ').trim();
export function validatePlan(raw:unknown,s:Snapshot,message:string,history:History[],previous?:Previous):Plan{
  const parsed=PlanSchema.safeParse(raw);
  if(!parsed.success)throw new ValidationError('Search plan has an invalid format.');
  const plan=parsed.data;
  const source=[message,
  ...history.filter(h=>h.role==='user').map(h=>h.content)];
  if((!plan.buckets.length&&!plan.unsupportedReason)||new Set(plan.buckets.map(b=>b.entityTypeKey)).size!==plan.buckets.length)throw new ValidationError('Search plan must contain distinct result types or an unsupported-data explanation.');
  for(const b of plan.buckets){
    const config=s.config.buckets.find(x=>x.entityTypeKey===b.entityTypeKey);
    if(!config)throw new ValidationError('Search plan uses an unselected result type.');
    if(b.softConditionIds.some(id=>!config.conditions.some(r=>r.id===id&&r.mode==='soft')))throw new ValidationError('Soft condition is not allowed.');
    if(b.semanticQuery!==null&&(!b.semanticQuery.trim()||!source.some(t=>norm(t).includes(norm(b.semanticQuery)))))throw new ValidationError('Semantic query has no verbatim user evidence.');
    if(b.previous){
      if (previous?.plan.buckets.some(bucket => bucket.semanticQuery !== null)) {
        throw new ValidationError('Previous semantic results are candidates, not verified recommendations. Please repeat the topic and constraints.');
      }
      if (previous?.complete === false) {
        throw new ValidationError('Previous results were incomplete in the response context. Please repeat the topic and constraints.');
      }
      if(!previous||!source.some(t=>norm(t).includes(norm(b.previous!.quote)))||!/(davon|dies|dessen|deren|diese|jene|\bthose\b|\bthese\b|\bthis\b|\bthat\b|\btheir\b)/i.test(b.previous.quote))throw new ValidationError('Previous result reference has no user evidence.');
      const rule=b.previous.conditionId===null?null:config.conditions.find(r=>r.id===b.previous!.conditionId&&r.mode==='hard');
      if(b.previous.conditionId!==null&&!rule)throw new ValidationError('Previous result reference has no allowed relation path.');
      const typ=rule?targetType(s.schema,b.entityTypeKey,rule.path):b.entityTypeKey;
      const candidates=previous.results.filter(r=>r.entityTypeKey===typ);
      if(candidates.length!==1||(/(dieser|dessen|\bthis\b|\bthat\b)/i.test(b.previous.quote)&&candidates[0]!.ids.length!==1))throw new ValidationError('Previous result reference is ambiguous.');
    }
    for(const f of b.filters){
      const r=config.conditions.find(x=>x.id===f.conditionId);
      if(!r||r.mode!=='hard')throw new ValidationError('Search plan uses a hard condition that is not allowed.');
      if(!f.quote.trim()||!source.some(t=>norm(t).includes(norm(f.quote)))||!norm(f.quote).includes(norm(f.value)))throw new ValidationError('Exact filter value has no verbatim user evidence.');
    }
  }
  return plan;
}
export interface ResultItem{
  id:string;
  score:number|null;
  fields:Row;
  relations:Row[];
  sources:Row[];
}
export interface ResultBucket{
  entityTypeKey:string;
  totalHardMatches:number;
  totalAccepted:number;
  items:ResultItem[];
  omitted:number;
}
export interface Retrieval{
  results:ResultBucket[];
  limitations:string[];
}
export async function retrieve(s:Snapshot,plan:Plan,p:EmbeddingProvider|null,signal:AbortSignal,stats:EmbeddingStats,previous?:Previous):Promise<Retrieval>{
  const measured=async(text:string,kind:'queryEmbeddingMs'|'candidateEmbeddingMs')=>{
    const start=performance.now();
    try{
      return await vector(p!,s.scope,text,signal,stats);
    }finally{
      stats[kind]=(stats[kind]??0)+performance.now()-start;
    }
  };
  const scoreOf=(a:number[],b:number[])=>{
    const start=performance.now();
    const v=cosine(a,b);
    stats.scoringMs=(stats.scoringMs??0)+performance.now()-start;
    return v;
  };
  const results:ResultBucket[]=[];
  const limitations:string[]=plan.unsupportedReason?[plan.unsupportedReason]:[];
  for(const pb of plan.buckets){
    signal.throwIfAborted();
    const originalBucket=s.config.buckets.find(b=>b.entityTypeKey===pb.entityTypeKey)!;
    const b={
      ...originalBucket,
      conditions:originalBucket.conditions.filter(r=>r.mode==='hard'||pb.softConditionIds.includes(r.id))
    };
    const hard=(s.entities[b.entityTypeKey]??[]).filter(row=>{
      if(pb.previous){
        const rule=pb.previous.conditionId===null?null:b.conditions.find(r=>r.id===pb.previous!.conditionId);
        const typ=rule?targetType(s.schema,b.entityTypeKey,rule.path):b.entityTypeKey;
        const ids=new Set(previous?.results.find(r=>r.entityTypeKey===typ)?.ids??[]);
        if(!walk(s,b.entityTypeKey,String(row._id),rule?.path??[]).some(t=>ids.has(String(t._id))))return false;
      }
      return pb.filters.every(f=>{
        const rule=b.conditions.find(r=>r.id===f.conditionId)!;
        return walk(s,b.entityTypeKey,String(row._id),rule.path).some(target=>norm(target[rule.targetField])===norm(f.value));
      });
    });
    let ranked:{
      row:Row;
      score:number|null;
      sources:Row[]
    }[]=[];
    if(pb.semanticQuery===null){
      ranked=hard.map(row=>({
        row,
        score:null,
        sources:[{
          kind:'hard'
        }]
      }));
    }  else{
      if(!p)throw new ValidationError('Semantic search requires the configured embedding provider.');
      const query=await measured(pb.semanticQuery,'queryEmbeddingMs');
      const variantVectors=[];
      for(const v of pb.variants)variantVectors.push(await measured(v,'queryEmbeddingMs'));
      const scored=[];
      for(const row of hard){
        signal.throwIfAborted();
        const score=scoreOf(query,await measured(entityText(s,b,row),'candidateEmbeddingMs'));
        const sources:Row[]=[{
          kind:'entity',
          score
        }];
        let discovery=score;
        const ownVector=await measured(entityText(s,b,row),'candidateEmbeddingMs');
        for(const v of variantVectors)discovery=Math.max(discovery,scoreOf(v,ownVector));
        for(const rule of b.conditions.filter(r=>r.mode==='soft'))for(const target of walk(s,b.entityTypeKey,String(row._id),rule.path)){
          const categoryScore=scoreOf(query,await measured(selectedText(target,rule.textFields),'candidateEmbeddingMs'));
          sources.push({
            kind:'relation',
            conditionId:rule.id,
            targetId:target._id,
            score:categoryScore
          });
          discovery=Math.max(discovery,categoryScore);
        }
        scored.push({
          row,
          score,
          sources,
          discovery
        });
      }
      scored.sort((a,b)=>b.discovery-a.discovery||String(a.row._id).localeCompare(String(b.row._id)));
      const candidates=scored.slice(0,LIMITS.semanticCandidates);
      if(scored.length>candidates.length)limitations.push(`${b.entityTypeKey}: semantic candidates capped at ${LIMITS.semanticCandidates}; a complete semantic result set is not guaranteed.`);
      ranked=candidates.filter(r=>r.score>=s.config.threshold).sort((a,b)=>b.score-a.score||String(a.row._id).localeCompare(String(b.row._id)));
    }
    const items=ranked.map(({
      row,
      score,
      sources
    })=>item(s,b,row,score,sources,limitations));
    results.push({
      entityTypeKey:b.entityTypeKey,
      totalHardMatches:hard.length,
      totalAccepted:items.length,
      items,
      omitted:0
    });
  }
  return{
    results,
    limitations
  };
}
function item(s:Snapshot,b:Bucket,row:Row,score:number|null,sources:Row[],limitations:string[]):ResultItem{
  const fields:Row={
  };
  for(const k of b.answerFields){
    const value=row[k];
    if(typeof value==='string'&&value.length>s.config.answerFieldCharacters){
      fields[k]=value.slice(0,s.config.answerFieldCharacters)+' [truncated]';
      limitations.push(`${b.entityTypeKey}/${row._id}: answer field ${k} truncated.`);
    }else fields[k]=value??null;
  }
  const relations:Row[]=[];
  for(const r of b.conditions)for(const target of walk(s,b.entityTypeKey,String(row._id),r.path)){
    relations.push({
      conditionId:r.id,
      id:target._id,
      field:r.targetField,
      value:typeof target[r.targetField]==='string'?String(target[r.targetField]).slice(0,s.config.answerFieldCharacters):target[r.targetField]
    });
  }
  return{
    id:String(row._id),
    score,
    fields,
    relations,
    sources
  };
}
export interface ResponseEvidence {
  id: string;
  fields: Row;
  relations: Row[];
}
export interface ResponseContext {
  results: (Omit<ResultBucket, 'items'> & { items: ResponseEvidence[] })[];
  limitations: string[];
}

/** Keep only answer facts; search scores, source diagnostics, and plan quotes stay in metadata. */
export function boundContext(retrieval: Retrieval): ResponseContext {
  const results = retrieval.results.map(bucket => ({ ...bucket, items: [] as ResponseEvidence[] }));
  const limitations = [...retrieval.limitations];
  const bounded: ResponseContext = { results, limitations };
  for (let index = 0; index < results.length; index++) {
    const out = results[index]!;
    const original = retrieval.results[index]!;
    for (const row of original.items) {
      out.items.push({ id: row.id, fields: row.fields, relations: row.relations });
      if (JSON.stringify(bounded).length > LIMITS.contextCharacters - 400) {
        out.items.pop();
        out.omitted++;
      }
    }
    if (out.omitted) {
      limitations.push(`${out.entityTypeKey}: ${out.omitted} technically selected candidates omitted from the response context. Their relevance was not assessed by the response model; they are not established additional matches. The response may be incomplete.`);
    }
  }
  if (JSON.stringify(bounded).length > LIMITS.contextCharacters) {
    throw new ValidationError('Response metadata exceeds the context limit.');
  }
  return bounded;
}
