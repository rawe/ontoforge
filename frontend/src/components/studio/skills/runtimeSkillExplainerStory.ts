/**
 * What the runtime skill explainer shows: where a skill goes — from this lens in Studio,
 * through the lens's runtime MCP endpoint, to an MCP client — and which of its three parts
 * the client has at each step. Placeholders only, never a sample skill.
 */

export type FlowNodeId = 'studio' | 'endpoint' | 'client'
export type SkillPart = 'key' | 'description' | 'content'

export interface FlowNode {
  id: FlowNodeId
  label: string
  sub: string
}

export const FLOW: FlowNode[] = [
  { id: 'studio', label: 'This lens', sub: 'in Studio' },
  { id: 'endpoint', label: 'Runtime MCP endpoint', sub: 'of this lens' },
  { id: 'client', label: 'MCP client', sub: 'such as Claude Code' },
]

/** One part of the skill as the client receives it: the line of its SKILL.md it becomes. */
export const PARTS: { part: SkillPart; label: string; line: string }[] = [
  { part: 'key', label: 'Key', line: 'name: <key>' },
  { part: 'description', label: 'Description', line: 'description: <description>' },
  { part: 'content', label: 'Content', line: '<content>' },
]

export interface StoryStep {
  title: string
  body: string
  /** Where the step happens. */
  node: FlowNodeId
  /** The parts the client holds after this step; in Studio, the parts the step is about. */
  parts: SkillPart[]
}

export const STORY: readonly StoryStep[] = [
  {
    title: 'You save it in this lens',
    body: 'A runtime skill has three parts: its key, its description and its content, the instructions in Markdown. It belongs to this lens; another lens does not serve it.',
    node: 'studio',
    parts: ['key', 'description', 'content'],
  },
  {
    title: 'The lens serves it',
    body: 'Every runtime MCP endpoint of this lens serves the skill as a SKILL.md: the key becomes its name, the description its description, the content its body.',
    node: 'endpoint',
    parts: ['key', 'description', 'content'],
  },
  {
    title: 'The client lists it',
    body: 'An MCP client connected to this lens lists the skill by key and description. Claude Code lists it under /skills and runs it as the command /<server>:<key>, where <server> is the name the client gave the connection.',
    node: 'client',
    parts: ['key', 'description'],
  },
  {
    title: 'The client loads it',
    body: 'When a task calls for the skill, chosen by its description or typed as a command, the client loads its content and follows the instructions.',
    node: 'client',
    parts: ['key', 'description', 'content'],
  },
  {
    title: 'A change reaches the client',
    body: 'A saved change is served on the client\'s next request. Claude Code loads an edited skill on its next use; a typed command may need a second try. A new or deleted skill enters or leaves its list after the server is reconnected in /mcp or a new session starts.',
    node: 'endpoint',
    parts: ['key', 'description', 'content'],
  },
]
