/**
 * The entities an assistant's turn met, as every assistant kind streams
 * them: one shared `entities` event of cards and the stored relations
 * between them, beside the kind's own events and never inside them. A card
 * names a real entity the lens shows — a type key and an id the client can
 * open — with a label and a few visible fields for people to read.
 *
 * Refs (`E1`, `E2`, …) are unique within one turn and never reused for
 * another entity; a later card with the same ref replaces the earlier one.
 * The answer may cite a card by its ref only when the card is evidence.
 *
 * Only what the lens shows; document properties never (they are passages,
 * not fields).
 */

import type { Row } from "../../core/ports.js";
import type { StreamEvent } from "../chatStream.js";
import type { EntityTypeDef, SchemaCacheValue } from "../schemaCache.js";

/** One entity as the client shows it. */
export interface EntityCard {
  /** `E1`, `E2`, … in the order the turn met them; unique within a turn. */
  ref: string;
  id: string;
  /** The entity type's key. */
  type: string;
  typeName: string;
  label: string;
  fields: { name: string; value: string }[];
  /** Handed to the model that writes the answer; only evidence can be cited. */
  evidence: boolean;
  /** Why the entity is here, in plain words. */
  reason?: string;
  /** Where a graph walk met it (`anchor`, `reached`, `focus`); kinds that do not walk send none. */
  role?: string;
  /** Distance from the nearest anchor, for kinds that walk. */
  hop?: number;
}

/** A stored relation between two cards of the same turn, directed as stored. */
export interface EntityLink {
  /** The stored relation's id; a link's identity. */
  id: string;
  /** Refs of cards of this turn. */
  from: string;
  to: string;
  /** The relation type's key. */
  type: string;
  label: string;
}

/** The shared stream event: cards upserted by ref, links by id. */
export function entitiesEvent(entities: EntityCard[], links: EntityLink[]): StreamEvent {
  return { type: "entities", entities, links };
}

/** One turn's refs: an entity keeps the first ref it got; a new one takes the next. */
export class EntityRefs {
  private readonly refs = new Map<string, string>();

  /** The entity's ref, allocated on first sight. */
  ref(type: string, id: string): string {
    const key = `${type}\u0000${id}`;
    let ref = this.refs.get(key);
    if (ref === undefined) {
      ref = `E${this.refs.size + 1}`;
      this.refs.set(key, ref);
    }
    return ref;
  }
}

/** Fields one card carries at most. */
const CARD_FIELDS = 6;

/** Characters of one field value. */
const FIELD_CHARACTERS = 200;

function short(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** A property value as short text; null when it has none. */
function asText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

/** The entity's label: its name property's value, else its id. */
export function entityLabel(entity: Row, type: EntityTypeDef): string {
  const name = type.nameProperty === null ? null : asText(entity[type.nameProperty]);
  return name ?? String(entity._id);
}

/** Up to `CARD_FIELDS` visible, non-document, non-name fields with a value, in schema order. */
export function entityFields(entity: Row, type: EntityTypeDef): { name: string; value: string }[] {
  const fields: { name: string; value: string }[] = [];
  for (const property of Object.values(type.properties)) {
    if (fields.length === CARD_FIELDS) break;
    if (property.dataType === "document" || property.key === type.nameProperty) continue;
    const value = asText(entity[property.key]);
    if (value !== null) fields.push({ name: property.displayName, value: short(value, FIELD_CHARACTERS) });
  }
  return fields;
}

/** The card of an entity row the lens projected; its type must be one the lens shows. */
export function entityCard(
  ref: string,
  entity: Row,
  typeKey: string,
  type: EntityTypeDef,
  evidence: boolean,
): EntityCard {
  return {
    ref,
    id: String(entity._id),
    type: typeKey,
    typeName: type.displayName,
    label: entityLabel(entity, type),
    fields: entityFields(entity, type),
    evidence,
  };
}

/** A relation type's display name as a phrase: "Works On" → "works on";
 * acronyms stay ("Has KPI" → "has KPI"). */
export function relationLabel(lens: SchemaCacheValue, type: string): string {
  const name = lens.relationTypes[type]?.displayName ?? type;
  return name
    .split(" ")
    .map((word) => (word.length > 1 && word === word.toUpperCase() ? word : word.toLowerCase()))
    .join(" ");
}
