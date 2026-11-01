import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffList, diffText, foldUnchanged, toDiffValue, valueChange, type DiffFold, type DiffPart } from '../src/lib/valueDiff.ts'

const side = (parts: DiffPart[], kind: 'removed' | 'added') => parts.filter((p) => p.kind === 'same' || p.kind === kind).map((p) => p.text).join('')

const show = (parts: DiffPart[]) => parts.map((p) => (p.kind === 'same' ? p.text : p.kind === 'removed' ? `[-${p.text}-]` : `{+${p.text}+}`)).join('')

test('diffText: a changed word inside a sentence', () => {
  const parts = diffText('You answer questions about films.', 'You answer questions about books.')
  assert.equal(show(parts), 'You answer questions about [-films-]{+books+}.')
})

test('diffText: a rewritten phrase reads as the old phrase, then the new one', () => {
  const parts = diffText('Be brief and polite.', 'Be thorough but friendly.')
  assert.equal(show(parts), 'Be [-brief and polite-]{+thorough but friendly+}.')
})

test('diffText: unchanged lines stay whole, words differ only inside changed lines', () => {
  const before = 'Rule one.\nAlways cite sources.\nRule three.\n'
  const after = 'Rule one.\nAlways cite two sources.\nRule three.\nRule four.\n'
  const parts = diffText(before, after)
  assert.equal(show(parts), 'Rule one.\nAlways cite {+two +}sources.\nRule three.\n{+Rule four.\n+}')
})

test('diffText: a removed line', () => {
  assert.equal(show(diffText('a\nb\nc', 'a\nc')), 'a\n[-b\n-]c')
})

test('diffText: from or to empty text', () => {
  assert.deepEqual(diffText('', 'New prompt.'), [{ kind: 'added', text: 'New prompt.' }])
  assert.deepEqual(diffText('Old prompt.', ''), [{ kind: 'removed', text: 'Old prompt.' }])
  assert.deepEqual(diffText('', ''), [])
})

test('diffText: equal texts are one kept part', () => {
  assert.deepEqual(diffText('Same.\nText.', 'Same.\nText.'), [{ kind: 'same', text: 'Same.\nText.' }])
})

test('diffText: both sides always rebuild the texts', () => {
  const pairs: Array<[string, string]> = [
    ['The quick brown fox\njumps over\nthe lazy dog.', 'A quick red fox\nleaps over\nthe lazy dog!\nEnd.'],
    ['  indented\n\n\nblank lines', 'indented\n\nblank  lines\n'],
    ['Ünïcödé wörds, ok?', 'Ünïcode words, ok!'],
    ['x', 'y'],
  ]
  for (const [before, after] of pairs) {
    const parts = diffText(before, after)
    assert.equal(side(parts, 'removed'), before)
    assert.equal(side(parts, 'added'), after)
    for (let i = 1; i < parts.length; i++) assert.notEqual(parts[i].kind, parts[i - 1].kind, 'neighbours differ in kind')
    assert.ok(parts.every((p) => p.text !== ''))
  }
})

test('diffText: two long, wholly different texts still diff, as removed then added', () => {
  const before = Array.from({ length: 1500 }, (_, i) => `a${i}`).join(' ')
  const after = Array.from({ length: 1500 }, (_, i) => `b${i}`).join(' ')
  const parts = diffText(before, after)
  assert.deepEqual(parts, [{ kind: 'removed', text: before }, { kind: 'added', text: after }])
})

const numbered = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `line ${from + i}\n`).join('')

const showFolded = (parts: Array<DiffPart | DiffFold>) =>
  parts.map((p) => (p.kind === 'fold' ? `<${p.lines} folded>\n` : show([p]))).join('')

