/**
 * Where an explainer stands in its story: the step on the screen, and whether auto-play
 * moves on from it. `last` is the index of the story's last step.
 */
export interface StepState {
  index: number
  playing: boolean
}

export const FIRST_STEP: StepState = { index: 0, playing: false }

/** Whether auto-play moves on from this step: playing, and not yet at the last step. */
export const isRunning = (state: StepState, last: number) => state.playing && state.index < last

/** A step chosen by hand, kept within the story; it stops auto-play. */
export const goTo = (index: number, last: number): StepState => ({ index: Math.max(0, Math.min(last, index)), playing: false })

/** Auto-play's move to the next step; it stays on the last one. */
export const advance = (state: StepState, last: number): StepState => ({ ...state, index: Math.min(state.index + 1, last) })

/** Play pauses a running story; otherwise it plays on — from the first step when the story is at its end. */
export const togglePlay = (state: StepState, last: number): StepState =>
  isRunning(state, last) ? { ...state, playing: false } : { index: state.index === last ? 0 : state.index, playing: true }
