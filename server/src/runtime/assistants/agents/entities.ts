/**
 * The entities an agent's turn met, read off its tool results for the
 * shared `entities` event (`../entities.ts`). Tools stay unaware of cards:
 * the runtime reads a successful result by tool name, after the tool's
 * `agent.tool_result` event. Only the entity tools yield cards — every
 * other tool yields none, and so does an `{error}` result, which holds no
 * entity row.
 *
 * Results are lens-projected already; an entity whose type the lens does
 * not show is skipped all the same (a neighbour may be of such a type), and
 * so is a relation the lens does not show or whose ends are not both cards.
 * Every card is evidence: the tool result goes to the model that answers.
 */

import type { Row } from "../../../core/ports.js";
import type { SchemaCacheValue } from "../../schemaCache.js";
import {
  TOOL_GET_ENTITY,
  TOOL_GET_NEIGHBORS,
  TOOL_LIST_ENTITIES,
  TOOL_SEARCH,
  TOOL_SEARCH_DOCUMENTS,
} from "../../toolNames.js";
import {
  entityCard,
  EntityRefs,
  relationLabel,
  type EntityCard,
  type EntityLink,
} from "../entities.js";

export interface FoundEntities {
  entities: EntityCard[];
  links: EntityLink[];
}

/** The cards and links one successful tool result shows; empty for any other tool. */
export function toolEntities(
  tool: string,
  args: Row,
  result: unknown,
  lens: SchemaCacheValue,
  refs: EntityRefs,
): FoundEntities {
  const found: FoundEntities = { entities: [], links: [] };
  const cards = new Map<string, EntityCard>();

  /** The entity's card, made once per result; null when the lens does not show its type. */
  const card = (row: Row | undefined, typeKey: unknown): EntityCard | null => {
    const type = typeof typeKey === "string" ? lens.entityTypes[typeKey] : undefined;
    if (type === undefined || row?._id === undefined) return null;
    const ref = refs.ref(typeKey as string, String(row._id));
    let made = cards.get(ref);
    if (made === undefined) {
      made = entityCard(ref, row, typeKey as string, type, true);
      cards.set(ref, made);
      found.entities.push(made);
    }
    return made;
  };

  const value = (result ?? {}) as Row;
  switch (tool) {
    case TOOL_GET_ENTITY:
      card(value, args.entity_type_key);
      break;
    case TOOL_LIST_ENTITIES:
      for (const item of (value.items ?? []) as Row[]) card(item, args.entity_type_key);
      break;
    case TOOL_SEARCH:
    case TOOL_SEARCH_DOCUMENTS:
      // A search names its entities: the name and identity properties make the card.
      for (const { entity } of (value.items ?? []) as { entity: Row }[]) {
        const type = lens.entityTypes[String(entity._entityTypeKey)];
        const nameProperty = type?.nameProperty ?? null;
        const named = nameProperty === null ? {} : { [nameProperty]: entity.name };
        card({ _id: entity._id, ...(entity.identity as Row | undefined), ...named }, entity._entityTypeKey);
      }
      break;
    case TOOL_GET_NEIGHBORS: {
      const centre = card(value.entity as Row | undefined, args.entity_type_key);
      for (const { relation, entity } of (value.neighbors ?? []) as { relation: Row; entity: Row }[]) {
        const neighbour = card(entity, entity._entityTypeKey);
        const type = relation._relationTypeKey;
        if (
          centre === null || neighbour === null || relation._id === undefined ||
          typeof type !== "string" || !(type in lens.relationTypes)
        ) {
          continue;
        }
        const outgoing = relation.direction === "outgoing";
        found.links.push({
          id: String(relation._id),
          from: outgoing ? centre.ref : neighbour.ref,
          to: outgoing ? neighbour.ref : centre.ref,
          type,
          label: relationLabel(lens, type),
        });
      }
      break;
    }
  }
  return found;
}

/** One turn's entities: its refs, and what it has sent — each card and link goes out once. */
export class TurnEntities {
  private readonly refs = new EntityRefs();
  private readonly sentCards = new Set<string>();
  private readonly sentLinks = new Set<string>();

  constructor(private readonly lens: SchemaCacheValue) {}

  /** What a successful tool result shows that the turn has not sent yet, now counted as sent. */
  unsent(tool: string, args: Row, result: unknown): FoundEntities {
    const found = toolEntities(tool, args, result, this.lens, this.refs);
    const entities: EntityCard[] = [];
    for (const card of found.entities) {
      if (this.sentCards.has(card.ref)) continue;
      this.sentCards.add(card.ref);
      entities.push(card);
    }
    const links: EntityLink[] = [];
    for (const link of found.links) {
      if (this.sentLinks.has(link.id)) continue;
      this.sentLinks.add(link.id);
      links.push(link);
    }
    return { entities, links };
  }
}
