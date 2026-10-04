/** Editor support for retriever profiles: the visible schema and editor defaults. Runs nothing. */
import type {
  FastifyPluginAsyncZod
} from 'fastify-type-provider-zod';
import {
  z
} from 'zod';
import {
  getRuntimeStore
} from '../../core/ports.js';
import {
  loadSchemaUncached
} from '../schemaCache.js';
import {
  catalog
} from './config.js';
const Params=z.object({
  ontologyKey:z.string(),
  lensKey:z.string()
});
export const retrievalPrototypeRouter:FastifyPluginAsyncZod=async app=>{
  app.get('/ai/retriever/catalog',{
    schema:{
      tags:['ai'],
      params:Params
    }
  },async request=>catalog((await loadSchemaUncached(request.params.lensKey,await getRuntimeStore(request.params.ontologyKey))).scoped));
};
