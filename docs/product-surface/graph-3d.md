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

**Focus on neighbours** dims nodes and relations outside the manually selected node's
immediate neighbourhood. Tour previews do not move that boundary. Studio also retains
its outline search and focus selection.
Relations curve apart when several join the same endpoints; self-relations form
loops. Arrowheads and moving pulses show direction. Parent relations retain their
violet treatment.

**Tour** visits the visible, undimmed nodes and slowly orbits each stop. In full
screen, **Follow tour** is on by default: the detail panel and scene highlight follow
the current stop without changing the host's manual selection or address. Turn it
off to pin the currently displayed details while the camera continues. Turning it
back on resumes the current tour stop. Stopping the tour or dragging to take control
keeps the last stop's details; manually selecting or searching for an item takes over
the panel. Reduced-motion preferences make tour travel immediate and disable its
automatic orbit. **Pause** holds the current camera position and detail stop without
ending the tour; **Resume** continues the remaining camera travel and stop time.
**Stop tour** ends it. Manual navigation or selection takes control even while paused.

**Full screen** expands the scene and shows its detail panel. In Studio this includes
the type's full description and property definitions. In Workbench it shows the
instance's exposed identity and property values, with document sizes, plus incoming
and outgoing relation counts under **Connections in this view**. These counts cover
only the visible working set, not the full stored neighbourhood. Instance and relation
panels show their values rather than repeating their schema type's description.
Leave full screen to use the host's editing and neighbour-expansion actions.

## Display and recovery

The 3D scene has its own spatial layout; it does not write the 2D layout. Existing
node positions are retained while adding neighbours to a mounted scene. Returning
to 2D restores its canvas. The 3D scene loads only when opened.

**Motion** independently toggles particles, rotating highlights and the slow orbit
around a tour stop; it does not stop the tour or disable navigation transitions.
Reduced-motion preferences disable automatic animation and make camera travel immediate. Rendering
is suspended while the scene is offscreen or the browser tab is hidden. When WebGL
is unavailable or its context is lost, the scene offers **Return to 2D**.
