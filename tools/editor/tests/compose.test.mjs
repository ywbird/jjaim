import assert from "node:assert/strict";
import test from "node:test";
import { parseDeclaration } from "../src/declaration.js";
import { AssetStore } from "../src/assets.js";
import {
  Renderer,
  actualChanges,
  affectedCharacters,
  affectedGroupsForRect,
  buildLayerTree,
  diffImages,
  flattenLayers,
  sameImage,
} from "../src/compose.js";

const rgba = (r, g, b, a = 255) => [r, g, b, a];
const img = (width, height, pixels) => ({ width, height, data: Uint8Array.from(pixels.flat()) });
const doc = (groups, textureSets = { main: { sheet: "sheet.png" } }) => parseDeclaration(JSON.stringify({ groups, texture_sets: textureSets }));

function onePixel(value) {
  return { size: [1, 1], count: 1, texture: { set: "main", source: "sheet", start: [value, 0], direction: "right" } };
}

test("extraction directions and own-first layer order", () => {
  const declaration = doc({
    child: { size: [1, 1], count: 3, texture: { set: "main", source: "sheet", start: [1, 0], direction: "right" } },
    parent: {
      size: [1, 1],
      count: 1,
      texture: { set: "main", source: "sheet", start: [0, 0], direction: "right" },
      imports: [{ group: "child", offset: [0, 0], at: [{ from: [0, 1], to: 0 }] }],
    },
  });
  const assets = new AssetStore();
  assets.bind("sheet.png", img(4, 1, [rgba(255, 0, 0), rgba(0, 255, 0), rgba(0, 0, 255), rgba(255, 255, 255)]));
  const renderer = new Renderer(declaration, assets);
  const result = renderer.renderGlyph("parent", 0);
  assert.deepEqual(result.errors, []);
  assert.deepEqual([...result.image.data], rgba(0, 255, 0));

  const left = doc({
    g: { size: [1, 1], count: 2, texture: { set: "main", source: "sheet", start: [3, 0], direction: "left" } },
  });
  const leftRenderer = new Renderer(left, assets);
  assert.deepEqual([...leftRenderer.renderGlyph("g", 0).image.data], rgba(255, 255, 255));
  assert.deepEqual([...leftRenderer.renderGlyph("g", 1).image.data], rgba(0, 0, 255));
});

test("down and up extraction, negative offset, and clipping", () => {
  const assets = new AssetStore();
  assets.bind("sheet.png", img(2, 3, [
    rgba(1, 0, 0), rgba(1, 1, 0),
    rgba(2, 0, 0), rgba(2, 1, 0),
    rgba(3, 0, 0), rgba(3, 1, 0),
  ]));
  const down = doc({
    g: { size: [2, 1], count: 2, texture: { set: "main", source: "sheet", start: [0, 0], direction: "down" } },
  });
  const downRenderer = new Renderer(down, assets);
  assert.deepEqual([...downRenderer.renderGlyph("g", 1).image.data], [...rgba(2, 0, 0), ...rgba(2, 1, 0)]);

  const up = doc({
    g: { size: [2, 1], count: 2, texture: { set: "main", source: "sheet", start: [0, 2], direction: "up" } },
  });
  const upRenderer = new Renderer(up, assets);
  assert.deepEqual([...upRenderer.renderGlyph("g", 0).image.data], [...rgba(3, 0, 0), ...rgba(3, 1, 0)]);
  assert.deepEqual([...upRenderer.renderGlyph("g", 1).image.data], [...rgba(2, 0, 0), ...rgba(2, 1, 0)]);

  const clipped = doc({
    child: { size: [2, 1], count: 1, texture: { set: "main", source: "sheet", start: [0, 0], direction: "right" } },
    parent: {
      size: [2, 1],
      count: 1,
      imports: [{ group: "child", offset: [-1, 0], at: [{ from: [0, 1], to: 0 }] }],
    },
  });
  const clippedRenderer = new Renderer(clipped, assets);
  assert.deepEqual([...clippedRenderer.renderGlyph("parent", 0).image.data], [...rgba(1, 1, 0), ...rgba(0, 0, 0, 0)]);
});

test("intermediate clipping is not flattened away", () => {
  const declaration = doc({
    source: { size: [1, 1], count: 3, texture: { set: "main", source: "sheet", start: [0, 0], direction: "right" } },
    middle: {
      size: [2, 1],
      count: 2,
      texture: { set: "main", source: "sheet", start: [0, 0], direction: "right" },
    },
    top: {
      size: [3, 1],
      count: 1,
      imports: [{ group: "middle", offset: [0, 0], at: [{ from: [0, 1], to: 0 }] }],
    },
  });
  const assets = new AssetStore();
  assets.bind("sheet.png", img(3, 1, [rgba(1, 0, 0), rgba(2, 0, 0), rgba(3, 0, 0)]));
  const renderer = new Renderer(declaration, assets);
  const result = renderer.renderGlyph("top", 0);
  assert.deepEqual([...result.image.data], [...rgba(1, 0, 0), ...rgba(2, 0, 0), ...rgba(0, 0, 0, 0)]);
});

