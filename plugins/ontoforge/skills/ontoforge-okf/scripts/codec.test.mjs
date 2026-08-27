// Codec unit tests. Run with: node --test scripts/
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  conceptIdFromPath,
  entityTypeKeyFor,
  fromEntity,
  mergeConfig,
  parseConceptDocument,
  serializeFrontmatter,
  toEntityPayload,
  typeValueFor,
} from './codec.mjs';

const CONFIG = mergeConfig({ ontology: 'main', typeMap: { note: 'note', Guide: 'guide' } });

const NOTE_TYPE = {
  key: 'note',
  properties: [
    { key: 'concept_id', dataType: 'string', required: true },
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

test('mergeConfig requires an ontology and a type map', () => {
  assert.throws(() => mergeConfig({}), /"ontology" is missing/);
  assert.throws(() => mergeConfig({ ontology: 'main' }), /"typeMap" is empty/);
});

test('mergeConfig rejects a type map that is not one-to-one', () => {
  assert.throws(
    () => mergeConfig({ ontology: 'main', typeMap: { Table: 'tbl', View: 'tbl' } }),
    /maps both "Table" and "View" to "tbl"/,
  );
});

test('mergeConfig reports every fault at once', () => {
  assert.throws(() => mergeConfig({}), (err) => {
    assert.match(err.message, /"ontology" is missing/);
    assert.match(err.message, /"typeMap" is empty/);
    return true;
  });
});

test('type values and entity type keys translate both ways', () => {
  assert.equal(entityTypeKeyFor('Guide', CONFIG), 'guide');
  assert.equal(typeValueFor('guide', CONFIG), 'Guide');
  assert.throws(() => entityTypeKeyFor('Playbook', CONFIG), /no "typeMap" entry for type "Playbook"/);
  assert.throws(() => typeValueFor('playbook', CONFIG), /no "typeMap" entry maps to entity type/);
});

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
    concept_id: 'guides/setup',
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
  assert.throws(() => toEntityPayload(doc, 'x', noConcept, CONFIG), /no "concept_id" property/);
  const noDoc = { key: 'note', properties: [{ key: 'concept_id', dataType: 'string' }] };
  assert.throws(() => toEntityPayload(doc, 'x', noDoc, CONFIG), /no document property/);
});

test('serializeFrontmatter writes keys alphabetically, quotes when needed', () => {
  const out = serializeFrontmatter({
    zeta: 'plain value',
    type: 'note',
    title: 'Needs: quoting',
    tags: ['a', 'b'],
    count: 7,
  });
  assert.equal(
    out,
    ['count: 7', 'tags:', '  - a', '  - b', 'title: "Needs: quoting"', 'type: note', 'zeta: plain value'].join('\n'),
  );
});

test('fromEntity renders frontmatter and body, splits list properties', () => {
  const entity = {
    _id: 'abc',
    concept_id: 'guides/setup',
    title: 'Setup guide',
    tags: 'a, b',
    priority: 2,
    content: 'The body.\n',
  };
  const md = fromEntity(entity, NOTE_TYPE, CONFIG, 'note');
  assert.equal(
    md,
    '---\npriority: 2\ntags:\n  - a\n  - b\ntitle: Setup guide\ntype: note\n---\n\nThe body.\n',
  );
});

test('fromEntity rejects document stubs', () => {
  const entity = { concept_id: 'x', content: { document: true, length: 10 } };
  assert.throws(() => fromEntity(entity, NOTE_TYPE, CONFIG, 'note'), /stub/);
});

test('round-trip: file -> payload -> file is stable', () => {
  const original =
    '---\narchived: false\ndescription: How to set things up\npriority: 2\ntags:\n  - infra\n  - how-to\ntimestamp: "2026-07-01T12:00:00Z"\ntitle: Setup guide\ntype: note\n---\n\n# Setup\n\nSteps with a [link](/guides/other).\n';
  const doc = parseConceptDocument(original);
  const { payload } = toEntityPayload(doc, 'guides/setup', NOTE_TYPE, CONFIG);
  const md = fromEntity({ ...payload }, NOTE_TYPE, CONFIG, 'note');
  assert.equal(md, original);
  const reparsed = parseConceptDocument(md);
  assert.deepEqual(reparsed.fields, { ...doc.fields, tags: ['infra', 'how-to'] });
  assert.equal(reparsed.body, doc.body);
});
