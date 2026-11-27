import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RUNTIME_SKILL_KEY_PATTERN } from '../src/components/studio/modeling/schemaKeys.ts'
import {
  SKILL_NEW,
  skillContentProblem,
  skillDescriptionProblem,
  skillKeyProblem,
} from '../src/components/studio/skills/runtimeSkillModel.ts'

test('the key rule: lowercase letters, digits and single hyphens', () => {
  for (const key of ['find-people', 'step-2', '2-step', 'a', 'x'.repeat(64)]) {
    assert.equal(skillKeyProblem(key, []), undefined, key)
  }
  for (const key of ['find_people', 'Find', '-find', 'find-', 'find--people', 'find people', 'fünf']) {
    assert.match(skillKeyProblem(key, []) ?? '', /single hyphens/, key)
  }
  assert.match(skillKeyProblem('x'.repeat(65), []) ?? '', /At most 64/)
})

test('an empty key is required, not wrong; a taken key is refused', () => {
  assert.equal(skillKeyProblem('', []), undefined)
  assert.match(skillKeyProblem('find-people', ['find-people']) ?? '', /already/)
})

test('the draft URL value is never a valid key', () => {
  assert.equal(RUNTIME_SKILL_KEY_PATTERN.test(SKILL_NEW), false)
})

test('the description: 1 to 1024 characters, counted as code points', () => {
  assert.match(skillDescriptionProblem('') ?? '', /required/)
  assert.equal(skillDescriptionProblem('x'.repeat(1024)), undefined)
  assert.match(skillDescriptionProblem('x'.repeat(1025)) ?? '', /At most 1024 characters; this one has 1025/)
  // 1024 emoji are 2048 UTF-16 units but 1024 characters.
  assert.equal(skillDescriptionProblem('😀'.repeat(1024)), undefined)
})

test('the content must not be empty', () => {
  assert.match(skillContentProblem('') ?? '', /must not be empty/)
  assert.equal(skillContentProblem('# Guide'), undefined)
})
