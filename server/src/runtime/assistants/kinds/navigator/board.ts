/**
 * The evidence board of one turn: every entity the turn came across, once,
 * with a stable ref (`E1`, `E2`, … in discovery order), how it got there,
 * and the relations seen between them. What the sidebar shows and what the
 * answer model may cite.
 */

import type { Row } from "../../../../core/ports.js";
import type { SchemaCacheValue } from "../../../schemaCache.js";
import { entityFields, entityLabel } from "../../kit/cards.js";
import type { CardLink, EntityCard } from "../../kit/trace.js";

export interface BoardNode {
  card: EntityCard;
  /** The ref of the entity this one was reached from; none for an anchor or focus. */
  parent: string | null;
}

export class Board {
  private readonly byId = new Map<string, BoardNode>();
  private readonly linkKeys = new Set<string>();
  readonly links: CardLink[] = [];

  constructor(private readonly lens: SchemaCacheValue) {}

  get size(): number {
    return this.byId.size;
  }

  node(id: string): BoardNode | undefined {
    return this.byId.get(id);
  }

  nodes(): BoardNode[] {
    return [...this.byId.values()];
  }

  byRef(ref: string): BoardNode | undefined {
    return this.nodes().find((node) => node.card.ref === ref);
  }

  /**
   * Adds an entity the lens shows, or returns the node it already has. An
   * entity met again keeps its first ref; it moves closer when reached by a
   * shorter path, and an anchor stays an anchor.
   */
  add(
    entity: Row,
    role: EntityCard["role"],
    hop: number,
    reason: string,
    parent: string | null,
  ): BoardNode | null {
    const id = String(entity._id);
    const typeKey = String(entity._entityTypeKey ?? "");
    const type = this.lens.entityTypes[typeKey];
    if (type === undefined) return null;
    const known = this.byId.get(id);
    if (known !== undefined) {
      if (hop < known.card.hop && known.card.role === "reached") {
        known.card.hop = hop;
        known.card.reason = reason;
        known.parent = parent;
      }
      return known;
    }
    const node: BoardNode = {
      card: {
        ref: `E${this.byId.size + 1}`,
        id,
        type: typeKey,
        typeName: type.displayName,
        label: entityLabel(entity, type),
        role,
        hop,
        reason,
        fields: entityFields(entity, type),
        evidence: false,
      },
      parent,
    };
    this.byId.set(id, node);
    return node;
  }

  /** Records a relation between two board entities, once. */
  link(from: string, to: string, type: string): void {
    const key = `${from}|${type}|${to}`;
    if (this.linkKeys.has(key)) return;
    this.linkKeys.add(key);
    this.links.push({ from, to, type, label: relationLabel(this.lens, type) });
  }

  /** The links among evidence entities. */
  evidenceLinks(): CardLink[] {
    const evidence = new Set(this.nodes().filter((n) => n.card.evidence).map((n) => n.card.ref));
    return this.links.filter((link) => evidence.has(link.from) && evidence.has(link.to));
  }
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
