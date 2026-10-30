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
  plus prisms and antiprisms on triangles through decagons (the square prism
  is the cube and the triangular antiprism the octahedron, so they're listed
  once), each listed with their vertex configuration (e.g. `5.6.6` for the truncated
  icosahedron). The card at the top spins a preview of the selected solid;
  hover any entry to preview it without selecting it.
- **Hover a face** of any solid in the scene to preview the selected solid
  snapped onto it. Only faces with the same number of sides can mate. The
  preview turns red if it would overlap something already placed.
- **Click** to place it. `R` / `Shift+R` (or the ‹ › buttons) cycle through the
  distinct orientations for that face; symmetric duplicates are removed, and
  for chiral solids (the two snubs) both mirror images are offered.
- **Shift-click** removes a solid, `Z` undoes, `F` fits everything in view.
- **Grow a lattice** copies every solid across each face of the chosen types,
  repeating for N generations and skipping copies that would overlap:
  - *Mirror across face* reflects the solid through the shared face.
  - *Slide opposite face over* translates the solid so its parallel opposite
    face lands on the shared face. Cubes, truncated octahedra or hexagonal
    prisms across all faces tile space this way.

Faces are coloured by polygon type: triangles amber, squares red, pentagons
blue, hexagons green, octagons violet, decagons orange. The scene is saved in
the browser's local storage.

## Code

- `src/geometry.js`: vertex recipes for the 28 solids (the snubs are solved
  numerically), a hull pass that recovers the polygonal faces, and vertex
  configurations. No dependencies.
- `src/snap.js`: face-to-face alignment transforms, orientation de-duplication,
  convex overlap testing (separating axis theorem) and lattice growth.
- `src/main.js`: three.js scene, picking, preview and UI.

```bash
npm test             # node --test, no install needed
```