test('foldUnchanged: long unchanged stretches fold to the lines around each change', () => {
  const before = numbered(1, 20)
  const after = before.replace('line 10\n', 'line ten\n')
  assert.equal(
    showFolded(foldUnchanged(diffText(before, after), 2)),
    '<7 folded>\nline 8\nline 9\nline [-10-]{+ten+}\nline 11\nline 12\n<8 folded>\n',
  )
})

test('foldUnchanged: a change mid-line keeps the rest of its line plus the context', () => {
  const before = `${numbered(1, 6)}one long line with a typo here and more\n${numbered(7, 12)}`
  const after = before.replace('typo', 'fix')
  const parts = foldUnchanged(diffText(before, after), 1)
  assert.equal(showFolded(parts), '<5 folded>\nline 6\none long line with a [-typo-]{+fix+} here and more\nline 7\n<5 folded>\n')
})

test('foldUnchanged: short gaps between changes and texts without changes stay whole', () => {
  const before = numbered(1, 5)
  const after = before.replace('line 1\n', 'line one\n').replace('line 5\n', 'line five\n')
  assert.ok(foldUnchanged(diffText(before, after), 2).every((p) => p.kind !== 'fold'))
  assert.deepEqual(foldUnchanged(diffText(before, before), 0), [{ kind: 'same', text: before }])
})

test('valueChange: a long text diff comes folded', () => {
  const before = numbered(1, 40)
  const change = valueChange(before, before.replace('line 20\n', 'line twenty\n'))
  assert.equal(change.kind, 'text')
  assert.ok(change.kind === 'text' && change.parts.some((p) => p.kind === 'fold'))
})

test('diffList: kept and removed in the order before, then the added in the order after', () => {
  assert.deepEqual(diffList(['search', 'get', 'list'], ['list', 'traverse', 'search']), [
    { kind: 'same', value: 'search' },
    { kind: 'removed', value: 'get' },
    { kind: 'same', value: 'list' },
    { kind: 'added', value: 'traverse' },
  ])
})

test('diffList: an item listed twice shows once', () => {
  assert.deepEqual(diffList(['a', 'a'], ['a', 'b', 'b']), [{ kind: 'same', value: 'a' }, { kind: 'added', value: 'b' }])
})

test('valueChange: short texts show as before → after, none as empty', () => {
  assert.deepEqual(valueChange('Research Bot', 'Film Bot'), { kind: 'short', before: 'Research Bot', after: 'Film Bot' })
  assert.deepEqual(valueChange(undefined, 'Film Bot'), { kind: 'short', before: '', after: 'Film Bot' })
  assert.deepEqual(valueChange('Film Bot', null), { kind: 'short', before: 'Film Bot', after: '' })
})

test('valueChange: a long or multi-line text shows as a text diff', () => {
  const long = 'A description long enough that it no longer reads well as before and after.'
  assert.equal(valueChange('short', long).kind, 'text')
  assert.equal(valueChange('one\ntwo', 'one\nthree').kind, 'text')
})

test('valueChange: lists, with none as an empty list', () => {
  assert.deepEqual(valueChange(['a'], ['a', 'b']), { kind: 'list', items: [{ kind: 'same', value: 'a' }, { kind: 'added', value: 'b' }] })
  assert.deepEqual(valueChange(null, ['a']), { kind: 'list', items: [{ kind: 'added', value: 'a' }] })
  assert.deepEqual(valueChange(['a'], undefined), { kind: 'list', items: [{ kind: 'removed', value: 'a' }] })
})

test('valueChange: a text and a list show side by side', () => {
  assert.deepEqual(valueChange('All tools', ['search']), { kind: 'mixed', before: 'All tools', after: ['search'] })
})

test('toDiffValue: texts and lists as they are, anything else as text', () => {
  assert.equal(toDiffValue('x'), 'x')
  assert.equal(toDiffValue(null), null)
  assert.deepEqual(toDiffValue(['a', 1]), ['a', '1'])
  assert.equal(toDiffValue(3), '3')
  assert.equal(toDiffValue(true), 'true')
})
