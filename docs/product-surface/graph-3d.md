# Exploring graphs in 3D

The **3D** tab on [Studio Schema](studio.md#schema) shows entity types and relation
types. The **3D** switch in [Workbench Explore](workbench.md#explore) shows the
entities and relations in the current working set, through the current lens. The
scene uses the same selections, type colours and detail panels as its host screen.
Both views support [deep links](client-contracts.md#deep-links).
The rendering choice is explained in [the decision record](../adr/0034-shared-threejs-graph-view.md).

## Navigation and inspection

In **Orbit**, drag to rotate, scroll to approach, and use a secondary drag to pan.
Click a node to inspect it, click a connection to inspect its relation, and
double-click a node to fly towards it. Labels reveal a short property summary when
close; the host inspector provides the full details and actions. Search in the 3D
toolbar finds nodes already in the scene and flies to the chosen result. In the
Workbench, the regular search adds entities, and the entity panel expands their
neighbours into the working set.

**Fly** focuses the canvas: drag to look, use WASD or arrow keys to move, Q/E to
change height, and Shift to move faster. Escape returns to Orbit. Movement keys
apply only while the canvas has keyboard focus. **Fit** recovers an overview.

**Focus on neighbours** dims nodes and relations outside the selected node's
immediate neighbourhood. Studio also retains its outline search and focus selection.
Relations curve apart when several join the same endpoints; self-relations form
loops. Arrowheads and moving pulses show direction. Parent relations retain their
violet treatment.

**Tour** visits the scene's nodes and slowly orbits each stop. Dragging takes
control; the Tour button stops it. **Full screen** expands the scene and shows a
compact selected-item panel. Leave full screen to use the host's editing and
neighbour-expansion actions.

## Display and recovery

The 3D scene has its own spatial layout; it does not write the 2D layout. Existing
node positions are retained while adding neighbours to a mounted scene. Returning
to 2D restores its canvas. The 3D scene loads only when opened.

The animation control pauses pulses and camera transitions. Reduced-motion
preferences disable automatic animation and make camera travel immediate. Rendering
is suspended while the scene is offscreen or the browser tab is hidden. When WebGL
is unavailable or its context is lost, the scene offers **Return to 2D**.
