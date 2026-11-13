import assert from "node:assert/strict";
import test from "node:test";
import { parseDeclaration } from "../src/declaration.js";
import { AssetStore } from "../src/assets.js";
import { encodePng } from "../src/png.js";
import { makeZip } from "../src/zip.js";
import { importImages, replaceAssets } from "../src/importer.js";
import { exportChanged, exportSingle, exportZip } from "../src/exporter.js";
import { readZip } from "../src/zip.js";
import { decodePng } from "../src/png.js";

const black = [0, 0, 0, 255];
const white = [255, 255, 255, 255];

function declaration(paths = { main: { sheet: "sheet.png" } }) {
  return parseDeclaration(
    JSON.stringify({
      texture_sets: paths,
      groups: {
        g: { size: [1, 1], count: 1, texture: { set: "main", source: "sheet", start: [0, 0], direction: "right" } },
      },
    }),
  );
}

function png(pixels) {
  return encodePng({ width: pixels.length, height: 1, data: Uint8Array.from(pixels.flat()) });
}

function file(name, bytes) {
  return { name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}

test("exact ZIP paths connect automatically, aliases share one asset", async () => {
  const declarationModel = declaration({
    main: { sheet: "images/sheet.png", a: "images/sheet.png", b: "./images/sheet.png" },
    other: { c: "images/other.png" },
  });
  const assets = new AssetStore();
  const bytes = await makeZip([
    { name: "images/sheet.png", data: await png([black]) },
    { name: "images/other.png", data: await png([white]) },
    { name: "unused.png", data: await png([black]) },
  ]);
  const result = await importImages(declarationModel, assets, [file("bundle.zip", bytes)]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.linked.sort(), ["images/other.png", "images/sheet.png"]);
  assert.equal(assets.assets.size, 2);
  assert.ok(result.unreferenced.includes("unused.png"));
});

test("plain basename links only when unique; prefix folders are not stripped", async () => {
  const ambiguous = parseDeclaration(
    JSON.stringify({
      texture_sets: { main: { a: "a/sheet.png", b: "b/sheet.png" } },
      groups: {
        g: { size: [1, 1], count: 1, texture: { set: "main", source: "a", start: [0, 0], direction: "right" } },
      },
    }),
  );
  const assets = new AssetStore();
  const result = await importImages(ambiguous, assets, [file("sheet.png", await png([black]))]);
  assert.deepEqual(result.linked, []);
  assert.equal(assets.assets.size, 0);

  const prefixed = await makeZip([{ name: "bundle/sheet.png", data: await png([black]) }]);
  const prefixResult = await importImages(declaration(), new AssetStore(), [file("x.zip", prefixed)]);
  assert.deepEqual(prefixResult.linked, []);
});

test("replace requires matching size and records a full current image swap", async () => {
  const declarationModel = declaration();
  const assets = new AssetStore();
  await importImages(declarationModel, assets, [file("sheet.png", await png([black]))]);
  const replacement = await png([white]);
  const before = assets.snapshot();
  await replaceAssets(declarationModel, assets, [{ path: "sheet.png", bytes: replacement }]);
  assert.deepEqual([...assets.get("sheet.png").current], white);
  assert.deepEqual([...before.get("sheet.png")], black);
  assert.deepEqual([...assets.get("sheet.png").original], black);
  await assert.rejects(replaceAssets(declarationModel, assets, [{ path: "sheet.png", bytes: await encodePng({ width: 2, height: 1, data: new Uint8Array(8) }) }]), /크기/);
});

test("export writes full textures, sorted ZIP paths, and PNG-only entries", async () => {
  const declarationModel = declaration();
  const assets = new AssetStore();
  assets.bind("b/sheet.png", await decodePng(await png([black, white])));
  assets.bind("a.png", await decodePng(await png([white])));
  const single = await exportSingle(assets, "b/sheet.png");
  assert.equal(single.name, "sheet.png");
  assert.deepEqual([...(await decodePng(single.bytes)).data], [...black, ...white]);

  const zip = await exportZip(assets, ["b/sheet.png", "a.png"], "작업 이름");
  assert.equal(zip.name, "작업 이름-textures.zip");
  const result = await readZip(zip.bytes);
  assert.deepEqual(result.entries.map((entry) => entry.name), ["a.png", "b/sheet.png"]);
  assert.deepEqual([...(await decodePng(result.entries[1].data)).data], [...black, ...white]);
  assets.get("a.png").current.set(black, 0);
  const changed = await exportChanged(assets, "x");
  assert.equal(changed.name, "x-textures.zip");
  assert.deepEqual((await readZip(changed.bytes)).entries.map((entry) => entry.name), ["a.png"]);
});
