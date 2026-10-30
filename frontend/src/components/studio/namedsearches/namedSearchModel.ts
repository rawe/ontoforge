/**
 * Pure helpers of the named-search editor: the canonical tree a start choice
 * writes, edits of the tree at a node's path, and the server's errors placed
 * on the node they name. No React, no I/O — unit-tested with `node --test`.
 *
 * A node's path is the server's: `""` for the root, then `input`,
 * `inputs.<i>` and `filters.<i>` joined by dots (`input.inputs.1`).
 */

import type { Representation, SearchTreeNode } from '@/api/types'
import { ApiError } from '../../../api/http.ts'

export type NodeKind = SearchTreeNode['kind']
export type ResultUnit = 'entities' | 'passages'
export type Method = 'keyword' | 'semantic'

/** The URL value of a draft — outside the key pattern, so no saved key collides. */
export const NAMED_SEARCH_NEW = '_new'

/** Every kind, in the order the editor offers them. */
export const NODE_KINDS: readonly NodeKind[] = [
  'keywordSearch', 'semanticSearch', 'merge', 'fuse', 'group', 'restrict', 'filter', 'cut',
]

/** The kinds that take an input — what a node can be wrapped in. */
export const WRAP_KINDS: readonly NodeKind[] = ['merge', 'fuse', 'group', 'restrict', 'cut']

/** Each kind in plain words. */
export const KIND_LABEL: Record<NodeKind, string> = {
  keywordSearch: 'Keyword search',
  semanticSearch: 'Semantic search',
  merge: 'Merge by score',
  fuse: 'Fuse by rank',
  group: 'Group',
  restrict: 'Restrict',
  filter: 'Filter',
  cut: 'Limit',
}

/** What each kind does, with the rule that places it. */
export const KIND_HINT: Record<NodeKind, string> = {
  keywordSearch: 'Searches one index for the words of its text. $query is the caller\'s query.',
  semanticSearch: 'Searches one index by meaning of its text. $query is the caller\'s query.',
  merge: 'Rankings of one method and one text as one, by score; otherwise fuse them.',
  fuse: 'Grouped rankings as one, by rank only.',
  group: 'One item per entity or passage, kept by its best entry. Every search reaches the top through exactly one group, below every fuse.',
  restrict: 'Keeps the items whose entity meets the filter of its type; items of other types are kept.',
  filter: 'The entities of one type that meet exact conditions.',
  cut: 'Keeps the first items. Every search needs a limit above it.',
}

/* ------------------------------- start choice ------------------------------- */

/** What a new named search starts from. */
export interface StartChoice {
  unit: ResultUnit
  indices: string[]
  methods: Method[]
  limit: number
}

/** One node for a list: the node itself when alone, else the combining node. */
function combined(kind: 'merge' | 'fuse', nodes: SearchTreeNode[]): SearchTreeNode {
  return nodes.length === 1 ? nodes[0]! : { kind, inputs: nodes }
}

/**
 * The canonical tree of a start choice: `cut ← fuse ← per method: group ←
 * merge ← one search node per index`, text `$query`; a layer with a single
 * input disappears. An index searches only by the methods `modes` lists for
 * it (unlisted: every method); a method left without an index drops out.
 * Null when nothing is left to search.
 */
export function canonicalTree(
  choice: StartChoice,
  modes: Readonly<Record<string, readonly Representation[]>> = {},
): SearchTreeNode | null {
  const groups = choice.methods.flatMap((method): SearchTreeNode[] => {
    const indices = choice.indices.filter((index) => modes[index]?.includes(method) ?? true)
    if (indices.length === 0) return []
    const searches = indices.map((index): SearchTreeNode =>
      method === 'keyword'
        ? { kind: 'keywordSearch', index, text: '$query' }
        : { kind: 'semanticSearch', index, text: '$query' },
    )
    return [{ kind: 'group', key: choice.unit === 'entities' ? 'entity' : 'passage', input: combined('merge', searches) }]
  })
  if (groups.length === 0) return null
  return { kind: 'cut', input: combined('fuse', groups), limit: choice.limit }
}

/** What a new node is filled with. */
export interface NodeDefaults {
  index: string
  entityType: string
  unit: ResultUnit
}

/** A fresh node of a kind; a node that takes one input gets a grouped search below it. */
export function newNode(kind: NodeKind, defaults: NodeDefaults): SearchTreeNode {
  const grouped = (): SearchTreeNode => newNode('group', defaults)
  switch (kind) {
    case 'keywordSearch':
    case 'semanticSearch':
      return { kind, index: defaults.index, text: '$query' }
    case 'merge':
    case 'fuse':
      return { kind, inputs: [] }
    case 'group':
      return {
        kind,
        key: defaults.unit === 'entities' ? 'entity' : 'passage',
        input: newNode('keywordSearch', defaults),
      }
    case 'restrict':
      return { kind, input: grouped(), filters: [] }
    case 'filter':
      return { kind, entityType: defaults.entityType, conditions: {} }
    case 'cut':
      return { kind, input: grouped(), limit: 10 }
  }
}

