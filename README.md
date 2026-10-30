# Polyhedra Explorer

Snap Platonic and Archimedean solids together face to face in the browser, and
grow them into lattices. Inspired by George Hart's
[Virtual Polyhedra](https://www.georgehart.com/virtual-polyhedra/archimedean-index.html).

## Run it

It's a static page with no build step (three.js loads from a CDN), but ES
modules need to be served over HTTP:

```bash
npm start            # serves the folder on http://localhost:8080
```

or `python3 -m http.server` and open `index.html`.

## Using it

- **Pick a solid** in the side panel: all 5 Platonic and 13 Archimedean solids,
  prisms and antiprisms on triangles through decagons (the square prism is the
  cube and the triangular antiprism the octahedron, so they're listed once),
  and all 92 Johnson solids, grouped the way Johnson grouped them. Type in the
  filter box to search by name or J-number. Each solid is listed with their vertex configuration (e.g. `5.6.6` for the truncated
  icosahedron). The card at the top spins a preview of the selected solid;
  hover any entry to preview it without selecting it.
- **Hover a face** of any solid in the scene to preview the selected solid
  snapped onto it. Only faces with the same number of sides can mate. The
  preview turns red if it would overlap something already placed.
- **Click** to place it. `R` / `E` (or the ‹ › buttons) cycle through the
  distinct orientations for that face; symmetric duplicates are removed, and
  for chiral solids (the two snubs) both mirror images are offered.
- **Hold Shift** (or Alt) to switch to removing: the solid under the cursor
  turns red, and clicking removes it. `Z` undoes, `F` fits everything in view.
- **Grow a lattice** copies every solid across each face of the chosen types,
  repeating for N generations and skipping copies that would overlap:
  - *Mirror across face* reflects the solid through the shared face.
  - *Slide opposite face over* translates the solid so its parallel opposite
    face lands on the shared face. Cubes, truncated octahedra or hexagonal
    prisms across all faces tile space this way.

### Edge angles

Solids that share an edge fan around it like pages around a book's spine, and
each fills a wedge equal to its **dihedral angle** there. Space closes up
around the edge only if the wedges add up to exactly 360°. Four cubes do
(4 × 90°); five tetrahedra leave a 7.36° gap; three dodecahedra leave 10.3°,
the gap that folds them up into the 4D 120-cell.

Press **Edge angles** (or `G`) and hover an edge to read its dihedral angle.
Click it to inspect it:

- The card lists every solid around the edge with the angle it takes, and the
  gap (or overlap) left over. A fan of wedges is drawn around the edge itself,
  with any gap in cyan.
- **Add** puts the selected solid into the gap (`R` / `E` cycle the ways it can
  go on, `Enter` adds it); **Fill** keeps adding while it fits.
- Suggestions list combinations of solids from the whole library whose angles
  close the gap exactly, such as a tetrahedron and two octahedra for the gap
  next to one tetrahedron. They match by angle only: the faces must match
  too to snap them on. Click a name to select that solid.

`Esc` stops inspecting the edge; `G` turns the tool off.

Faces are coloured by polygon type: triangles amber, squares red, pentagons
blue, hexagons green, octagons violet, decagons orange. The scene is saved in
the browser's local storage.

## Code

- `src/geometry.js`: vertex recipes for the uniform solids (the snubs are solved
  numerically), a hull pass that recovers the polygonal faces, and vertex
  configurations. No dependencies.
- `src/johnson.js`: the 92 Johnson solids. 84 are built from pieces
  (pyramids, cupolae and rotundae stacked on prisms and antiprisms, or caps
  added to, removed from or turned on other solids), and every result is
  checked to be convex with unit-edge regular faces. The other eight (J84–J86,
  J88–J92) have no such construction and are given as coordinates, using the
  values tabulated by [David McCooey](https://dmccooey.com/polyhedra/Johnson.html)
  after A. Timofeenko's exact solutions.
- `src/edges.js`: dihedral angles, the fan of solids around an edge and its
  gaps, and the search for angle combinations that close a gap.
- `src/snap.js`: face-to-face alignment transforms, orientation de-duplication,
  convex overlap testing (separating axis theorem) and lattice growth.
- `src/main.js`: three.js scene, picking, preview and UI.

```bash
npm test             # node --test, no install needed
```
