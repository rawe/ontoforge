import { once } from "node:events";
import { get, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { shutdownServer } from "../../src/main.js";
import { MemoryThreadStore } from "../../src/runtime/threads/memoryThreadStore.js";

/** A thread store that records when it closes. */
class RecordingThreads extends MemoryThreadStore {
  constructor(private readonly events: string[]) {
    super();
  }
  override async close(): Promise<void> {
    this.events.push("threads closed");
    await super.close();
  }
}

let app: FastifyInstance | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
});

async function build(events: string[] = []): Promise<FastifyInstance> {
  app = await createApp(new RecordingThreads(events));
  return app;
}

async function start(target: FastifyInstance): Promise<string> {
  await target.listen({ port: 0, host: "127.0.0.1" });
  return `http://127.0.0.1:${(target.server.address() as AddressInfo).port}`;
}

/** A GET kept as a raw response, so a cut connection shows. */
function rawGet(url: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => get(url, resolve).on("error", reject));
}

describe("probes", () => {
  it("answer live and ready, then not ready once draining, outside the envelope", async () => {
    const app = await build();
    const live = await app.inject({ url: "/livez" });
    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ live: true });
    const ready = await app.inject({ url: "/readyz" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ ready: true });

    app.lifecycle.drain();
    const draining = await app.inject({ url: "/readyz" });
    expect(draining.statusCode).toBe(503);
    expect(draining.json()).toEqual({ ready: false });
    expect((await app.inject({ url: "/livez" })).statusCode).toBe(200);
  });

  it("are not part of the OpenAPI document", async () => {
    const app = await build();
    const paths = Object.keys((await app.inject({ url: "/openapi.json" })).json().paths);
    expect(paths).not.toContain("/livez");
    expect(paths).not.toContain("/readyz");
  });
});

describe("shutdown", () => {
  it("lets a running request finish, refuses new connections, then closes the thread store", async () => {
    const events: string[] = [];
    const app = await build(events);
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    app.get("/slow", async () => {
      await finished;
      events.push("handled");
      return { done: true };
    });
    const url = await start(app);
    const running = fetch(`${url}/slow`);
    await sleep(50);

    const shutdown = shutdownServer(app, { drainMs: 5_000 });
    expect(app.lifecycle.draining).toBe(true);
    await expect(fetch(`${url}/livez`)).rejects.toThrow();
    expect(events).toEqual([]);

    finish();
    const response = await running;
    expect(response.status).toBe(200);
    expect(response.headers.get("connection")).toBe("close");
    await shutdown;
    expect(events).toEqual(["handled", "threads closed"]);
  });

  it("cuts a stream at the deadline and closes the thread store only after its turn is released", async () => {
    const events: string[] = [];
    const app = await build(events);
    // Shaped like a chat stream: hijacked, and the turn is released after
    // the socket closed (`chatStream.ts`).
    app.get("/stream", async (_request, reply) => {
      reply.hijack();
      reply.raw.writeHead(200, { "content-type": "application/x-ndjson" });
      reply.raw.write(`{"type":"thread"}\n`);
      await once(reply.raw, "close");
      await sleep(100);
      events.push("turn released");
    });
    const url = await start(app);
    const stream = await rawGet(`${url}/stream`);
    stream.resume();
    stream.on("error", () => {}); // the cut
    const cut = new Promise((resolve) => stream.once("close", resolve));

    const started = Date.now();
    await shutdownServer(app, { drainMs: 200 });
    await cut;
    expect(stream.complete).toBe(false);
    expect(events).toEqual(["turn released", "threads closed"]);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("closes an app that never listened", async () => {
    const events: string[] = [];
    const app = await build(events);
    await shutdownServer(app, { drainMs: 100 });
    expect(events).toEqual(["threads closed"]);
  });

  it("runs once for repeated calls", async () => {
    const events: string[] = [];
    const app = await build(events);
    await start(app);
    const first = shutdownServer(app, { drainMs: 100 });
    const second = shutdownServer(app, { drainMs: 100 });
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(events).toEqual(["threads closed"]);
  });
});
