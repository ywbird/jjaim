import assert from "node:assert/strict";
import test from "node:test";
import { buildCmapLookup, fontHasCodepoint, readFontTables, clampShadowSettings } from "../src/font.js";
import { deflate } from "../src/png.js";

const be16 = (a, o, v) => {
  a[o] = (v >> 8) & 255;
  a[o + 1] = v & 255;
};
const be32 = (a, o, v) => {
  a[o] = (v >>> 24) & 255;
  a[o + 1] = (v >>> 16) & 255;
  a[o + 2] = (v >>> 8) & 255;
  a[o + 3] = v & 255;
};

function cmap4() {
  const cm = new Uint8Array(44);
  be16(cm, 0, 0);
  be16(cm, 2, 1);
  be16(cm, 4, 3);
  be16(cm, 6, 1);
  be32(cm, 8, 12);
  const start = 12;
  be16(cm, start, 4);
  be16(cm, start + 2, 32);
  be16(cm, start + 4, 0);
  be16(cm, start + 6, 4);
  be16(cm, start + 8, 4);
  be16(cm, start + 10, 1);
  be16(cm, start + 12, 0);
  be16(cm, start + 14, 0x41);
  be16(cm, start + 16, 0xffff);
  be16(cm, start + 18, 0);
  be16(cm, start + 20, 0x41);
  be16(cm, start + 22, 0xffff);
  be16(cm, start + 24, 65476);
  be16(cm, start + 26, 1);
  return cm;
}

function cmap12() {
  const cm = new Uint8Array(52);
  be16(cm, 0, 0);
  be16(cm, 2, 1);
  be16(cm, 4, 3);
  be16(cm, 6, 10);
  be32(cm, 8, 12);
  const start = 12;
  be16(cm, start, 12);
  be16(cm, start + 2, 0);
  be32(cm, start + 4, 40);
  be32(cm, start + 8, 0);
  be32(cm, start + 12, 2);
  be32(cm, start + 16, 0x41);
  be32(cm, start + 20, 0x41);
  be32(cm, start + 24, 5);
  be32(cm, start + 28, 0x1f600);
  be32(cm, start + 32, 0x1f600);
  be32(cm, start + 36, 7);
  return cm;
}

function sfnt(cmap) {
  const out = new Uint8Array(28 + cmap.length);
  be32(out, 0, 0x00010000);
  be16(out, 4, 1);
  out.set([0x63, 0x6d, 0x61, 0x70], 12);
  be32(out, 20, 28);
  be32(out, 24, cmap.length);
  out.set(cmap, 28);
  return out;
}

test("reads TTF cmap format 4 and 12 including non-BMP", async () => {
  const format4 = sfnt(cmap4());
  assert.equal(await fontHasCodepoint(format4, "a.ttf", 0x41), true);
  assert.equal(await fontHasCodepoint(format4, "a.ttf", 0x42), false);
  const tables = await readFontTables(format4, "a.ttf");
  assert.equal(buildCmapLookup(tables.get("cmap"))(0x41), 5);

  const format12 = sfnt(cmap12());
  assert.equal(await fontHasCodepoint(format12, "a.otf", 0x1f600), true);
  assert.equal(await fontHasCodepoint(format12, "a.otf", 0x42), false);
});

test("rejects WOFF2, TTC, unsupported extensions, and fonts without cmap", async () => {
  const woff2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32]);
  await assert.rejects(readFontTables(woff2, "a.woff2"), /WOFF2/);
  const ttc = new Uint8Array([0x74, 0x74, 0x63, 0x66]);
  await assert.rejects(readFontTables(ttc, "a.ttc"), /TTC/);
  await assert.rejects(readFontTables(sfnt(cmap4()), "a.svg"), /확장자/);
  const noCmap = sfnt(cmap4()).slice(0, 28);
  await assert.rejects(readFontTables(noCmap, "a.ttf"), /cmap|테이블/);
});

test("reads a WOFF1 table compressed with zlib", async () => {
  const cmap = cmap4();
  const compressed = await deflate(cmap, "deflate");
  const out = new Uint8Array(44 + 20 + compressed.length);
  out.set([0x77, 0x4f, 0x46, 0x46], 0);
  be16(out, 12, 1);
  out.set([0x63, 0x6d, 0x61, 0x70], 44);
  be32(out, 48, 64);
  be32(out, 52, compressed.length);
  be32(out, 56, cmap.length);
  out.set(compressed, 64);
  const tables = await readFontTables(out, "a.woff");
  assert.equal(buildCmapLookup(tables.get("cmap"))(0x41), 5);
});

test("shadow settings are clamped to the documented ranges", () => {
  assert.deepEqual(clampShadowSettings({ size: 2000, x: -9999, y: 9999, opacity: 3, visible: 1 }), {
    size: 1024,
    x: -4096,
    y: 4096,
    opacity: 1,
    visible: true,
  });
});
