/** Throwaway V2 prototype: browser-owned config, always checked against the current lens. */
import {
  z
} from 'zod';
import {
  ValidationError
} from '../../core/exceptions.js';
import type {
  SchemaCacheValue
} from '../schemaCache.js';
export const Step = z.object({
  relationTypeKey: z.string(),
  direction: z.enum(['outgoing','incoming'])
});
export const Condition = z.object({
  id:z.string().min(1),
  mode:z.enum(['hard','soft']),
  path:z.array(Step).max(2),
  targetField:z.string(),
  textFields:z.array(z.string()).max(12)
});
export const ConfigSchema = z.object({
  buckets:z.array(z.object({
    entityTypeKey:z.string(),
    searchFields:z.array(z.string()).min(1).max(12),
    answerFields:z.array(z.string()).min(1).max(12),
    conditions:z.array(Condition).max(12)
  })).min(1).max(8),
  threshold:z.number().min(-1).max(1).default(.35),
  answerFieldCharacters:z.number().int().min(100).max(2000).default(800)
});
export type Config=z.infer<typeof ConfigSchema>;
export type Rule=z.infer<typeof Condition>;
export type Hop=z.infer<typeof Step>;
export type Bucket=Config['buckets'][number];
export const LIMITS={
  entities:1000,
  relations:3000,
  contextCharacters:8000,
  semanticCandidates:60,
  textCharacters:2400
};
export function targetType(schema:SchemaCacheValue,start:string,path:Hop[]):string {
  let current=start;
  for(const hop of path){
    const r=schema.relationTypes[hop.relationTypeKey];
    if(!r)throw new ValidationError('Relation path is outside the lens.');
    const from=hop.direction==='outgoing'?r.fromEntityTypeKey:r.toEntityTypeKey;
    const to=hop.direction==='outgoing'?r.toEntityTypeKey:r.fromEntityTypeKey;
    if(from!==current||!schema.entityTypes[to])throw new ValidationError('Relation path has invalid endpoints.');
    current=to;
  }
  return current;
}
export function validateConfig(raw:unknown,schema:SchemaCacheValue):Config {
  const parsed=ConfigSchema.safeParse(raw);
  if(!parsed.success)throw new ValidationError('Invalid retriever configuration.');
  const c=parsed.data;
  if(new Set(c.buckets.map(b=>b.entityTypeKey)).size!==c.buckets.length)throw new ValidationError('Duplicate result types.');
  const fields=(typ:string,keys:string[],text:boolean)=>{
    const t=schema.entityTypes[typ];
    if(!t||keys.some(k=>!t.properties[k]||(text&&!['string','document'].includes(t.properties[k]!.dataType))))throw new ValidationError('Field is not visible or cannot be used as text.');
  };
  for(const b of c.buckets){
    fields(b.entityTypeKey,b.searchFields,true);
    fields(b.entityTypeKey,b.answerFields,false);
    if(new Set(b.conditions.map(r=>r.id)).size!==b.conditions.length)throw new ValidationError('Duplicate condition identifier.');
    for(const r of b.conditions){
      const t=targetType(schema,b.entityTypeKey,r.path);
      fields(t,[r.targetField],false);
      fields(t,r.textFields,true);
      if(r.mode==='soft'&&!r.textFields.length)throw new ValidationError('Soft conditions require text fields.');
    }
  }
  return c;
}
export function catalog(schema:SchemaCacheValue){
  return {
    entityTypes:Object.values(schema.entityTypes).map(t=>({
      key:t.key,
      displayName:t.displayName,
      properties:Object.values(t.properties).map(p=>({
        key:p.key,
        displayName:p.displayName,
        dataType:p.dataType
      }))
    })),
    relationTypes:Object.values(schema.relationTypes).filter(r=>schema.entityTypes[r.fromEntityTypeKey]&&schema.entityTypes[r.toEntityTypeKey]).map(r=>({
      key:r.key,
      displayName:r.displayName,
      fromEntityTypeKey:r.fromEntityTypeKey,
      toEntityTypeKey:r.toEntityTypeKey
    })),
    defaults:{
      threshold:.35,
      answerFieldCharacters:800
    },
    limits:LIMITS
  };
}
