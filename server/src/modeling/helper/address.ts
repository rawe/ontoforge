/**
 * A design item's address: its `kind` and, owner first and the item last,
 * the keys that name it, each field named after the item it names. A kind
 * fixes its fields: all present, nothing else. The item's own key is null
 * for a new item, not saved yet; an owner's never is. The Studio helper
 * takes the page's focus and a draft's target in this form; a search
 * index is a custom one (a managed index is never edited).
 */

import { z } from "zod";

import { MAX_KEY_LENGTH } from "../../core/schemas.js";

const Key = z.string().min(1).max(MAX_KEY_LENGTH);
const Item = Key.nullable();

export const AgentAddress = z.object({ kind: z.literal("agent"), lens: Key, agent: Item }).strict();
export type AgentAddress = z.infer<typeof AgentAddress>;

export const DesignAddress = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("entityType"), entityType: Item }).strict(),
  z.object({ kind: z.literal("relationType"), relationType: Item }).strict(),
  z.object({ kind: z.literal("entityTypeProperty"), entityType: Key, property: Item }).strict(),
  z.object({ kind: z.literal("relationTypeProperty"), relationType: Key, property: Item }).strict(),
  z.object({ kind: z.literal("lens"), lens: Item }).strict(),
  AgentAddress,
  z.object({ kind: z.literal("searchIndex"), searchIndex: Item }).strict(),
]);
export type DesignAddress = z.infer<typeof DesignAddress>;

/** Each kind's fields, owner first, the item last. */
const FIELDS: Record<DesignAddress["kind"], readonly string[]> = {
  entityType: ["entityType"],
  relationType: ["relationType"],
  entityTypeProperty: ["entityType", "property"],
  relationTypeProperty: ["relationType", "property"],
  lens: ["lens"],
  agent: ["lens", "agent"],
  searchIndex: ["searchIndex"],
};

/** The address as lines for the model: its kind, then each field in order. */
export function addressLines(address: DesignAddress): string[] {
  const fields = address as unknown as Record<string, string | null>;
  return [
    `kind: ${address.kind}`,
    ...FIELDS[address.kind].map((field) => `${field}: ${fields[field] ?? "(new, not saved yet)"}`),
  ];
}
