import { useCallback, useEffect, useRef, useState } from 'react'
import { useAssistantPanel } from '../panel/panelContext'
import {
  aiMarks, applyFill, isStale, undoFill, type AiEdit, type DraftEditor, type DraftTarget, type Fields,
} from './draftFillModel'

// One counter for every editor of the page, started at the clock: a version never repeats, so it names one editor session's one state.
let lastVersion = Date.now()
const nextVersion = () => ++lastVersion

interface DraftFillState<D> {
  draft: D
  version: number
  /** The AI's edit since the last discard, undo or remount. */
  edit: AiEdit
}

/**
 * An editor's draft the Studio helper may fill: the draft with its version,
 * bumped by every change through `change`, `reset`, a fill and `undo`; the
 * AI marks; and the editor published to the assistant panel while mounted.
 * `D` is the editor's own draft, `F` its fillable fields (`fieldsOf`,
 * `withFields`). A fill happens only on a card's "Fill draft", and only if
 * the same editor is open at the same version.
 */
export function useDraftFill<D, F extends Fields>({ initial, ontologyKey, target, fieldsOf, withFields, onFill }: {
  initial: D
  ontologyKey: string
  target: DraftTarget
  fieldsOf: (draft: D) => F
  withFields: (draft: D, fields: F) => D
  /** After a fill, with the draft before and after it. */
  onFill?: (before: D, after: D) => void
}) {
  const [state, setState] = useState<DraftFillState<D>>(() => ({ draft: initial, version: nextVersion(), edit: {} }))

  const change = useCallback((next: (draft: D) => D) => {
    setState((s) => ({ ...s, draft: next(s.draft), version: nextVersion() }))
  }, [])
  /** Back to `draft` with no AI edit: Discard changes. */
  const reset = useCallback((draft: D) => setState({ draft, version: nextVersion(), edit: {} }), [])
  const undo = () => setState((s) => ({
    draft: withFields(s.draft, undoFill(fieldsOf(s.draft), s.edit)), version: nextVersion(), edit: {},
  }))

  // What the published editor reads: the rendered state and options.
  const latest = useRef({ state, ontologyKey, target, fieldsOf, withFields, onFill })
  useEffect(() => {
    latest.current = { state, ontologyKey, target, fieldsOf, withFields, onFill }
  })

  const { publishDraft } = useAssistantPanel()
  useEffect(() => {
    const draftState = () => {
      const { state: s, ontologyKey: o, target: t, fieldsOf: of } = latest.current
      return { ontologyKey: o, target: t, version: s.version, fields: of(s.draft) }
    }
    const editor: DraftEditor = {
      state: draftState,
      fill: (ontologyKey, proposal) => {
        if (isStale(draftState(), ontologyKey, proposal)) return false
        const { state: s, fieldsOf: of, withFields: wf, onFill: after } = latest.current
        const filled = applyFill(of(s.draft), proposal.fields, s.edit)
        const draft = wf(s.draft, filled.fields)
        const next = { draft, version: nextVersion(), edit: filled.edit }
        latest.current = { ...latest.current, state: next }
        setState(next)
        after?.(s.draft, draft)
        return true
      },
    }
    return publishDraft(editor)
  }, [publishDraft])

  const marks = aiMarks(fieldsOf(state.draft), state.edit)
  return { draft: state.draft, version: state.version, change, reset, undo, marks, canUndo: Object.keys(marks).length > 0 }
}
