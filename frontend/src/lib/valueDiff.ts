/**
 * One value's change from before to after, worked out for display: a long
 * or multi-line text as a word diff inside its changed lines, with long
 * unchanged stretches folded away, a list as the
 * items kept, removed and added, a short text as before → after, and two
 * values of different kinds side by side.
 *
 * No React, no I/O — unit-tested with `node --test`.
 */

/** A value the diff shows: a text, a list of texts, or none. */
export type DiffValue = string | readonly string[] | null | undefined

/** A stretch of text, kept, removed or added. */
export interface DiffPart {
  kind: 'same' | 'removed' | 'added'
  text: string
}

/** A list item, kept, removed or added. */
export interface DiffItem {
  kind: 'same' | 'removed' | 'added'
  value: string
}

/** Unchanged lines left out of a text diff, by count. */
export interface DiffFold {
  kind: 'fold'
  lines: number
}

/** How a change shows. */
export type ValueChange =
  | { kind: 'text'; parts: Array<DiffPart | DiffFold> }
  | { kind: 'short'; before: string; after: string }
  | { kind: 'list'; items: DiffItem[] }
  | { kind: 'mixed'; before: DiffValue; after: DiffValue }

/** Unchanged lines a text diff keeps around each change; longer unchanged stretches fold. */
const CONTEXT_LINES = 2

/** A text up to this long without a line break shows as before → after; a longer one as a word diff. */
const SHORT_TEXT = 60

/**
 * Above this many compared pairs a stretch is shown as removed, then added,
 * instead of diffed: the comparison's table grows with the product of both
 * lengths, and a page must not stall on two long, wholly different texts.
 */
const MAX_PAIRS = 4_000_000

type Op = 'same' | 'removed' | 'added'

/** The steps from `a` to `b`, by longest common subsequence; a removal comes before the addition that replaces it. */
function diffSequence(a: readonly string[], b: readonly string[]): Array<{ op: Op; value: string }> {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }

  const steps: Array<{ op: Op; value: string }> = a.slice(0, start).map((value) => ({ op: 'same', value }))
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  const n = midA.length
  const m = midB.length
  if (n * m > MAX_PAIRS) {
    for (const value of midA) steps.push({ op: 'removed', value })
    for (const value of midB) steps.push({ op: 'added', value })
  } else {
    // lcs[i * (m + 1) + j]: the longest common subsequence of midA[i..] and midB[j..].
    const width = m + 1
    const lcs = new Uint32Array((n + 1) * width)
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * width + j] = midA[i] === midB[j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) { steps.push({ op: 'same', value: midA[i] }); i++; j++ }
      else if (j >= m || (i < n && lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])) { steps.push({ op: 'removed', value: midA[i] }); i++ }
      else { steps.push({ op: 'added', value: midB[j] }); j++ }
    }
  }
  for (const value of a.slice(endA)) steps.push({ op: 'same', value })
  return steps
}

/** Parts with neighbours of the same kind joined, empty ones dropped. */
function joined(parts: DiffPart[]): DiffPart[] {
  const out: DiffPart[] = []
  for (const part of parts) {
    if (part.text === '') continue
    const last = out.at(-1)
    if (last !== undefined && last.kind === part.kind) last.text += part.text
    else out.push({ ...part })
  }
  return out
}

/**
 * Each changed stretch as its whole removed text, then its whole added text.
 * Whitespace alone between two changes counts as changed, so a rewritten
 * phrase reads as the old phrase and the new one, not as interleaved words.
 */
function readable(parts: DiffPart[]): DiffPart[] {
  const out: DiffPart[] = []
  let removed = ''
  let added = ''
  const flush = () => {
    out.push({ kind: 'removed', text: removed }, { kind: 'added', text: added })
    removed = ''
    added = ''
  }
  parts.forEach((part, index) => {
    const next = parts[index + 1]
    const between = (removed !== '' || added !== '') && next !== undefined && next.kind !== 'same'
    if (part.kind === 'same' && !(between && /^\s+$/.test(part.text))) {
      flush()
      out.push(part)
    } else {
      if (part.kind !== 'added') removed += part.text
      if (part.kind !== 'removed') added += part.text
    }
  })
  flush()
  return joined(out)
}

