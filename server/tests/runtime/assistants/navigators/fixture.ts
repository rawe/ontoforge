/**
 * A lens and an in-memory graph for navigator unit tests: people who
 * manage each other, work on projects, belong to teams; projects require
 * skills. `FakeReader` answers the navigator's reader port from the graph
 * and records every call.
 */

import type { Row } from "../../../../src/core/ports.js";
import type { SchemaCacheValue } from "../../../../src/runtime/schemaCache.js";
import type { GraphReader, Neighbor, SearchHitRow } from "../../../../src/runtime/assistants/kinds/navigator/reader.js";

const property = (key: string, displayName: string, dataType = "string") => ({
  key,
  displayName,
  description: null,
  dataType,
  required: false,
  defaultValue: null,
});
const type = (key: string, displayName: string, properties: ReturnType<typeof property>[]) => ({
  key,
  displayName,
  description: `${displayName}s of the org`,
  nameProperty: "name",
  properties: Object.fromEntries(properties.map((p) => [p.key, p])),
});
const relation = (key: string, displayName: string, from: string, to: string) => ({
  key,
  displayName,
  description: null,
  fromEntityTypeKey: from,
  toEntityTypeKey: to,
  properties: {},
});

export const LENS = {
  lensId: "lens-1",
  lensKey: "org",
  lensName: "Org",
  lensDescription: null,
  entityTypes: {
    person: type("person", "Person", [
      property("name", "Name"),
      property("email", "Email"),
      property("level", "Level", "integer"),
      property("bio", "Bio", "document"),
    ]),
    project: type("project", "Project", [property("name", "Name"), property("status", "Status")]),
    team: type("team", "Team", [property("name", "Name")]),
    skill: type("skill", "Skill", [property("name", "Name")]),
  },
  relationTypes: {
    manages: relation("manages", "Manages", "person", "person"),
    works_on: relation("works_on", "Works On", "person", "project"),
    member_of: relation("member_of", "Member Of", "person", "team"),
    requires: relation("requires", "Requires", "project", "skill"),
    has_kpi: relation("has_kpi", "Has KPI", "project", "team"),
  },
} as unknown as SchemaCacheValue;

export const entity = (id: string, type: string, name: string, more: Row = {}): Row => ({
  _id: id,
  _entityTypeKey: type,
  name,
  ...more,
});

export interface Edge {
  type: string;
  from: string;
  to: string;
  /** The stored relation's id; `type:from:to` when not given. */
  id?: string;
}

export const edgeId = (edge: Edge): string => edge.id ?? `${edge.type}:${edge.from}:${edge.to}`;

/** Lena manages Kira and Omar, Kira manages Tom; Kira works on Apollo,
 * Omar on Zeus; Kira is in Platform, Omar in Data; Apollo requires
 * Kubernetes, Zeus Python. */
export function orgGraph(): { entities: Row[]; edges: Edge[] } {
  return {
    entities: [
      entity("lena", "person", "Lena Vogt", { email: "lena@corvane.example", level: 6, bio: "Long text" }),
      entity("kira", "person", "Kira Novak", { email: "kira@corvane.example" }),
      entity("omar", "person", "Omar Haddad"),
      entity("tom", "person", "Tom Berg"),
      entity("apollo", "project", "Apollo", { status: "active" }),
      entity("zeus", "project", "Zeus", { status: "paused" }),
      entity("platform", "team", "Platform"),
      entity("data", "team", "Data"),
      entity("k8s", "skill", "Kubernetes"),
      entity("python", "skill", "Python"),
    ],
    edges: [
      { type: "manages", from: "lena", to: "kira" },
      { type: "manages", from: "lena", to: "omar" },
      { type: "manages", from: "kira", to: "tom" },
      { type: "works_on", from: "kira", to: "apollo" },
      { type: "works_on", from: "omar", to: "zeus" },
      { type: "member_of", from: "kira", to: "platform" },
      { type: "member_of", from: "omar", to: "data" },
      { type: "requires", from: "apollo", to: "k8s" },
      { type: "requires", from: "zeus", to: "python" },
    ],
  };
}

const lower = (value: unknown) => String(value).toLowerCase();

/** The reader port over an in-memory graph. `search` defaults to a
 * substring match on the name; a test replaces it with `searchWith`. */
export class FakeReader implements GraphReader {
  readonly byId: Map<string, Row>;
  readonly calls = {
    search: [] as [string, string | null, boolean, number][],
    list: [] as [string, string, number][],
    entity: [] as [string, string][],
    neighbors: [] as [string, string, number][],
  };
  searchWith: ((query: string, type: string | null) => SearchHitRow[]) | null = null;

  constructor(entities: Row[], readonly edges: Edge[]) {
    this.byId = new Map(entities.map((e) => [String(e._id), e]));
  }

  async search(query: string, type: string | null, documents: boolean, limit: number): Promise<SearchHitRow[]> {
    this.calls.search.push([query, type, documents, limit]);
    if (this.searchWith) return this.searchWith(query, type).slice(0, limit);
    return [...this.byId.values()]
      .filter((e) => (type === null || e._entityTypeKey === type) && lower(e.name).includes(lower(query)))
      .slice(0, limit)
      .map((entity) => ({ entity, relativeScore: 1 }));
  }

  async list(type: string, term: string, limit: number): Promise<Row[]> {
    this.calls.list.push([type, term, limit]);
    return [...this.byId.values()]
      .filter((e) => e._entityTypeKey === type &&
        Object.values(e).some((v) => typeof v === "string" && lower(v).includes(lower(term))))
      .slice(0, limit);
  }

  async entity(type: string, id: string): Promise<Row | null> {
    this.calls.entity.push([type, id]);
    const found = this.byId.get(id);
    return found !== undefined && found._entityTypeKey === type ? found : null;
  }

  async neighbors(type: string, id: string, limit: number): Promise<Neighbor[]> {
    this.calls.neighbors.push([type, id, limit]);
    const out: Neighbor[] = [];
    for (const edge of this.edges) {
      if (edge.from === id) out.push({ relation: { _id: edgeId(edge), _relationTypeKey: edge.type, direction: "outgoing" }, entity: this.byId.get(edge.to)! });
    }
    for (const edge of this.edges) {
      if (edge.to === id) out.push({ relation: { _id: edgeId(edge), _relationTypeKey: edge.type, direction: "incoming" }, entity: this.byId.get(edge.from)! });
    }
    return out.slice(0, limit);
  }
}

export function orgReader(): FakeReader {
  const { entities, edges } = orgGraph();
  return new FakeReader(entities, edges);
}
