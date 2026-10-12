/**
 * The evidence board of one turn: every entity the turn came across, once,
 * with a stable ref (`E1`, `E2`, … in discovery order), how it got there,
 * and the relations seen between them. What the sidebar shows and what the
 * answer model may cite.
 */

import type { Row } from "../../../../core/ports.js";
import type { SchemaCacheValue } from "../../../schemaCache.js";
import { entityCard, EntityRefs, relationLabel, type EntityCard, type EntityLink } from "../../entities.js";

/** A card of the walk: the shared card with where the walk met it. */
export type WalkCard = EntityCard & {
  role: "anchor" | "reached" | "focus";
  /** Distance from the nearest anchor. */
  hop: number;
  reason: string;
};

export interface BoardNode {
  card: WalkCard;
  /** The ref of the entity this one was reached from; none for an anchor or focus. */
  parent: string | null;
}

export class Board {
  private readonly byId = new Map<string, BoardNode>();
  private readonly refs = new EntityRefs();
  private readonly linkIds = new Set<string>();
  readonly links: EntityLink[] = [];

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
    role: WalkCard["role"],
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
      card: { ...entityCard(this.refs.ref(typeKey, id), entity, typeKey, type, false), role, hop, reason },
      parent,
    };
    this.byId.set(id, node);
    return node;
  }

  /** Records a stored relation between two board entities, once per relation id. */
  link(id: string, from: string, to: string, type: string): void {
    if (this.linkIds.has(id)) return;
    this.linkIds.add(id);
    this.links.push({ id, from, to, type, label: relationLabel(this.lens, type) });
  }

  /** The links among evidence entities. */
  evidenceLinks(): EntityLink[] {
    const evidence = new Set(this.nodes().filter((n) => n.card.evidence).map((n) => n.card.ref));
    return this.links.filter((link) => evidence.has(link.from) && evidence.has(link.to));
  }
}
