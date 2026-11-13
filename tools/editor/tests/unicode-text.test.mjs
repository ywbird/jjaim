import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseDeclaration } from "../src/declaration.js";
import { AssetStore } from "../src/assets.js";
import { Renderer } from "../src/compose.js";
import {
  BUILT_IN_SETS,
  charactersForSet,
  discoverSets,
  filterCharacters,
  paginate,
  splitScalars,
} from "../src/unicode-sets.js";
import { buildTextModel, renderText } from "../src/text.js";

const example = (name) => readFileSync(new URL(`../../../examples/${name}`, import.meta.url), "utf8");
const black = [0, 0, 0, 255];
const clear = [0, 0, 0, 0];

test("built-in Unicode sets have the specified sizes", () => {
  const declaration = parseDeclaration(example("ascii.json"));
  const sizes = Object.fromEntries(BUILT_IN_SETS.map((set) => [set.id, charactersForSet(set.id, declaration).length]));
  assert.deepEqual(sizes, {
    current: 95,
    ascii: 95,
    latin1: 128,
    "hangul-compat": 96,
    "hangul-syllables": 11172,
    ksx1001: 2350,
    arrows: 112,
    currency: 48,
  });
  const ks = charactersForSet("ksx1001", declaration);
  assert.equal(new Set(ks).size, 2350);
  assert.equal(Math.min(...ks), 0xac00);
  assert.equal(Math.max(...ks), 0xd79d);
  const discovered = discoverSets(declaration);
  assert.equal(discovered.find((set) => set.id === "ascii").mapped, 95);
  assert.equal(discovered.find((set) => set.id === "ksx1001").mapped, 0);
});

test("mapped filter, scalar search, and pagination preserve total order without duplicates", () => {
  const declaration = parseDeclaration(example("hangul.json"));
  const mapped = discoverSets(declaration).find((set) => set.id === "hangul-syllables");
  assert.equal(mapped.all, 11172);
  assert.equal(mapped.mapped, 11172);
  const filtered = filterCharacters(charactersForSet("hangul-syllables", declaration), "가각나");
  assert.deepEqual(filtered, [0xac00, 0xac01, 0xb098]);
  assert.deepEqual(splitScalars("A😀A"), [0x41, 0x1f600]);

  const items = Array.from({ length: 300 }, (_, index) => index);
  const first = paginate(items, 0, 128);
  const last = paginate(items, 99, 128);
  assert.equal(first.pageCount, 3);
  assert.equal(last.page, 2);
  assert.deepEqual(last.items, [256, 257, 258, 259, 260, 261, 262, 263, 264, 265, 266, 267, 268, 269, 270, 271, 272, 273, 274, 275, 276, 277, 278, 279, 280, 281, 282, 283, 284, 285, 286, 287, 288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299]);
  assert.equal(paginate([], 5, 64).page, 0);
  const all = [...first.items, ...paginate(items, 1, 128).items, ...last.items];
  assert.equal(all.length, 300);
  assert.equal(new Set(all).size, 300);
});

test("text preview uses mapped widths, global line height, boxes, and NUL substitution", () => {
  const declaration = parseDeclaration(
    JSON.stringify({
      groups: {
        big: { size: [3, 4], count: 1, unicode: [{ from: [0, 1], to: "U+0041" }] },
        small: { size: [1, 2], count: 1, unicode: [{ from: [0, 1], to: "U+0042" }] },
        nul: { size: [2, 1], count: 1, unicode: [{ from: [0, 1], to: "U+0000" }] },
      },
    }),
  );
  const assets = new AssetStore();
  assets.bind("sheet.png", { width: 5, height: 4, data: new Uint8Array(5 * 4 * 4) });
  assets.get("sheet.png").current.fill(0);
  const model = buildTextModel(declaration, "AB\r\nC");
  assert.equal(model.lineHeight, 4);
  assert.equal(model.boxWidth, 3);
  assert.equal(model.lines.length, 2);
  assert.equal(model.lines[0][0].width, 3);
  assert.equal(model.lines[0][1].width, 1);
  assert.equal(model.lines[1][0].kind, "substitute");
  assert.equal(model.lines[1][0].width, 2);

  const renderer = new Renderer(declaration, assets);
  const empty = renderText(declaration, renderer, "");
  assert.equal(empty.image.height, 4);
  assert.equal(empty.image.width, 1);
  const result = renderText(declaration, renderer, "AB");
  assert.equal(result.image.width, 4);
  assert.equal(result.image.height, 4);
});

test("text preview reflects a committed pixel edit", () => {
  const declaration = parseDeclaration(
    JSON.stringify({
      texture_sets: { main: { sheet: "sheet.png" } },
      groups: {
        a: { size: [1, 1], count: 1, texture: { set: "main", source: "sheet", start: [0, 0], direction: "right" }, unicode: [{ from: [0, 1], to: "U+0041" }] },
      },
    }),
  );
  const assets = new AssetStore();
  assets.bind("sheet.png", { width: 1, height: 1, data: Uint8Array.from(clear) });
  const renderer = new Renderer(declaration, assets);
  assert.equal(renderText(declaration, renderer, "A").image.data[3], 0);
  assets.get("sheet.png").current.set(black, 0);
  renderer.invalidate();
  assert.equal(renderText(declaration, renderer, "A").image.data[3], 255);
});
