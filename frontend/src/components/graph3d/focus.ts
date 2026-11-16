/** Focus belongs to the manual selection, independently of a tour's preview highlight. */
export function focusNeighborhood(
  anchor: string | null,
  edges: readonly { source: string; target: string }[],
): ReadonlySet<string> {
  const members = new Set<string>()
  if (anchor === null) return members
  members.add(anchor)
  for (const edge of edges) {
    if (edge.source === anchor || edge.target === anchor) {
      members.add(edge.source)
      members.add(edge.target)
    }
  }
  return members
}
