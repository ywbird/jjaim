import assert from "node:assert/strict";
import test from "node:test";
import { AssetStore } from "../src/assets.js";
import { History } from "../src/history.js";
import { PixelDraft } from "../src/pixels.js";

const black = [0, 0, 0, 255];
const clear = [0, 0, 0, 0];

function assetFrom(pixels, width = pixels.length) {
  const assets = new AssetStore();
  assets.bind("sheet.png", { width, height: 1, data: Uint8Array.from(pixels.flatMap((p) => p)) });
  return { assets, asset: assets.get("sheet.png") };
}

test("pixel draft applies pencil, eraser, and interpolated lines as one change set", () => {
  const { assets, asset } = assetFrom([clear, clear, clear, clear]);
  const draft = new PixelDraft(asset, { x: 0, y: 0, width: 4, height: 1 });
  draft.set(0, 0, black);
  draft.line(0, 0, 3, 0, black);
  draft.erase(2, 0);
  const changes = draft.changes();
  assert.deepEqual(changes.map((c) => c.x), [0, 1, 3]);
  assert.deepEqual(changes[0].after, black);
  assert.equal(assets.get("sheet.png").current[0], 0);
});

test("selection move uses a snapshot, overwrites transparency, and trims outside the glyph", () => {
  const { assets, asset } = assetFrom([black, clear, black, black, clear]);
  const draft = new PixelDraft(asset, { x: 0, y: 0, width: 5, height: 1 });
  const moved = draft.move({ x: 0, y: 0, width: 2, height: 1 }, 2, 0);
  assert.deepEqual(moved, { dx: 2, dy: 0 });
  const alpha = [0, 1, 2, 3, 4].map((x) => draft.data[x * 4 + 3]);
  assert.deepEqual(alpha.map((a) => (a === 255 ? 1 : 0)), [0, 0, 1, 0, 0]);

  const outside = new PixelDraft(asset, { x: 0, y: 0, width: 5, height: 1 });
  const beyond = outside.move({ x: 2, y: 0, width: 2, height: 1 }, 10, 0);
  assert.deepEqual(beyond, { dx: 10, dy: 0 });
  assert.deepEqual([0, 1, 2, 3, 4].map((x) => outside.data[x * 4 + 3]), [255, 0, 0, 0, 0]);

  const partial = new PixelDraft(asset, { x: 0, y: 0, width: 5, height: 1 });
  partial.move({ x: 0, y: 0, width: 2, height: 1 }, 4, 0);
  assert.deepEqual([0, 1, 2, 3, 4].map((x) => partial.data[x * 4 + 3]), [0, 0, 255, 255, 255]);
});

test("paste composites source over and trims outside the glyph", () => {
  const { assets, asset } = assetFrom([black, clear, [255, 255, 255, 255]]);
  const draft = new PixelDraft(asset, { x: 0, y: 0, width: 3, height: 1 });
  draft.paste(
    { x: 0, y: 0, width: 3, height: 1 },
    Uint8Array.from([255, 0, 0, 128, 0, 255, 0, 255, 0, 0, 0, 0]),
  );
  assert.deepEqual([...draft.data.slice(0, 4)], [128, 0, 0, 255]);
  assert.deepEqual([...draft.data.slice(4, 8)], [0, 255, 0, 255]);
  assert.deepEqual([...draft.data.slice(8, 12)], [255, 255, 255, 255]);
  assert.equal(assets.get("sheet.png").current[0], 0);

  const trimmed = new PixelDraft(asset, { x: 0, y: 0, width: 3, height: 1 });
  trimmed.paste({ x: 2, y: 0, width: 2, height: 1 }, Uint8Array.from([0, 0, 255, 255, 255, 0, 0, 255]));
  assert.deepEqual([...trimmed.data.slice(0, 4)], [0, 0, 0, 255]);
  assert.deepEqual([...trimmed.data.slice(4, 8)], [0, 0, 0, 0]);
  assert.deepEqual([...trimmed.data.slice(8, 12)], [0, 0, 255, 255]);
});