/* ---------------------------------- paths ---------------------------------- */

/** A node's inputs, each with its path segment. */
export function inputsOf(node: SearchTreeNode): [string, SearchTreeNode][] {
  switch (node.kind) {
    case 'merge':
    case 'fuse':
      return node.inputs.map((input, i) => [`inputs.${i}`, input])
    case 'group':
    case 'cut':
      return [['input', node.input]]
    case 'restrict':
      return [['input', node.input], ...node.filters.map((f, i): [string, SearchTreeNode] => [`filters.${i}`, f])]
    default:
      return []
  }
}

/** The path of a node's input. */
export const childPath = (path: string, segment: string) => (path === '' ? segment : `${path}.${segment}`)

/** A path as node segments (`input`, `inputs.1`); null when it names no node. */
function segmentsOf(path: string): string[] | null {
  if (path === '') return []
  const parts = path.split('.')
  const segments: string[] = []
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === 'input') segments.push('input')
    else if ((parts[i] === 'inputs' || parts[i] === 'filters') && /^\d+$/.test(parts[i + 1] ?? '')) {
      segments.push(`${parts[i]}.${parts[i + 1]}`)
      i++
    } else return null
  }
  return segments
}

function child(node: SearchTreeNode, segment: string): SearchTreeNode | undefined {
  return inputsOf(node).find(([s]) => s === segment)?.[1]
}

/** The node at a path; undefined when the tree has none there. */
export function nodeAt(tree: SearchTreeNode, path: string): SearchTreeNode | undefined {
  const segments = segmentsOf(path)
  if (segments === null) return undefined
  let node: SearchTreeNode | undefined = tree
  for (const segment of segments) node = node === undefined ? undefined : child(node, segment)
  return node
}

/** The node with its input at a segment set to `next`. */
function withChild(node: SearchTreeNode, segment: string, next: SearchTreeNode): SearchTreeNode {
  if (segment === 'input' && 'input' in node) return { ...node, input: next }
  const [list, at] = segment.split('.')
  const i = Number(at)
  if (list === 'inputs' && 'inputs' in node) return { ...node, inputs: node.inputs.map((n, j) => (j === i ? next : n)) }
  if (list === 'filters' && node.kind === 'restrict') {
    return { ...node, filters: node.filters.map((n, j) => (j === i ? next : n)) }
  }
  return node
}

/** The tree with the node at a path replaced by `fn` of it; unchanged when the path names no node. */
export function updateAt(
  tree: SearchTreeNode,
  path: string,
  fn: (node: SearchTreeNode) => SearchTreeNode,
): SearchTreeNode {
  const segments = segmentsOf(path)
  if (segments === null || nodeAt(tree, path) === undefined) return tree
  const update = (node: SearchTreeNode, rest: string[]): SearchTreeNode => {
    if (rest.length === 0) return fn(node)
    const [segment, ...below] = rest
    return withChild(node, segment!, update(child(node, segment!)!, below))
  }
  return update(tree, segments)
}

export const replaceAt = (tree: SearchTreeNode, path: string, node: SearchTreeNode) => updateAt(tree, path, () => node)

/** The tree with a node added to the end of a list (`inputs` of a merge or fuse, `filters` of a restrict) at a path. */
export function addAt(tree: SearchTreeNode, path: string, node: SearchTreeNode): SearchTreeNode {
  return updateAt(tree, path, (parent) => {
    if (parent.kind === 'merge' || parent.kind === 'fuse') return { ...parent, inputs: [...parent.inputs, node] }
    if (parent.kind === 'restrict') return { ...parent, filters: [...parent.filters, node] }
    return parent
  })
}

/** The tree with a new node of a kind above the one at a path, that one its input. */
export function wrapAt(tree: SearchTreeNode, path: string, kind: NodeKind, defaults: NodeDefaults): SearchTreeNode {
  return updateAt(tree, path, (node) => {
    const wrapper = newNode(kind, defaults)
    if ('inputs' in wrapper) return { ...wrapper, inputs: [node] }
    if ('input' in wrapper) return { ...wrapper, input: node }
    return node
  })
}

/**
 * How the node at a path is removed: from its parent's list (`list`), by its
 * single input taking its place (`unwrap`), or not at all (null) — a search
 * or filter that is the only input of its parent, or the root without one.
 */
export function removal(tree: SearchTreeNode, path: string): 'list' | 'unwrap' | null {
  const node = nodeAt(tree, path)
  if (node === undefined) return null
  if (/(^|\.)(inputs|filters)\.\d+$/.test(path)) return 'list'
  return 'input' in node ? 'unwrap' : null
}