test("source-over uses straight alpha and keeps own layer first", () => {
  const declaration = doc({
    parent: {
      size: [1, 1],
      count: 1,
      texture: { set: "main", source: "sheet", start: [0, 0], direction: "right" },
      imports: [{ group: "child", offset: [0, 0], at: [{ from: [0, 1], to: 0 }] }],
    },
    child: { size: [1, 1], count: 1, texture: { set: "main", source: "sheet", start: [1, 0], direction: "right" } },
  });
  const assets = new AssetStore();
  assets.bind("sheet.png", img(2, 1, [rgba(255, 0, 0), rgba(0, 0, 255, 128)]));
  const result = new Renderer(declaration, assets).renderGlyph("parent", 0);
  assert.deepEqual([...result.image.data], [127, 0, 128, 255]);
});

test("layer tree assigns stable occurrence ids and hides one duplicate", () => {
  const declaration = doc({
    child: { size: [1, 1], count: 1, texture: { set: "main", source: "sheet", start: [0, 0], direction: "right" } },
    parent: {
      size: [2, 1],
      count: 1,
      imports: [
        { group: "child", offset: [0, 0], at: [{ from: [0, 1], to: 0 }] },
        { group: "child", offset: [1, 0], at: [{ from: [0, 1], to: 0 }] },
      ],
    },
  });
  const assets = new AssetStore();
  assets.bind("sheet.png", img(1, 1, [rgba(0, 255, 0)]));
  const renderer = new Renderer(declaration, assets);
  const tree = buildLayerTree(declaration, "parent", 0);
  const layers = flattenLayers(tree.root);
  assert.equal(layers.length, 2);
  assert.notEqual(layers[0].id, layers[1].id);
  const hidden = new Set([layers[0].id]);
  const result = renderer.renderGlyph("parent", 0, hidden);
  assert.deepEqual([...result.image.data], [...rgba(0, 0, 0, 0), ...rgba(0, 255, 0)]);
  assert.equal(sameImage(renderer.renderGlyph("parent", 0).image, renderer.renderGlyph("parent", 0).image), true);
});

test("shared physical image affects both extraction groups and their characters", () => {
  const declaration = doc({
    g: { size: [2, 1], count: 1, texture: { set: "main", source: "sheet", start: [0, 0], direction: "right" }, unicode: [{ from: [0, 1], to: "U+0041" }] },
    h: { size: [2, 1], count: 1, texture: { set: "main", source: "sheet", start: [1, 0], direction: "right" }, unicode: [{ from: [0, 1], to: "U+0042" }] },
  });
  const assets = new AssetStore();
  assets.bind("sheet.png", img(3, 1, [rgba(1, 0, 0), rgba(2, 0, 0), rgba(3, 0, 0)]));
  const groups = affectedGroupsForRect(declaration, assets, "sheet.png", { x: 1, y: 0, width: 1, height: 1 });
  assert.deepEqual(groups.map((g) => g.group).sort(), ["g", "h"]);
  assert.deepEqual(affectedCharacters(declaration, assets, new Map([["sheet.png", [{ x: 1, y: 0, width: 1, height: 1 }]]])), [0x41, 0x42]);
});

test("pixel diff classifies added, removed, and changed while ignoring hidden transparent RGB", () => {
  const before = img(3, 1, [rgba(9, 9, 9, 0), rgba(0, 0, 0), rgba(10, 20, 30, 128)]);
  const after = img(3, 1, [rgba(0, 0, 0), rgba(7, 7, 7, 0), rgba(10, 20, 31, 128)]);
  const result = diffImages(before, after);
  assert.deepEqual(result.counts, { added: 1, removed: 1, changed: 1, same: 0 });
  assert.deepEqual(result.rows, ["ARC"]);
});

test("actual changes exclude structurally referenced but clipped glyphs", () => {
  const declaration = doc({
    child: { size: [1, 1], count: 1, texture: { set: "main", source: "sheet", start: [0, 0], direction: "right" }, unicode: [{ from: [0, 1], to: "U+0043" }] },
    parent: {
      size: [1, 1],
      count: 1,
      unicode: [{ from: [0, 1], to: "U+0041" }],
      imports: [{ group: "child", offset: [10, 0], at: [{ from: [0, 1], to: 0 }] }],
    },
  });
  const assets = new AssetStore();
  assets.bind("sheet.png", img(1, 1, [rgba(0, 0, 0, 0)]));
  const before = assets.snapshot();
  assets.get("sheet.png").current.set(rgba(255, 0, 0), 0);
  const candidates = affectedCharacters(declaration, assets, new Map([["sheet.png", [{ x: 0, y: 0, width: 1, height: 1 }]]]));
  assert.deepEqual(candidates, [0x41, 0x43]);
  const actual = actualChanges(declaration, assets, new Map(), candidates, before);
  assert.deepEqual(actual.changed, [0x43]);
  assert.deepEqual(actual.unknown, []);
});
