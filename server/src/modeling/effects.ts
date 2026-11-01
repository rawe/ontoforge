/**
 * The work a design change leaves for after its commit — today the
 * search reconcile (`service.ts` `afterSchemaChange`). A command inside a
 * design change queues it instead of running it; whoever opened the change
 * runs the queue once the change committed, on a store outside every
 * design change, or drops it when the change rolled back. A queued effect
 * never holds a store of the change: it gets the one `run` hands it.
 */

import type { ModelingStore } from "../core/ports.js";

/** One piece of after-commit work, on a store outside every design change. */
export type Effect = (store: ModelingStore) => Promise<void>;

export class EffectQueue {
  private readonly effects = new Map<string, Effect>();

  /** Queue `effect` under `key`; a key queued again runs once. */
  add(key: string, effect: Effect): void {
    if (!this.effects.has(key)) this.effects.set(key, effect);
  }

  /** Run every queued effect once, in queue order, on `store`, and empty the queue. */
  async run(store: ModelingStore): Promise<void> {
    const effects = [...this.effects.values()];
    this.effects.clear();
    for (const effect of effects) await effect(store);
  }
}
