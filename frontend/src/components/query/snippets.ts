/**
 * OQL snippet builders for the schema sidebar and the editor insert
 * helper (works on the CodeMirror view behind `ReactCodeMirrorRef`).
 */

import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import type { SchemaRelationType } from '@/api/types'

export const EXAMPLE_QUERY =
  'MATCH (p:person)-[r:works_for]->(c:company) RETURN p, r, c LIMIT 25'

export const entitySnippet = (typeKey: string) =>
  `MATCH (n:${typeKey}) RETURN n LIMIT 25`

export const relationSnippet = (relationType: SchemaRelationType) =>
  `MATCH (a:${relationType.fromEntityTypeKey})-[r:${relationType.key}]->` +
  `(b:${relationType.toEntityTypeKey}) RETURN a, r, b LIMIT 25`

/** Insert text at the cursor (replacing any selection) and refocus. */
export function insertAtCursor(
  ref: React.RefObject<ReactCodeMirrorRef | null>,
  text: string,
): void {
  const view = ref.current?.view
  if (view === undefined) return
  const { from, to } = view.state.selection.main
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  })
  view.focus()
}
