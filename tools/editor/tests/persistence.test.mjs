import assert from "node:assert/strict";
import test from "node:test";
import { parseDeclaration } from "../src/declaration.js";
import { AssetStore } from "../src/assets.js";
import { History } from "../src/history.js";
import { deserializeWorkspace, saveWorkspace, serializeWorkspace } from "../src/persistence.js";

test("workspace serialization keeps declaration, original pixels, and full history", () => {
  const text = JSON.stringify({
    texture_sets: { main: { sheet: "sheet.png" } },
    groups: { g: { size: [1, 1], count: 1, texture: { set: "main", source: "sheet", start: [0, 0], direction: "right" } } },
  });
  const declaration = parseDeclaration(text);
  const assets = new AssetStore();
  assets.bind("sheet.png", { width: 1, height: 1, data: Uint8Array.from([0, 0, 0, 0]) });
  const history = new History(assets);
  history.commit(new Map([["sheet.png", [{ x: 0, y: 0, before: [0, 0, 0, 0], after: [0, 0, 0, 255] }]]]));
  const workspace = {
    id: "w1",
    name: "작업",
    fileName: "x.json",
    declaration,
    assets,
    history,
    view: { selected: { group: "g", index: 0 } },
    font: null,
    createdAt: 1,
  };
  const restored = deserializeWorkspace(serializeWorkspace(workspace));
  assert.equal(restored.declaration.text, text);
  assert.equal(restored.history.headId, history.headId);
  assert.equal(restored.history.revisions.size, 2);
  assert.deepEqual([...restored.assets.get("sheet.png").current], [0, 0, 0, 255]);
  assert.deepEqual([...restored.assets.get("sheet.png").original], [0, 0, 0, 0]);
  assert.throws(() => deserializeWorkspace({ schemaVersion: 99 }), /스키마/);
});

test("restoring a workspace rejects an asset below the declaration minimum", () => {
  const text = JSON.stringify({
    texture_sets: { main: { sheet: "sheet.png" } },
    groups: { g: { size: [2, 1], count: 1, texture: { set: "main", source: "sheet", start: [0, 0], direction: "right" } } },
  });
  const assets = new AssetStore();
  assets.bind("sheet.png", { width: 1, height: 1, data: Uint8Array.from([0, 0, 0, 0]) });
  const history = new History(assets);
  const raw = serializeWorkspace({
    id: "w2",
    name: "작업",
    fileName: "x.json",
    declaration: parseDeclaration(text),
    assets,
    history,
    view: {},
    font: null,
    createdAt: 1,
  });
  assert.throws(() => deserializeWorkspace(raw), /최소|열 수 없습니다/);
});

test("storage failures are reported instead of silently succeeding", async () => {
  await assert.rejects(saveWorkspace({}), /IndexedDB/);
});
