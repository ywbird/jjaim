# Declarative Glyph Composition Specification (Draft v0.3)

## 1. Scope and data hierarchy

This specification defines how glyphs read from textures and glyphs defined by other groups are placed and composed by index, and how the resulting glyphs are associated with Unicode code points. The resulting definitions may be used by a TTF generator, a game engine, or another renderer.

Following the data-hierarchy approach exemplified by the [Aircraft Data Hierarchy (ADH)](https://boeing.github.io/aircraft-data-hierarchy/), this document separates defined entities, references between entities, validation, and downstream interpretation. This is a glyph-specific conceptual hierarchy, **not** a claim that glyph definitions conform to the aerospace ADH schema or require its implementation.

The conceptual hierarchy is:

```text
glyph definition
├── optional metadata (name, version, author, etc.)
├── optional named texture sets
│   └── named texture sources (image paths only)
└── named groups
    ├── optional description
    ├── size and count
    ├── optional texture-set/source reference and extraction parameters
    ├── ordered imports
    │   └── ordered placement rules (at)
    │       └── optional repetition axes (repeat)
    └── optional Unicode mappings
```

This diagram describes ownership of declarations, not an additional file schema. An import refers to another named group; it does not nest or copy that group's definition. The group-reference graph must be acyclic, but a group may be referenced by more than one import. The common meaning specified here is the resulting structure of glyph layers, including their references, placement, order, and clipping. Pixel compositing and font output are renderer policies, as specified in Section 5.

The YAML in Section 7 is **illustrative notation**. Neither a persistence format nor a concrete serialization schema has yet been selected.

## 2. Coordinates and groups

All coordinates, dimensions, and offsets are integers in a common logical pixel unit. A group's local origin is at its upper left, with x increasing to the right and y increasing downward.

A glyph definition may have a top-level `metadata` mapping describing the definition as a whole. Its optional `name`, `version`, and `author` fields are strings; `version` labels this definition, not the version of this specification. Additional metadata fields may be supplied for other descriptive information, but their meaning is outside this specification. Metadata does not change glyph placement, references, Unicode mappings, or rendering.

A definition may declare `texture_sets`: a mapping from unique nonempty set names to mappings of unique nonempty source names to nonempty image-path strings. Each texture set is **only a registry of sources**. It specifies no image dimensions, cell sizes, packing, extraction rectangles, order, or compositing behavior. A set may contain multiple images, and a source name is scoped to its set. The registry may be omitted when no group uses a texture. An unused registered image need not be opened by a renderer.

A group `G` has a positive integer size `(w, h)`, a positive integer `count = n`, an optional string `description`, an optional texture reference and extraction parameters, an ordered list of imports, and an optional list of `unicode` mappings. `description` documents that group without affecting its glyphs or references. Its valid glyph indices are `0 <= i < n`. The group's local clipping rectangle is `[0, w) × [0, h)`. A group without a texture can be defined by `size` and `count` alone; its initial glyph images are empty.

For a group with a texture, `set` and `source` identify an existing texture-set entry; the group also specifies a start coordinate `(x0, y0)` and a direction. The source image of glyph `i` is the `(w, h)` rectangle starting at `(x0, y0) + i · step`; the upper-left corner of that rectangle becomes the glyph's local origin. The **provisional recommended** directions and steps are `right: (w, 0)`, `left: (-w, 0)`, `down: (0, h)`, and `up: (0, -h)`. There is no automatic line wrapping. A referenced extraction rectangle outside the texture bounds is invalid. How to express arbitrary per-glyph boxes for irregularly packed images is a separate, unresolved group-extraction feature; it does not belong in the texture-set registry.

## 3. Imports and indexed placement

A group's `imports` is an **ordered list**. The same source group may occur in multiple imports with different offsets. Each import specifies a source group, an offset `(dx, dy)` applied to that entire import relative to the target group's local origin, and an ordered list of `at` rules.

An `at` rule with `from: [a, b]` and `to: t` places source indices in the Python-style half-open interval `[a, b)` at consecutive target indices beginning at `t`. More precisely, for every `j` such that `0 <= j < b - a`, it places source glyph `[a + j]` at target glyph `[t + j]`.

An `at` rule may also specify an ordered list of repetition axes in `repeat`. Each axis has a positive integer `count = r`, an integer `from_stride = p` (default `0`), and an integer `to_stride = q` (default `b - a`). An omitted `repeat` is equivalent to `repeat: []`; a single axis is still written as a one-element list. For every axis index `k_m` satisfying `0 <= k_m < r_m` and every `j` satisfying `0 <= j < b - a`, the expanded placement is:

```text
source index = a + j + Σ(k_m × p_m)
target index = t + j + Σ(k_m × q_m)
```

The first axis is the outermost repetition and the last axis is the innermost. All expanded source and target indices must be valid for their respective groups. Nested axes allow separate repetition over initial-consonant, medial-vowel, and final-consonant indices.

The source glyph is first clipped to its **source group's size**. The import offset is then applied, and the result is clipped again to the **target group's size**. If a target group has a texture glyph, that image is its first layer; imported layers follow in import declaration order. Rules within an import, and their repetition axes, follow their declaration and index order. Multiple source glyphs may be placed at the same target index: they overlap as separate layers, rather than being assigned or overwritten.

For example, `from: [0, 3], to: 5` places `B[0..2]` at `A[5..7]`. Adding `repeat: [{count: 2, from_stride: 3, to_stride: 4}]` also places `B[3..5]` at `A[9..11]`.

## 4. Unicode mappings

A group's `unicode` list is optional. A mapping `{from: [a, b], to: U+XXXX}` associates `G[a + j]` with code point `U+XXXX + j` for every `j` such that `0 <= j < b - a`. A group without Unicode mappings can still be imported by other groups. An import does **not** inherit the source group's Unicode mappings. Only mapped glyphs are candidates for export.

Across all groups, assigning the same Unicode code point to distinct glyphs is an error. A single group glyph may be associated with multiple different code points as aliases. Mapped code points must be valid Unicode scalar values (surrogate code points are excluded).

## 5. Interpretation and renderer responsibilities

The specified result is a glyph-layer structure with defined order, local dimensions, offsets, and clipping regions. Whether overlapping pixels are alpha-composited or combined as masks, and how texture color, alpha, sampling, and TTF outline conversion are handled, are determined by the renderer's documented policies. Consequently, this specification does not require different renderers to produce identical final pixels.

Renderer policy is not unrestricted undefined behavior. For a valid definition, references, placements, clipping, and layer order have the meaning stated above. An implementation must report explicitly when it cannot handle a required texture format or rendering operation. TTF baseline, glyph advance, and conversion from logical pixels to font units belong in separate output settings.

## 6. Validity and validation

- If present, `metadata` must be a mapping; its `name`, `version`, and `author` fields, when present, must be strings. A group's `description`, when present, must be a string. Other metadata fields have no prescribed interpretation here.
- Texture-set names and source names within each set must be nonempty and unique; every registered source path must be a nonempty string. Every textured group must refer to an existing set and source within that set, whether or not its image is loaded. A path is a resource, not a reference name.
- Group names must be unique, every referenced group must exist, and the directed import-reference graph must contain no cycles.
- Each `size` component and each group `count` must be a positive integer. Every `from: [a, b]` must satisfy `0 <= a < b`. After repetition is expanded, all source and target indices must fall within their respective group bounds.
- When texture dimensions are available, every referenced glyph extraction rectangle must lie within its texture.
- Unicode mapping ranges must remain within their groups' index ranges and within the valid Unicode scalar-value range.
- Empty glyph images are valid. A mapped glyph, such as a space, may have no visible image.

## 7. Illustrative definition

```yaml
metadata:
  name: Example glyph set
  version: '0.1'
  author: Example Author
texture_sets:
  main:
    sheet: sheet.png
groups:
  B:
    description: Six glyphs from a horizontal texture strip.
    size: [8, 8]
    count: 6
    texture:
      set: main
      source: sheet
      start: [0, 0]
      direction: right

  A:
    description: Two overlapping imports with different offsets.
    size: [10, 8]
    count: 10
    imports:
      - group: B
        offset: [1, 0]
        at:
          - {from: [0, 3], to: 5}
          - {from: [3, 6], to: 0}
      - group: B
        offset: [2, 1]
        at:
          - {from: [0, 3], to: 5}
    unicode:
      - {from: [0, 3], to: 'U+AC00'}
      - {from: [5, 8], to: 'U+AC03'}

  Grid:
    description: A two-axis repetition of three-glyph blocks.
    size: [10, 8]
    count: 12
    imports:
      - group: B
        offset: [1, 0]
        at:
          - from: [0, 3]
            to: 0
            repeat:
              - {count: 2, from_stride: 3, to_stride: 6}
              - {count: 2, from_stride: 0, to_stride: 3}
```

Here `A[5..7]` receives `B[0..2]` once from each of two imports with different offsets; `A[0..2]` receives `B[3..5]`. Even when both imports refer to the same region of the source texture, they contribute distinct layers.

In `Grid`, the first (outer) repetition axis advances the source by 3 and the target by 6; the second (inner) axis repeats the same source glyphs at targets 3 indices apart. Thus `B[0..2]` appears at `Grid[0..2]` and `Grid[3..5]`, while `B[3..5]` appears at `Grid[6..8]` and `Grid[9..11]`. This group needs no `unicode` mapping because it is only an illustration of placement.

### 7.1. Full-scale example: 8 × 4 × 4-form Hangul

[`hangul.json`](examples/hangul.json) assigns the index `588L + 28V + T` to each Hangul syllable. Here `L ∈ [0, 19)` and `V ∈ [0, 21)` follow the Unicode initial-consonant and medial-vowel orders, while `T ∈ [0, 28)` follows the final-consonant order. `T = 0` denotes no final consonant. The final `unicode` range adds `U+AC00` to this index. Thus a `to_stride` of `588`, `28`, or `1` advances the initial, medial, or final component, respectively.

The example's texture, [`hangul.png`](examples/hangul.png), is converted from [`examples/hangul.bin`](examples/hangul.bin) by running `python3 tools/font_bin_to_png.py examples/hangul.bin` from the project root. It omits the first, reserved empty cell of each form and arranges 344 component glyphs in 16 × 16-pixel cells, 27 columns by 16 rows (432 × 256 pixels). The first eight rows contain 19 initial-consonant glyphs per form, the next four contain 21 medial-vowel glyphs per form, and the final four contain **27 final-consonant glyphs** per form. Unused cells at the right are not referenced. Across the 16 component groups, the number of source components is `8 × 19 + 4 × 21 + 4 × 27 = 344`.

Form selection adapts the *form distinctions* described in [`about_8x4x4.txt`](docs/about_8x4x4.txt) to Unicode L/V/T order. Initial consonants without a final consonant select among five forms, and those with a final consonant among three forms, according to the medial shape. The four medial forms depend on whether `L ∈ {0, 15}` (ㄱ or ㅋ) and whether a final consonant is present. The four final forms depend on the medial; no final component is imported when `T = 0`. This example does not literally reproduce the source text's older combination-code encoding, reserved cells, or C-array offsets.

The example defines all 11,172 Hangul syllables with 8 × 4 × 4-form composition. Nested repetition axes were adopted because a single repetition axis does not express the product of the L/V/T dimensions concisely.

The same declaration also maps printable ASCII U+0020–U+007E to the 8 × 16 glyph rows of [`ascii.png`](examples/ascii.png). A smaller standalone example, [`ascii.json`](examples/ascii.json), contains only those ASCII groups. Each texture row becomes one 16-glyph group because a texture's linear extraction direction does not wrap at the sheet edge.

## 8. Open design decisions

- Whether extraction directions will be restricted to the four provisionally recommended directions, and whether wrapping, spacing, or per-glyph boxes for irregularly packed images will be added to texture-bearing groups.
- The concrete persistence format and schema for definition files, and rules for resolving registered texture resource paths. The inspector's JSON implementation resolves relative paths against the definition file's directory.
- Concrete schemas for per-output rendering and font-metric settings.
