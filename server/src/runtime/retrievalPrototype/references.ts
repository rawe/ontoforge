/** Scoped, bounded verified turn references. Browser history alone cannot authorize entity IDs. */
import {
  randomUUID,
  createHash
} from 'node:crypto';
import type {
  Snapshot
} from './snapshot.js';
import type {
  Plan,
  ResultBucket,
  ResponseContext
} from './search.js';
import {
  ValidationError
} from '../../core/exceptions.js';
export interface Previous {
  complete?: boolean;
  plan:Plan;
  results:{
    entityTypeKey:string;
    ids:string[]
  }[];
  referencedResults?:{
    entityTypeKey:string;
    ids:string[]
  }[];
}
const turns=new Map<string,{
  scope:string;
  configHash:string;
  expires:number;
  previous:Previous
}
>();
const hash=(s:Snapshot)=>createHash('sha256').update(JSON.stringify(s.config)).digest('hex');
export function remember(s:Snapshot,plan:Plan,results:ResultBucket[],reference?:Previous,responseContext?:ResponseContext):string{
  for(const [key,value] of turns)if(value.expires<Date.now())turns.delete(key);
  if(turns.size>=100)turns.delete(turns.keys().next().value!);
  const token=randomUUID();
  turns.set(token,{
    scope:s.scope,
    configHash:hash(s),
    expires:Date.now()+10*60_000,
    previous:{
      plan,
      complete: responseContext?.results.every(bucket => bucket.omitted === 0) ?? true,
      referencedResults:reference?.results,
      results:results.map(b=>({
        entityTypeKey:b.entityTypeKey,
        ids:b.items.map(i=>i.id)
      }))
    }
  });
  return token;
}
export function previous(s:Snapshot,token?:string):Previous|undefined{
  if(!token)return undefined;
  const entry=turns.get(token);
  if(!entry||entry.expires<Date.now()||entry.scope!==s.scope||entry.configHash!==hash(s))throw new ValidationError('Conversation reference expired or configuration changed; please state the complete question.');
  return structuredClone(entry.previous);
}
