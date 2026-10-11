import type { CascadeState } from './useCascade'

/**
 * The cascade wording, shared by `CascadeDialog` and the delete dialog's cascade
 * stage. Own wording, not the server message: the lists carry the specifics.
 */
export function affectedText({
  affectedLenses,
  affectedIndices,
}: Pick<CascadeState, 'affectedLenses' | 'affectedIndices'>): string {
  const parts = [
    ...(affectedLenses.length > 0 ? ['the scope of the lenses'] : []),
    ...(affectedIndices.length > 0
      ? ['the search indices (an index left with nothing to read is deleted)']
      : []),
  ]
  return parts.length === 0
    ? 'This change also updates objects that depend on it.'
    : `This change also updates ${parts.join(' and ')} listed below.`
}
