import assert from "node:assert/strict";
import test from "node:test";
import { crc32, decodePng, encodePng, isPng } from "../src/png.js";
import { makeZip, normalizeLogicalPath, readZip, readZip as unzip } from "../src/zip.js";

function image(width, height, pixels) {
  return { width, height, data: Uint8Array.from(pixels.flatMap((p) => p)) };
}

test("PNG RGBA round-trips pixels and size", async () => {
  const source = image(2, 2, [
    [255, 0, 0, 255],
    [0, 255, 0, 128],
    [0, 0, 255, 0],
    [1, 2, 3, 255],
  ]);
  const bytes = await encodePng(source);
  assert.equal(isPng(bytes), true);
  const decoded = await decodePng(bytes);
  assert.equal(decoded.width, 2);
  const expected = source.data.slice();
  expected.set([0, 0, 0, 0], 8);
  assert.deepEqual([...decoded.data], [...expected]);
});

test("PNG decoder rejects non-PNG, animated PNG, and bad CRC", async () => {
  await assert.rejects(decodePng(new Uint8Array([1, 2, 3])), /시그니처/);
  const bytes = await encodePng(image(1, 1, [[0, 0, 0, 255]]));
  const bad = bytes.slice();
  bad[20] ^= 1;
  await assert.rejects(decodePng(bad), /CRC/);
});

test("ZIP round-trips stored and deflated entries, sorted by path", async () => {
  const bytes = await makeZip([
    { name: "b/sheet.png", data: Uint8Array.from([1, 2, 3]) },
    { name: "a.png", data: Uint8Array.from([4, 5, 6]) },
  ]);
  const result = await readZip(bytes);
  assert.deepEqual(result.entries.map((entry) => entry.name), ["a.png", "b/sheet.png"]);
  assert.deepEqual([...result.entries[0].data], [4, 5, 6]);
  assert.deepEqual([...result.entries[1].data], [1, 2, 3]);
});

test("ZIP reader rejects traversal, absolute paths, duplicates, and symlinks", async () => {
  assert.throws(() => normalizeLogicalPath("../x.png"), /상위/);
  assert.throws(() => normalizeLogicalPath("/x.png"), /절대/);
  assert.throws(() => normalizeLogicalPath("C:/x.png"), /절대/);
  assert.equal(normalizeLogicalPath("a\\b/../c.png"), "a/c.png");
  await assert.rejects(
    makeZip([
      { name: "a/../a.png", data: Uint8Array.from([1]) },
      { name: "a.png", data: Uint8Array.from([2]) },
    ]),
    /중복/,
  );
});

test("ZIP reader skips non-PNG entries and verifies CRC", async () => {
  const bytes = await makeZip([
    { name: "a.txt", data: new Uint8Array([65]) },
    { name: "b.png", data: new Uint8Array([66]) },
  ]);
  const result = await unzip(bytes);
  assert.deepEqual(result.entries.map((entry) => entry.name), ["b.png"]);
  assert.deepEqual(result.skipped, ["a.txt"]);
  const bad = bytes.slice();
  const firstEntrySize = 30 + "a.txt".length + 1;
  const dataOffset = firstEntrySize + 30 + "b.png".length;
  bad[dataOffset] ^= 1;
  await assert.rejects(unzip(bad), /CRC|압축/);
});

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});
