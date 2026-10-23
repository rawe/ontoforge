/**
 * A changeset store for unit tests: every method a mock, answering by
 * default from an in-memory store that keeps the port's contract (binding,
 * draft-only changes, the compare-and-set on the version, objects by first
 * touch). Empty, it answers "nothing stored". Tests seed it with
 * `seed`, or override a method with `mockResolvedValue`.
 */

import { vi, type Mock } from "vitest";

import type {
  ChangesetChange,
  ChangesetRecord,
  ChangesetStore,
  ChangesetSummary,
  StagedObjectRecord,
} from "../src/core/ports.js";

/** Every method as a mock — completeness is compiler-enforced. */
export type MockChangesetStore = { [K in keyof ChangesetStore]: Mock } & {
  /** Put a changeset with these objects into the store, as stored. */
  seed(record: ChangesetRecord, objects?: StagedObjectRecord[]): void;
  /** The objects stored for a changeset, by first touch. */
  stored(id: string): StagedObjectRecord[];
};

interface Held {
  record: ChangesetRecord;
  objects: Map<string, StagedObjectRecord>;
}

const copy = (object: StagedObjectRecord): StagedObjectRecord => ({
  ...object,
  values: object.values.map((value) => ({ ...value })),
});

export function createMockChangesetStore(): MockChangesetStore {
  const held = new Map<string, Held>();
  let clock = Date.now();
  const tick = (): Date => new Date((clock += 1000));

  const view = (h: Held): ChangesetRecord => ({ ...h.record, objectCount: h.objects.size });
  const byTouch = (h: Held): StagedObjectRecord[] =>
    [...h.objects.values()]
      .sort((a, b) => a.firstTouchedAt.getTime() - b.firstTouchedAt.getTime() || a.objectId.localeCompare(b.objectId))
      .map(copy);
  const bump = (h: Held): void => {
    h.record = { ...h.record, version: h.record.version + 1, lastChangeAt: new Date() };
  };

  const apply = (h: Held, change: ChangesetChange): void => {
    for (const id of change.removeObjects ?? []) h.objects.delete(id);
    for (const { objectId, propertyKey } of change.removeValues ?? []) {
      const object = h.objects.get(objectId);
      if (object !== undefined) object.values = object.values.filter((value) => value.propertyKey !== propertyKey);
    }
    for (const object of change.objects ?? []) {
      const existing = h.objects.get(object.objectId);
      if (existing !== undefined) existing.action = object.action;
      else h.objects.set(object.objectId, { ...object, firstTouchedAt: tick(), values: [] });
    }
    for (const { objectId, ...value } of change.values ?? []) {
      const object = h.objects.get(objectId)!;
      object.values = [...object.values.filter((v) => v.propertyKey !== value.propertyKey), value].sort((a, b) =>
        a.propertyKey.localeCompare(b.propertyKey),
      );
    }
  };

  const store: MockChangesetStore = {
    seed(record, objects = []) {
      held.set(record.id, { record, objects: new Map(objects.map((object) => [object.objectId, copy(object)])) });
    },
    stored(id) {
      const h = held.get(id);
      return h === undefined ? [] : byTouch(h);
    },
    start: vi.fn(async ({ id, lensId, rulesetKey, note }) => {
      const numbers = [...held.values()].filter((h) => h.record.lensId === lensId).map((h) => h.record.number);
      const now = new Date();
      const record: ChangesetRecord = {
        id,
        lensId,
        number: Math.max(0, ...numbers) + 1,
        rulesetKey,
        version: 1,
        note,
        submittedAt: null,
        createdAt: now,
        lastChangeAt: now,
        objectCount: 0,
      };
      held.set(id, { record, objects: new Map() });
      return { ...record };
    }),
    get: vi.fn(async (id: string, lensId: string, rulesetKey: string | null) => {
      const h = held.get(id);
      if (h === undefined || h.record.lensId !== lensId) return null;
      if (rulesetKey !== null && h.record.rulesetKey !== rulesetKey) return null;
      return view(h);
    }),
    list: vi.fn(async (lensId: string, rulesetKey: string | null) =>
      [...held.values()]
        .filter((h) => h.record.lensId === lensId && (rulesetKey === null || h.record.rulesetKey === rulesetKey))
        .sort((a, b) => a.record.number - b.record.number)
        .map((h): ChangesetSummary => {
          const operations: Record<string, number> = {};
          for (const object of h.objects.values()) {
            const operation = `${object.action}_${object.kind}`;
            operations[operation] = (operations[operation] ?? 0) + 1;
          }
          const typeKeys = [...new Set([...h.objects.values()].map((object) => object.typeKey))].sort();
          return { ...view(h), operations, typeKeys };
        }),
    ),
    page: vi.fn(async (id: string, offset: number, limit: number) => {
      const h = held.get(id);
      return h === undefined ? [] : byTouch(h).slice(offset, offset + limit);
    }),
    objects: vi.fn(async (id: string, objectIds: string[]) => {
      const h = held.get(id);
      return h === undefined ? [] : byTouch(h).filter((object) => objectIds.includes(object.objectId));
    }),
    relationsAt: vi.fn(async (id: string, entityId: string) => {
      const h = held.get(id);
      if (h === undefined) return [];
      return byTouch(h)
        .filter((object) => object.kind === "relation" && (object.fromId === entityId || object.toId === entityId))
        .map((object) => object.objectId);
    }),
    stagedBytes: vi.fn(async (id: string) => {
      const h = held.get(id);
      if (h === undefined) return 0;
      return [...h.objects.values()].reduce((sum, o) => sum + o.values.reduce((s, v) => s + v.bytes, 0), 0);
    }),
    apply: vi.fn(async (id: string, expectedVersion: number, change: ChangesetChange) => {
      const h = held.get(id);
      if (h === undefined || h.record.submittedAt !== null || h.record.version !== expectedVersion) return null;
      bump(h);
      apply(h, change);
      return view(h);
    }),
    submit: vi.fn(async (id: string, expectedVersion: number, note: string | null) => {
      const h = held.get(id);
      if (h === undefined || h.record.submittedAt !== null || h.record.version !== expectedVersion) return null;
      bump(h);
      h.record = { ...h.record, submittedAt: new Date(), note };
      return view(h);
    }),
    unsubmit: vi.fn(async (id: string, note: string) => {
      const h = held.get(id);
      if (h === undefined || h.record.submittedAt === null) return null;
      bump(h);
      h.record = { ...h.record, submittedAt: null, note };
      return view(h);
    }),
    discard: vi.fn(async (id: string) => {
      const h = held.get(id);
      if (h === undefined || h.record.submittedAt !== null) return false;
      return held.delete(id);
    }),
    touch: vi.fn(async (id: string) => {
      const h = held.get(id);
      if (h !== undefined) h.record = { ...h.record, lastChangeAt: new Date() };
    }),
    sweep: vi.fn(async (olderThan: Date) => {
      let swept = 0;
      for (const [id, h] of held) {
        if (h.record.submittedAt === null && h.record.lastChangeAt < olderThan) {
          held.delete(id);
          swept += 1;
        }
      }
      return swept;
    }),
    lockForCommit: vi.fn(async (id: string) => {
      const h = held.get(id);
      return h === undefined ? null : view(h);
    }),
    deleteCommitted: vi.fn(async (id: string) => {
      held.delete(id);
    }),
  };
  return store;
}
