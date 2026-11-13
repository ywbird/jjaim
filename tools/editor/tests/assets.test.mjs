import assert from "node:assert/strict";
import test from "node:test";
import { blankTexture, minimumTextureSizes, sizeError } from "../src/assets.js";
import { parseDeclaration } from "../src/declaration.js";

const texture = (start, direction = "right") => ({ set: "main", source: "sheet", start, direction });
const doc = (groups) => parseDeclaration(JSON.stringify({ texture_sets: { main: { sheet: "sheet.png" } }, groups }));

test("minimum texture size covers every extraction box across directions", () => {
  const declaration = doc({
    right: { size: [2, 3], count: 4, texture: texture([1, 2]) },
    left: { size: [2, 3], count: 4, texture: texture([10, 2], "left") },
    down: { size: [2, 3], count: 4, texture: texture([1, 2], "down") },
    up: { size: [2, 3], count: 4, texture: texture([1, 14], "up") },
  });
  assert.deepEqual(minimumTextureSizes(declaration).get("sheet.png"), {
    width: 12,
    height: 17,
    minX: 1,
    minY: 2,
    error: null,
  });
});

test("same logical path aliases share the maximum requirement", () => {
  const declaration = parseDeclaration(
    JSON.stringify({
      texture_sets: { main: { a: "sheet.png", b: "./sheet.png" } },
      groups: {
        a: { size: [2, 1], count: 3, texture: { set: "main", source: "a", start: [0, 0], direction: "right" } },
        b: { size: [2, 1], count: 5, texture: { set: "main", source: "b", start: [0, 0], direction: "right" } },
      },
    }),
  );
  assert.equal(minimumTextureSizes(declaration).get("sheet.png").width, 10);
});

test("negative extraction coordinates cannot be satisfied by any PNG", () => {
  const declaration = doc({
    g: { size: [2, 2], count: 2, texture: texture([-1, 0]) },
  });
  const size = minimumTextureSizes(declaration).get("sheet.png");
  assert.equal(size.minX, -1);
  assert.match(size.error, /음수/);
  assert.match(sizeError(size, 100, 100), /음수/);
});

test("blank texture uses the declaration minimum and is fully transparent", () => {
  const image = blankTexture({ width: 3, height: 2, minX: 0, minY: 0, error: null });
  assert.equal(image.width, 3);
  assert.equal(image.height, 2);
  assert.deepEqual([...image.data], new Array(3 * 2 * 4).fill(0));
  assert.throws(() => blankTexture({ width: 1, height: 1, error: "음수 좌표" }), /음수 좌표/);
});

test("larger images pass and smaller images name the required size", () => {
  const required = { width: 10, height: 4, minX: 0, minY: 0, error: null };
  assert.equal(sizeError(required, 10, 4), null);
  assert.equal(sizeError(required, 20, 8), null);
  assert.equal(sizeError(required, 9, 4), "이미지 9×4, 최소 10×4 필요");
  assert.equal(sizeError(required, 10, 3), "이미지 10×3, 최소 10×4 필요");
});
