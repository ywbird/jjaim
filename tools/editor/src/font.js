import { inflate } from "./png.js";

export const FONT_LIMITS = { bytes: 32 * 1024 * 1024 };

export class FontError extends Error {
  constructor(message) {
    super(message);
    this.name = "FontError";
  }
}

const u16 = (view, offset) => (view[offset] << 8) | view[offset + 1];
const u32 = (view, offset) => ((view[offset] << 24) | (view[offset + 1] << 16) | (view[offset + 2] << 8) | view[offset + 3]) >>> 0;
const tag = (view, offset) => String.fromCharCode(view[offset], view[offset + 1], view[offset + 2], view[offset + 3]);

function extension(name) {
  return String(name).slice(String(name).lastIndexOf(".") + 1).toLowerCase();
}

export async function readFontTables(bytes, fileName = "font.ttf") {
  if (bytes.length > FONT_LIMITS.bytes) throw new FontError("폰트 파일이 32 MiB 한도를 넘습니다");
  const ext = extension(fileName);
  if (ext === "woff2") throw new FontError("WOFF2는 지원하지 않습니다. WOFF1을 사용하세요");
  if (ext === "ttc" || ext === "otc") throw new FontError("TTC/OTC 컬렉션은 지원하지 않습니다");
  if (!["ttf", "otf", "woff"].includes(ext)) throw new FontError("지원하지 않는 폰트 확장자입니다");
  const view = bytes;
  const signature = tag(view, 0);
  if (signature === "wOF2") throw new FontError("WOFF2는 지원하지 않습니다. WOFF1을 사용하세요");
  if (signature === "ttcf") throw new FontError("TTC/OTC 컬렉션은 지원하지 않습니다");
  const tables = new Map();
  if (signature === "wOFF") {
    const numTables = u16(view, 12);
    if (numTables <= 0) throw new FontError("WOFF 테이블이 없습니다");
    let offset = 44;
    for (let i = 0; i < numTables; i += 1) {
      if (offset + 20 > view.length) throw new FontError("WOFF 테이블 디렉터리가 잘렸습니다");
      const name = tag(view, offset);
      const tableOffset = u32(view, offset + 4);
      const compressedLength = u32(view, offset + 8);
      const originalLength = u32(view, offset + 12);
      if (tableOffset + compressedLength > view.length) throw new FontError("WOFF 테이블이 잘렸습니다");
      const raw = view.subarray(tableOffset, tableOffset + compressedLength);
      tables.set(name, compressedLength < originalLength ? await inflate(raw, "deflate") : raw.slice());
      offset += 20;
    }
  } else {
    if (!["\u0000\u0001\u0000\u0000", "OTTO", "true"].includes(signature)) throw new FontError("지원하지 않는 폰트 형식입니다");
    const numTables = u16(view, 4);
    if (numTables <= 0) throw new FontError("폰트 테이블이 없습니다");
    for (let i = 0; i < numTables; i += 1) {
      const offset = 12 + i * 16;
      if (offset + 16 > view.length) throw new FontError("폰트 테이블 디렉터리가 잘렸습니다");
      const name = tag(view, offset);
      const tableOffset = u32(view, offset + 8);
      const length = u32(view, offset + 12);
      if (tableOffset + length > view.length) throw new FontError("폰트 테이블이 잘렸습니다");
      tables.set(name, view.subarray(tableOffset, tableOffset + length));
    }
  }
  if (!tables.has("cmap")) throw new FontError("폰트에 cmap 테이블이 없습니다");
  return tables;
}

function parseFormat4(cm) {
  const segCountX2 = u16(cm, 6);
  const segCount = segCountX2 / 2;
  const endCodes = 14;
  const startCodes = endCodes + segCountX2 + 2;
  const deltas = startCodes + segCountX2;
  const rangeOffsets = deltas + segCountX2;
  return (codepoint) => {
    if (codepoint > 0xffff) return 0;
    for (let i = 0; i < segCount; i += 1) {
      const end = u16(cm, endCodes + i * 2);
      if (codepoint > end) continue;
      const start = u16(cm, startCodes + i * 2);
      if (codepoint < start) return 0;
      const delta = u16(cm, deltas + i * 2);
      const rangeOffset = u16(cm, rangeOffsets + i * 2);
      if (rangeOffset === 0) return (codepoint + delta) & 0xffff;
      const glyphOffset = rangeOffsets + i * 2 + rangeOffset + (codepoint - start) * 2;
      if (glyphOffset + 1 >= cm.length) return 0;
      const glyph = u16(cm, glyphOffset);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };
}

function parseFormat12(cm) {
  const groupCount = u32(cm, 12);
  const groups = 16;
  return (codepoint) => {
    for (let i = 0; i < groupCount; i += 1) {
      const offset = groups + i * 12;
      const start = u32(cm, offset);
      const end = u32(cm, offset + 4);
      if (codepoint < start || codepoint > end) continue;
      return u32(cm, offset + 8) + (codepoint - start);
    }
    return 0;
  };
}

export function buildCmapLookup(cmapTable) {
  const numTables = u16(cmapTable, 2);
  const candidates = [];
  for (let i = 0; i < numTables; i += 1) {
    const offset = 4 + i * 8;
    const platform = u16(cmapTable, offset);
    const encoding = u16(cmapTable, offset + 2);
    const subtableOffset = u32(cmapTable, offset + 4);
    if (subtableOffset + 2 > cmapTable.length) continue;
    const format = u16(cmapTable, subtableOffset);
    let rank = -1;
    if (format === 12 && ((platform === 3 && encoding === 10) || platform === 0)) rank = 0;
    else if (format === 4 && ((platform === 3 && encoding === 1) || platform === 0)) rank = 1;
    if (rank >= 0) candidates.push({ rank, format, offset: subtableOffset });
  }
  candidates.sort((a, b) => a.rank - b.rank);
  if (candidates.length === 0) throw new FontError("지원하는 Unicode cmap(4/12)이 없습니다");
  const selected = candidates[0];
  return selected.format === 12 ? parseFormat12(cmapTable.subarray(selected.offset)) : parseFormat4(cmapTable.subarray(selected.offset));
}

export async function fontHasCodepoint(bytes, fileName, codepoint) {
  const tables = await readFontTables(bytes, fileName);
  const lookup = buildCmapLookup(tables.get("cmap"));
  return lookup(codepoint) !== 0;
}

export async function loadFont(workspace, bytes, fileName) {
  const tables = await readFontTables(bytes, fileName);
  const cmap = buildCmapLookup(tables.get("cmap"));
  const family = `declarative-font-shadow-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const face = new FontFace(family, bytes.slice().buffer);
  await face.load();
  document.fonts.add(face);
  return {
    name: fileName,
    family,
    bytes: bytes.slice(),
    hasCodepoint: (codepoint) => cmap(codepoint) !== 0,
    settings: {
      size: 16,
      x: 0,
      y: 0,
      opacity: 0.25,
      visible: true,
    },
    face,
  };
}

export function clampShadowSettings(settings) {
  const size = Number(settings.size);
  const x = Number(settings.x);
  const y = Number(settings.y);
  const opacity = Number(settings.opacity);
  return {
    size: Number.isFinite(size) ? Math.min(1024, Math.max(0.25, size)) : 16,
    x: Number.isFinite(x) ? Math.min(4096, Math.max(-4096, x)) : 0,
    y: Number.isFinite(y) ? Math.min(4096, Math.max(-4096, y)) : 0,
    opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0.25,
    visible: Boolean(settings.visible),
  };
}
