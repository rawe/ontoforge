/**
 * A design item's address: its `kind` and, owner first and the item last,
 * the keys that name it, each field named after the item it names — the
 * server's `DesignAddress`. A kind fixes its fields: all present, nothing
 * else. The item's own key is null for a new item, not saved yet; an
 * owner's never is. The focus and a draft's target are addresses.
 *
 * No React, no I/O — unit-tested with `node --test`.
 */

export type DesignAddress =
  | { kind: 'entityType'; entityType: string | null }
  | { kind: 'relationType'; relationType: string | null }
  | { kind: 'entityTypeProperty'; entityType: string; property: string | null }
  | { kind: 'relationTypeProperty'; relationType: string; property: string | null }
  | { kind: 'lens'; lens: string | null }
  | { kind: 'agent'; lens: string; agent: string | null }
  | { kind: 'searchIndex'; searchIndex: string | null }

export type AddressKind = DesignAddress['kind']

/** Each kind's fields, owner first, the item last. */
const FIELDS: Record<AddressKind, readonly string[]> = {
  entityType: ['entityType'],
  relationType: ['relationType'],
  entityTypeProperty: ['entityType', 'property'],
  relationTypeProperty: ['relationType', 'property'],
  lens: ['lens'],
  agent: ['lens', 'agent'],
  searchIndex: ['searchIndex'],
}

const WHAT: Record<AddressKind, string> = {
  entityType: 'entity type',
  relationType: 'relation type',
  entityTypeProperty: 'entity type property',
  relationTypeProperty: 'relation type property',
  lens: 'lens',
  agent: 'agent',
  searchIndex: 'search index',
}

const valuesOf = (address: DesignAddress) =>
  FIELDS[address.kind].map((field) => (address as unknown as Record<string, string | null>)[field])

/** One string per address, for comparing and as a dependency: equal for the same kind and keys. */
export function addressId(address: DesignAddress): string {
  return JSON.stringify([address.kind, ...valuesOf(address)])
}

/** The address an id of `addressId` stands for. */
export function addressFromId(id: string): DesignAddress {
  const [kind, ...values] = JSON.parse(id) as [AddressKind, ...(string | null)[]]
  return Object.fromEntries([['kind', kind], ...FIELDS[kind].map((field, i) => [field, values[i]])]) as DesignAddress
}

/** Whether two addresses name the same item: same kind and keys, two new items alike. */
export function sameAddress(a: DesignAddress, b: DesignAddress): boolean {
  return addressId(a) === addressId(b)
}

const isKey = (value: unknown): value is string => typeof value === 'string' && value !== ''

/** The address `value` holds — a tool result's target — or null if it is none. */
export function addressOf(value: unknown): DesignAddress | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const kind = record.kind
  if (typeof kind !== 'string' || !Object.hasOwn(FIELDS, kind)) return null
  const fields = FIELDS[kind as AddressKind]
  if (Object.keys(record).length !== fields.length + 1) return null
  const last = fields.length - 1
  const fits = fields.every((field, i) => isKey(record[field]) || (i === last && record[field] === null))
  return fits ? (Object.fromEntries([['kind', kind], ...fields.map((field) => [field, record[field]])]) as DesignAddress) : null
}

/** The item's own key; null for a new item. */
export function itemKey(address: DesignAddress): string | null {
  return valuesOf(address).at(-1) ?? null
}

/** The chip's text: the keys joined by `.` and what the item is, `new …` for a new one. */
export function addressLabel(address: DesignAddress): { name: string; what: string } {
  const keys = valuesOf(address).filter((value) => value !== null)
  return { name: keys.join('.'), what: itemKey(address) === null ? `new ${WHAT[address.kind]}` : WHAT[address.kind] }
}
