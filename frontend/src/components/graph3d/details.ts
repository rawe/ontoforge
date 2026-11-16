/** Local read-only details never replace the host's manual selection. */
export type DetailItem = { kind: 'node' | 'edge'; id: string } | null
export interface DetailState {
  manualNodeId: string | null
  manualEdgeId: string | null
  tourNodeId: string | null
  followTour: boolean
  pinned: DetailItem
}

export function manualDetail(nodeId: string | null, edgeId: string | null): DetailItem {
  return nodeId ? { kind: 'node', id: nodeId } : edgeId ? { kind: 'edge', id: edgeId } : null
}

export function shownDetail(state: DetailState): DetailItem {
  if (!state.followTour && state.pinned) return state.pinned
  if (state.followTour && state.tourNodeId) return { kind: 'node', id: state.tourNodeId }
  return manualDetail(state.manualNodeId, state.manualEdgeId)
}

/** Reconcile host changes and removed graph items before choosing the next details. */
export function reconcileDetails(state: DetailState, nodeId: string | null, edgeId: string | null, nodes: readonly { id: string }[], edges: readonly { id: string }[]): DetailState {
  const valid = (item: DetailItem) => item && (item.kind === 'node' ? nodes : edges).some(candidate => candidate.id === item.id)
  const manualChanged = state.manualNodeId !== nodeId || state.manualEdgeId !== edgeId
  const tourNodeId = !manualChanged && nodes.some(node => node.id === state.tourNodeId) ? state.tourNodeId : null
  const candidate = manualChanged ? manualDetail(nodeId, edgeId) : state.pinned
  const pinned = valid(candidate) ? candidate : null
  if (!manualChanged && state.tourNodeId === tourNodeId && state.pinned === pinned) return state
  return { ...state, manualNodeId: nodeId, manualEdgeId: edgeId, tourNodeId, pinned }
}

export function followTourDetails(state: DetailState, followTour: boolean): DetailState {
  return { ...state, followTour, pinned: followTour ? null : shownDetail(state) }
}

export function manualDetails(state: DetailState, item: DetailItem): DetailState {
  return { ...state, tourNodeId: null, pinned: state.followTour ? null : item }
}
