/** Reversible demo routes; no persistence or model/provider selection. */
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
  sendChatStream
} from '../chatStream.js';
import {
  catalog
} from './config.js';
import {
  prepare,
  chat
} from './runtime.js';
const Params=z.object({
  ontologyKey:z.string(),
  lensKey:z.string()
});
const Body=z.object({
  config:z.unknown()
});
const Chat=Body.extend({
  message:z.string().min(1).max(2000),
  turnToken:z.string().max(100).optional(),
  diagnostics:z.boolean().default(false),
  history:z.array(z.object({
    role:z.enum(['user','assistant']),
    content:z.string().max(12000)
  })).max(30).default([])
});
export const retrievalPrototypeRouter:FastifyPluginAsyncZod=async app=>{
  app.get('/ai/retriever/catalog',{
    schema:{
      tags:['ai'],
      params:Params
    }
  },async request=>catalog((await loadSchemaUncached(request.params.lensKey,await getRuntimeStore(request.params.ontologyKey))).scoped));
  app.post('/ai/retriever/prepare',{
    schema:{
      tags:['ai'],
      params:Params,
      body:Body
    }
  },async(request,reply)=>{
    const controller=new AbortController();
    const close=()=>controller.abort();
    reply.raw.once('close',close);
    try{
      return await prepare(request.params.lensKey,await getRuntimeStore(request.params.ontologyKey),request.body.config,controller.signal);
    }finally{
      reply.raw.removeListener('close',close);
      controller.abort();
    }
  });
  app.post('/ai/retriever/chat',{
    schema:{
      tags:['ai'],
      params:Params,
      body:Chat
    }
  },async(request,reply)=>{
    const store=await getRuntimeStore(request.params.ontologyKey);
    return sendChatStream(reply,execution=>chat(request.params.lensKey,store,request.body.config,request.body.message,request.body.history,execution,request.body.turnToken,request.body.diagnostics));
  });
};