test("history supports undo/redo and preserves abandoned branches", () => {
  const { assets, asset } = assetFrom([clear, clear, clear]);
  const history = new History(assets);
  const first = history.commit(new Map([["sheet.png", [
    { x: 0, y: 0, before: [0, 0, 0, 0], after: black },
    { x: 1, y: 0, before: [0, 0, 0, 0], after: black },
  ]]]));
  const second = history.commit(new Map([["sheet.png", [
    { x: 2, y: 0, before: [0, 0, 0, 0], after: black },
  ]]]));
  assert.equal(history.headId, second.id);
  assert.equal(asset.current[3], 255);
  history.undo();
  assert.equal(history.headId, first.id);
  assert.equal(asset.current[11], 0);
  history.undo();
  assert.equal(history.headId, "r0");
  assert.equal(asset.current[3], 0);
  history.redo();
  history.redo();
  assert.equal(history.headId, second.id);
  assert.equal(asset.current[11], 255);

  history.undo();
  const branch = history.commit(new Map([["sheet.png", [
    { x: 2, y: 0, before: [0, 0, 0, 0], after: [255, 0, 0, 255] },
  ]]]));
  assert.notEqual(branch.id, second.id);
  assert.equal(history.revision(second.id).changes.size, 1);
  history.undo();
  history.redo();
  assert.equal(history.headId, branch.id);
});

test("restore writes a new undoable revision and leaves history intact", () => {
  const { assets, asset } = assetFrom([clear, clear]);
  const history = new History(assets);
  history.commit(new Map([["sheet.png", [
    { x: 0, y: 0, before: [0, 0, 0, 0], after: black },
    { x: 1, y: 0, before: [0, 0, 0, 0], after: black },
  ]]]));
  const restored = history.restore("r0");
  assert.equal(restored.kind, "restore");
  assert.equal(asset.current[3], 0);
  history.undo();
  assert.equal(asset.current[3], 255);
  assert.equal(history.revisions.size, 3);
});

test("later assets keep their own original across earlier revisions", () => {
  const { assets } = assetFrom([clear]);
  const history = new History(assets);
  history.commit(new Map([["sheet.png", [{ x: 0, y: 0, before: [0, 0, 0, 0], after: black }]]]));
  assets.bind("late.png", { width: 1, height: 1, data: Uint8Array.from(black) });
  const rootState = history.stateAt("r0");
  assert.deepEqual([...rootState.get("late.png")], black);
  assert.deepEqual([...rootState.get("sheet.png")], clear);
  assert.deepEqual([...history.stateAt(history.headId).get("sheet.png")], black);
});

test("applied commits record replacements without re-applying or revalidating", () => {
  const { assets, asset } = assetFrom([clear]);
  const history = new History(assets);
  asset.current.set(black, 0);
  const revision = history.commit(
    new Map([["sheet.png", [{ x: 0, y: 0, before: clear, after: black }]]]),
    { kind: "replace" },
    { applied: true },
  );
  assert.equal(revision.kind, "replace");
  assert.deepEqual([...asset.current], black);
  history.undo();
  assert.deepEqual([...asset.current], clear);
  history.redo();
  assert.deepEqual([...asset.current], black);
});

test("history serializes and restores its head and branch choice", () => {
  const { assets, asset } = assetFrom([clear]);
  const history = new History(assets);
  history.commit(new Map([["sheet.png", [{ x: 0, y: 0, before: [0, 0, 0, 0], after: black }]]]));
  const restored = History.fromJSON(assets, JSON.parse(JSON.stringify(history.toJSON())));
  assert.equal(restored.headId, history.headId);
  assert.equal(restored.revisions.size, history.revisions.size);
  assert.equal(asset.current[3], 255);
});