/** A text's words, runs of whitespace and single other characters, in order. */
const words = (text: string): string[] => text.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) ?? []

/** A text's lines, each with its line break. */
const lines = (text: string): string[] => text.split(/(?<=\n)/).filter((line) => line !== '')

/** The word diff of two texts. */
function diffWords(before: string, after: string): DiffPart[] {
  return readable(diffSequence(words(before), words(after)).map(({ op, value }) => ({ kind: op, text: value })))
}

/**
 * The diff of two texts: the lines both keep, and inside each run of
 * changed lines the words removed and added.
 */
export function diffText(before: string, after: string): DiffPart[] {
  const parts: DiffPart[] = []
  let removed = ''
  let added = ''
  const flush = () => {
    parts.push(...diffWords(removed, added))
    removed = ''
    added = ''
  }
  for (const { op, value } of diffSequence(lines(before), lines(after))) {
    if (op === 'same') { flush(); parts.push({ kind: 'same', text: value }) }
    else if (op === 'removed') removed += value
    else added += value
  }
  flush()
  return joined(parts)
}

/**
 * A text diff with each unchanged stretch cut to the lines around its
 * changes, `context` before and after; the lines between fold. A stretch at
 * the start or end keeps only the lines next to a change; a text without any
 * change stays whole.
 */
export function foldUnchanged(parts: DiffPart[], context = CONTEXT_LINES): Array<DiffPart | DiffFold> {
  if (parts.every((part) => part.kind === 'same')) return parts
  return parts.flatMap((part, index): Array<DiffPart | DiffFold> => {
    if (part.kind !== 'same') return [part]
    // A stretch's first piece ends the line of the change before it, its last starts the line of the change after it.
    const pieces = part.text.split(/(?<=\n)/)
    const head = index > 0 ? context + 1 : 0
    const tail = index < parts.length - 1 ? context + 1 : 0
    const hidden = pieces.length - head - tail
    if (hidden < 2) return [part]
    const kept = (text: string): DiffPart[] => (text === '' ? [] : [{ kind: 'same', text }])
    return [
      ...kept(pieces.slice(0, head).join('')),
      { kind: 'fold', lines: hidden },
      ...kept(pieces.slice(pieces.length - tail).join('')),
    ]
  })
}

/**
 * The diff of two lists as sets: the items of `before` in their order, kept
 * or removed, then the items only `after` has, in its order.
 */
export function diffList(before: readonly string[], after: readonly string[]): DiffItem[] {
  const items: DiffItem[] = []
  const seen = new Set<string>()
  for (const value of before) {
    if (seen.has(value)) continue
    seen.add(value)
    items.push({ kind: after.includes(value) ? 'same' : 'removed', value })
  }
  for (const value of after) {
    if (seen.has(value)) continue
    seen.add(value)
    items.push({ kind: 'added', value })
  }
  return items
}

const isList = (value: DiffValue): value is readonly string[] => Array.isArray(value)

/**
 * How the change of one value shows. Texts and lists compare with none
 * (null or undefined) as empty; a text and a list show side by side.
 */
export function valueChange(before: DiffValue, after: DiffValue): ValueChange {
  if (isList(before) || isList(after)) {
    if (typeof before === 'string' || typeof after === 'string') return { kind: 'mixed', before, after }
    return { kind: 'list', items: diffList(isList(before) ? before : [], isList(after) ? after : []) }
  }
  const b = before ?? ''
  const a = after ?? ''
  const short = (text: string) => text.length <= SHORT_TEXT && !text.includes('\n')
  if (short(b) && short(a)) return { kind: 'short', before: b, after: a }
  return { kind: 'text', parts: foldUnchanged(diffText(b, a)) }
}

/** Any value as a `DiffValue`: texts and lists of texts as they are, anything else as its text. */
export function toDiffValue(value: unknown): DiffValue {
  if (value === null || value === undefined || typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(String)
  return String(value)
}
