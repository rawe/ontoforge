# Share one Three.js graph renderer across schema and instance views

Current behavior: [3D graph exploration](../product-surface/graph-3d.md).

## Context

Studio's schema and Workbench's instance working set both benefit from spatial
navigation and inspection. They have different data owners, permissions and editing
flows, which a visualization must preserve.

## Decision

Use one lazy-loaded Three.js renderer with host adapters supplying graph values and
selection callbacks. Each host retains its existing data reads, inspectors and
mutations. Three.js addons provide orbit controls and postprocessing.

## Consequences

The renderer owns camera, GPU resources and projected labels. Opening 3D downloads
an additional rendering chunk; other views do not require it.

## Rejected

- **Separate 3D implementations.** They would duplicate navigation and rendering behavior.
- **Additional React or force-graph wrappers.** Direct Three.js provides the required
  camera and visual control without another rendering abstraction or a continuously
  moving layout.