/** The tree without the node at a path (see `removal`); unchanged when it cannot go. */
export function removeAt(tree: SearchTreeNode, path: string): SearchTreeNode {
  const how = removal(tree, path)
  if (how === 'unwrap') return updateAt(tree, path, (node) => ('input' in node ? node.input : node))
  if (how !== 'list') return tree
  const cut = path.lastIndexOf('.', path.lastIndexOf('.') - 1)
  const parentPath = cut < 0 ? '' : path.slice(0, cut)
  const [list, at] = path.slice(cut + 1).split('.')
  const i = Number(at)
  return updateAt(tree, parentPath, (parent) => {
    if (list === 'inputs' && 'inputs' in parent) return { ...parent, inputs: parent.inputs.filter((_, j) => j !== i) }
    if (list === 'filters' && parent.kind === 'restrict') return { ...parent, filters: parent.filters.filter((_, j) => j !== i) }
    return parent
  })
}

/* ---------------------------------- reading --------------------------------- */

/** The unit a tree ranks — its first group's key, through the nodes above it; null without one. */
export function resultUnit(tree: SearchTreeNode): ResultUnit | null {
  switch (tree.kind) {
    case 'group':
      return tree.key === 'entity' ? 'entities' : 'passages'
    case 'cut':
    case 'restrict':
      return resultUnit(tree.input)
    case 'merge':
    case 'fuse':
      return tree.inputs[0] === undefined ? null : resultUnit(tree.inputs[0])
    default:
      return null
  }
}

/** The tree as it is sent: filter condition rows without a key left out. */
export function cleanTree(tree: SearchTreeNode): SearchTreeNode {
  switch (tree.kind) {
    case 'filter':
      return { ...tree, conditions: Object.fromEntries(Object.entries(tree.conditions).filter(([k]) => k.trim() !== '')) }
    case 'merge':
    case 'fuse':
      return { ...tree, inputs: tree.inputs.map(cleanTree) }
    case 'group':
    case 'cut':
      return { ...tree, input: cleanTree(tree.input) }
    case 'restrict':
      return { ...tree, input: cleanTree(tree.input), filters: tree.filters.map(cleanTree) }
    default:
      return tree
  }
}

/* ---------------------------------- errors ---------------------------------- */

/** Why a save failed: every reason as a line, and the reasons about the tree by the node they name. */
export interface PlacedErrors {
  summary: string[]
  /** Per node path, the reasons at it — a field below the node prefixed (`index: …`). */
  byNode: Record<string, string[]>
}

/** A server path in dotted form: `/tree/input` and `tree.inputs[1]` → `tree.input`, `tree.inputs.1`. */
function dotted(path: string): string {
  return path.replace(/\[(\d+)\]/g, '.$1').replace(/\//g, '.').replace(/^\.+/, '')
}

/** A server path split into the node it names and the field below it; null when it is not in the tree. */
export function nodeOfPath(path: string): { node: string; field: string } | null {
  const parts = dotted(path).split('.').filter((p) => p !== '')
  if (parts[0] !== 'tree') return null
  const node: string[] = []
  let i = 1
  while (i < parts.length) {
    if (parts[i] === 'input') {
      node.push('input')
      i += 1
    } else if ((parts[i] === 'inputs' || parts[i] === 'filters') && /^\d+$/.test(parts[i + 1] ?? '')) {
      node.push(`${parts[i]}.${parts[i + 1]}`)
      i += 2
    } else break
  }
  return { node: node.join('.'), field: parts.slice(i).join('.') }
}

/** One reason as path and message: `{path, message}`, or a string `path: message`. */
function reasonOf(entry: unknown): { path: string; message: string } {
  if (typeof entry === 'string') {
    const match = /^([\w.[\]/-]+): ([\s\S]*)$/.exec(entry)
    return match === null ? { path: '', message: entry } : { path: match[1]!, message: match[2]! }
  }
  if (entry !== null && typeof entry === 'object' && 'message' in entry && typeof entry.message === 'string') {
    return { path: 'path' in entry && typeof entry.path === 'string' ? entry.path : '', message: entry.message }
  }
  return { path: '', message: JSON.stringify(entry) }
}

/**
 * A failed save's reasons — `details.errors` (strings `path: message` or
 * `{path, message}`), else `details.fields`, else the message — each in the
 * summary, and those about the tree also on their node.
 */
export function placeErrors(error: unknown): PlacedErrors {
  let reasons: { path: string; message: string }[]
  const errors = error instanceof ApiError ? error.details?.errors : undefined
  const fields = error instanceof ApiError ? error.fieldErrors : undefined
  if (Array.isArray(errors) && errors.length > 0) reasons = errors.map(reasonOf)
  else if (fields !== undefined && Object.keys(fields).length > 0) {
    reasons = Object.entries(fields).map(([path, message]) => ({ path, message }))
  } else reasons = [{ path: '', message: error instanceof Error ? error.message : 'The request failed.' }]

  const byNode: Record<string, string[]> = {}
  for (const { path, message } of reasons) {
    const at = nodeOfPath(path)
    if (at === null) continue
    byNode[at.node] = [...(byNode[at.node] ?? []), at.field === '' ? message : `${at.field}: ${message}`]
  }
  return {
    summary: reasons.map(({ path, message }) => (path === '' ? message : `${dotted(path)}: ${message}`)),
    byNode,
  }
}
