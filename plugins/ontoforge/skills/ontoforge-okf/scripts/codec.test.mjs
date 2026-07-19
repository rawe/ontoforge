// Codec unit tests. Run with: node --test scripts/
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  conceptIdFromPath,
  fromEntity,
  mergeConfig,
  parseConceptDocument,
  serializeFrontmatter,
  toEntityPayload,
} from './codec.mjs';

const CONFIG = mergeConfig({});

const NOTE_TYPE = {
  key: 'note',
  properties: [
    { key: 'conceptId', dataType: 'string', required: true },
    { key: 'title', dataType: 'string' },
    { key: 'description', dataType: 'string' },
    { key: 'resource', dataType: 'string' },
    { key: 'tags', dataType: 'string' },
    { key: 'timestamp', dataType: 'datetime' },
    { key: 'priority', dataType: 'integer' },
    { key: 'archived', dataType: 'boolean' },
    { key: 'content', dataType: 'document' },
  ],
};

test('conceptIdFromPath strips .md and normalizes separators', () => {
  assert.equal(conceptIdFromPath('tables/users.md'), 'tables/users');
  assert.equal(conceptIdFromPath('tables\\users.md'), 'tables/users');
});

test('conceptIdFromPath rejects reserved filenames and escapes', () => {
  assert.throws(() => conceptIdFromPath('guides/index.md'), /reserved/);
  assert.throws(() => conceptIdFromPath('log.md'), /reserved/);
  assert.throws(() => conceptIdFromPath('../outside.md'), /outside the bundle root/);
  assert.throws(() => conceptIdFromPath('notes/readme.txt'), /not a Markdown file/);
});

test('parseConceptDocument reads scalars, lists, and body', () => {
  const doc = parseConceptDocument(
    [
      '---',
      'type: note',
      'title: "Hello: world"',
      'description: A plain sentence',
      'tags:',
      '  - alpha',
      '  - beta',
      'priority: 3',
      'archived: false',
      '---',
      '',
      '# Heading',
      '',
      'Body text.',
      '',
    ].join('\n'),
  );
  assert.deepEqual(doc.fields, {
    type: 'note',
    title: 'Hello: world',
    description: 'A plain sentence',
    tags: ['alpha', 'beta'],
    priority: 3,
    archived: false,
  });
  assert.equal(doc.body, '# Heading\n\nBody text.');
});

test('parseConceptDocument supports inline lists and quoted items', () => {
  const doc = parseConceptDocument('---\ntype: note\ntags: [alpha, "b, c", \'d\']\n---\nbody');
  assert.deepEqual(doc.fields.tags, ['alpha', 'b, c', 'd']);
});

test('parseConceptDocument rejects missing frontmatter and nesting', () => {
  assert.throws(() => parseConceptDocument('# no frontmatter'), /missing YAML frontmatter/);
  assert.throws(() => parseConceptDocument('---\ntype: note\n'), /unterminated/);
  assert.throws(
    () => parseConceptDocument('---\nmeta:\n  nested: x\n---\nbody'),
    /nested mappings/,
  );
  assert.throws(() => parseConceptDocument('---\ndesc: |\n  text\n---\nbody'), /block scalars/);
});

test('toEntityPayload maps frontmatter, body, and concept ID', () => {
  const doc = parseConceptDocument(
    '---\ntype: note\ntitle: Setup guide\ntags:\n  - a\n  - b\npriority: 2\n---\n\nThe body.\n',
  );
  const { payload, unknownKeys, documentProperty } = toEntityPayload(
    doc, 'guides/setup', NOTE_TYPE, CONFIG,
  );
  assert.equal(documentProperty, 'content');
  assert.deepEqual(unknownKeys, []);
  assert.deepEqual(payload, {
    conceptId: 'guides/setup',
    content: 'The body.\n',
    title: 'Setup guide',
    tags: 'a, b',
    priority: 2,
  });
});

test('toEntityPayload reports unknown frontmatter keys', () => {
  const doc = parseConceptDocument('---\ntype: note\nowner: alice\n---\nbody');
  const { unknownKeys } = toEntityPayload(doc, 'x', NOTE_TYPE, CONFIG);
  assert.deepEqual(unknownKeys, ['owner']);
});

test('toEntityPayload validates data types', () => {
  const bad = parseConceptDocument('---\ntype: note\npriority: high\n---\nbody');
  assert.throws(() => toEntityPayload(bad, 'x', NOTE_TYPE, CONFIG), /expects an integer/);
  const badList = parseConceptDocument('---\ntype: note\npriority: [1, 2]\n---\nbody');
  assert.throws(() => toEntityPayload(badList, 'x', NOTE_TYPE, CONFIG), /YAML lists/);
});

test('toEntityPayload requires the concept-ID and document properties', () => {
  const doc = parseConceptDocument('---\ntype: note\n---\nbody');
  const noConcept = { key: 'note', properties: [{ key: 'content', dataType: 'document' }] };
  assert.throws(() => toEntityPayload(doc, 'x', noConcept, CONFIG), /no "conceptId" property/);
  const noDoc = { key: 'note', properties: [{ key: 'conceptId', dataType: 'string' }] };
  assert.throws(() => toEntityPayload(doc, 'x', noDoc, CONFIG), /no document property/);
});

test('serializeFrontmatter orders reserved keys first, quotes when needed', () => {
  const out = serializeFrontmatter({
    zeta: 'plain value',
    type: 'note',
    title: 'Needs: quoting',
    tags: ['a', 'b'],
    count: 7,
  });
  assert.equal(
    out,
    ['type: note', 'title: "Needs: quoting"', 'tags:', '  - a', '  - b', 'count: 7', 'zeta: plain value'].join('\n'),
  );
});

test('fromEntity renders frontmatter and body, splits list properties', () => {
  const entity = {
    _id: 'abc',
    conceptId: 'guides/setup',
    title: 'Setup guide',
    tags: 'a, b',
    priority: 2,
    content: 'The body.\n',
  };
  const md = fromEntity(entity, NOTE_TYPE, CONFIG, 'note');
  assert.equal(
    md,
    '---\ntype: note\ntitle: Setup guide\ntags:\n  - a\n  - b\npriority: 2\n---\n\nThe body.\n',
  );
});

test('fromEntity rejects document stubs', () => {
  const entity = { conceptId: 'x', content: { document: true, length: 10 } };
  assert.throws(() => fromEntity(entity, NOTE_TYPE, CONFIG, 'note'), /stub/);
});

test('round-trip: file -> payload -> file is stable', () => {
  const original =
    '---\ntype: note\ntitle: Setup guide\ndescription: How to set things up\ntags:\n  - infra\n  - "how-to"\ntimestamp: "2026-07-01T12:00:00Z"\npriority: 2\narchived: false\n---\n\n# Setup\n\nSteps with a [link](/guides/other).\n';
  const doc = parseConceptDocument(original);
  const { payload } = toEntityPayload(doc, 'guides/setup', NOTE_TYPE, CONFIG);
  const md = fromEntity({ ...payload }, NOTE_TYPE, CONFIG, 'note');
  const reparsed = parseConceptDocument(md);
  assert.deepEqual(reparsed.fields, { ...doc.fields, tags: ['infra', 'how-to'] });
  assert.equal(reparsed.body, doc.body);
  // A second pass must be byte-identical (deterministic serialization).
  const { payload: payload2 } = toEntityPayload(reparsed, 'guides/setup', NOTE_TYPE, CONFIG);
  assert.equal(fromEntity({ ...payload2 }, NOTE_TYPE, CONFIG, 'note'), md);
});
