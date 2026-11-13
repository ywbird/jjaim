const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

let crcTable = null;
function crcTableBuild() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

export function crc32(bytes) {
  const table = crcTableBuild();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const be32 = (view, offset) => ((view[offset] << 24) | (view[offset + 1] << 16) | (view[offset + 2] << 8) | view[offset + 3]) >>> 0;
const be16 = (view, offset) => (view[offset] << 8) | view[offset + 1];

export class PngError extends Error {
  constructor(message) {
    super(message);
    this.name = "PngError";
  }
}

function u32(value) {
  return new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
}

function u16(value) {
  return new Uint8Array([(value >>> 8) & 255, value & 255]);
}

function chunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.length);
  out.set(u32(data.length), 0);
  out.set(typeBytes, 4);
  out.set(data, 8);
  out.set(u32(crc32(out.subarray(4, 8 + data.length))), 8 + data.length);
  return out;
}

export function isPng(bytes) {
  if (bytes.length < 8) return false;
  return SIGNATURE.every((value, index) => bytes[index] === value);
}

export async function inflate(bytes, format = "deflate") {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function deflate(bytes, format = "deflate") {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(raw, offset, rowBytes, height, bpp) {
  const out = new Uint8Array(rowBytes * height);
  let pos = offset;
  for (let y = 0; y < height; y += 1) {
    if (pos >= raw.length) throw new PngError("PNG 이미지 데이터가 부족합니다");
    const filter = raw[pos++];
    const rowStart = y * rowBytes;
    const prevStart = (y - 1) * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const value = raw[pos++];
      if (value === undefined) throw new PngError("PNG 이미지 데이터가 부족합니다");
      const left = x >= bpp ? out[rowStart + x - bpp] : 0;
      const up = y > 0 ? out[prevStart + x] : 0;
      const upLeft = y > 0 && x >= bpp ? out[prevStart + x - bpp] : 0;
      let restored;
      if (filter === 0) restored = value;
      else if (filter === 1) restored = value + left;
      else if (filter === 2) restored = value + up;
      else if (filter === 3) restored = value + ((left + up) >> 1);
      else if (filter === 4) restored = value + paeth(left, up, upLeft);
      else throw new PngError(`지원하지 않는 PNG 필터입니다: ${filter}`);
      out[rowStart + x] = restored & 255;
    }
  }
  return { data: out, next: pos };
}

const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];

function decodePass(raw, offset, width, height, colorType, bitDepth) {
  const bitsPerPixel = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType] * bitDepth;
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8));
  return unfilter(raw, offset, rowBytes, height, bpp);
}

function samplesPerPixel(colorType) {
  return { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
}

function readSample(row, index, bitDepth) {
  if (bitDepth === 8) return row[index];
  if (bitDepth === 16) return (row[index * 2] << 8) | row[index * 2 + 1];
  const bit = index * bitDepth;
  const byte = row[bit >> 3];
  const shift = 8 - bitDepth - (bit & 7);
  return (byte >> shift) & ((1 << bitDepth) - 1);
}

function normalizeColor(value, bitDepth) {
  if (bitDepth === 16) return value >>> 8;
  if (bitDepth === 8) return value;
  return Math.round((value * 255) / ((1 << bitDepth) - 1));
}

function convertPixel(row, sampleIndex, colorType, bitDepth, palette, transparency) {
  if (colorType === 0) {
    const gray = readSample(row, sampleIndex, bitDepth);
    const alpha = transparency != null && gray === transparency ? 0 : 255;
    const value = normalizeColor(gray, bitDepth);
    return [value, value, value, alpha];
  }
  if (colorType === 2) {
    const r = readSample(row, sampleIndex, bitDepth);
    const g = readSample(row, sampleIndex + 1, bitDepth);
    const b = readSample(row, sampleIndex + 2, bitDepth);
    const alpha = transparency && transparency[0] === r && transparency[1] === g && transparency[2] === b ? 0 : 255;
    return [normalizeColor(r, bitDepth), normalizeColor(g, bitDepth), normalizeColor(b, bitDepth), alpha];
  }
  if (colorType === 3) {
    const index = readSample(row, sampleIndex, bitDepth);
    if (index * 3 + 2 >= palette.length) throw new PngError("PNG 팔레트 인덱스가 범위를 벗어났습니다");
    return [palette[index * 3], palette[index * 3 + 1], palette[index * 3 + 2], transparency?.[index] ?? 255];
  }
  if (colorType === 4) {
    const gray = readSample(row, sampleIndex, bitDepth);
    const alpha = readSample(row, sampleIndex + 1, bitDepth);
    const value = normalizeColor(gray, bitDepth);
    return [value, value, value, normalizeColor(alpha, bitDepth)];
  }
  const r = readSample(row, sampleIndex, bitDepth);
  const g = readSample(row, sampleIndex + 1, bitDepth);
  const b = readSample(row, sampleIndex + 2, bitDepth);
  const a = readSample(row, sampleIndex + 3, bitDepth);
  return [normalizeColor(r, bitDepth), normalizeColor(g, bitDepth), normalizeColor(b, bitDepth), normalizeColor(a, bitDepth)];
}

export async function decodePng(bytes, { maxSide = 8192, maxPixels = 16_777_216 } = {}) {
  if (!isPng(bytes)) throw new PngError("PNG 시그니처가 아닙니다");
  const view = bytes;
  let offset = 8;
  let ihdr = null;
  let palette = null;
  let transparency = null;
  const idat = [];
  let sawEnd = false;
  let animated = false;
  while (offset + 8 <= view.length) {
    const length = be32(view, offset);
    if (length > view.length - offset - 12) throw new PngError("PNG 청크가 잘렸습니다");
    const typeBytes = view.subarray(offset + 4, offset + 8);
    const type = String.fromCharCode(...typeBytes);
    const data = view.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = be32(view, offset + 8 + length);
    if (crc32(view.subarray(offset + 4, offset + 8 + length)) !== expectedCrc) throw new PngError(`PNG ${type} 청크 CRC가 맞지 않습니다`);
    offset += 12 + length;
    if (type === "IHDR") {
      if (ihdr) throw new PngError("PNG IHDR이 중복되었습니다");
      if (length !== 13) throw new PngError("PNG IHDR 길이가 잘못되었습니다");
      ihdr = {
        width: be32(data, 0),
        height: be32(data, 4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === "PLTE") {
      if (length % 3 !== 0 || length === 0 || length > 768) throw new PngError("PNG 팔레트가 잘못되었습니다");
      palette = data;
    } else if (type === "tRNS") {
      if (!ihdr) throw new PngError("PNG tRNS가 IHDR보다 먼저 나왔습니다");
      if (ihdr.colorType === 3) transparency = data;
      else if (ihdr.colorType === 0 && length === 2) transparency = be16(data, 0);
      else if (ihdr.colorType === 2 && length === 6) transparency = [be16(data, 0), be16(data, 2), be16(data, 4)];
      else throw new PngError("PNG tRNS 형식이 잘못되었습니다");
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      sawEnd = true;
      break;
    } else if (type === "acTL") {
      animated = true;
    } else if (typeBytes[0] >= 65 && typeBytes[0] <= 90) {
      throw new PngError(`지원하지 않는 PNG 핵심 청크입니다: ${type}`);
    }
  }
  if (!ihdr) throw new PngError("PNG IHDR이 없습니다");
  if (!sawEnd) throw new PngError("PNG IEND가 없습니다");
  if (animated) throw new PngError("애니메이션 PNG는 지원하지 않습니다");
  if (idat.length === 0) throw new PngError("PNG 이미지 데이터가 없습니다");
  const { width, height, bitDepth, colorType, interlace } = ihdr;
  if (![0, 2, 3, 4, 6].includes(colorType)) throw new PngError(`지원하지 않는 PNG 색 형식입니다: ${colorType}`);
  if (![1, 2, 4, 8, 16].includes(bitDepth)) throw new PngError(`지원하지 않는 PNG 비트 깊이입니다: ${bitDepth}`);
  if (colorType === 3 && bitDepth === 16) throw new PngError("팔레트 PNG는 16비트일 수 없습니다");
  if ((colorType === 2 || colorType === 4 || colorType === 6) && bitDepth < 8) throw new PngError("지원하지 않는 PNG 비트 깊이입니다");
  if (ihdr.compression !== 0 || ihdr.filter !== 0 || ![0, 1].includes(interlace)) throw new PngError("지원하지 않는 PNG 압축/필터/인터레이스 방식입니다");
  if (width <= 0 || height <= 0) throw new PngError("PNG 크기가 0입니다");
  if (width > maxSide || height > maxSide || width * height > maxPixels) throw new PngError("PNG 크기가 자원 한도를 넘습니다");
  if (colorType === 3 && !palette) throw new PngError("팔레트 PNG에 PLTE가 없습니다");
  const combinedLength = idat.reduce((sum, item) => sum + item.length, 0);
  const compressed = new Uint8Array(combinedLength);
  let cursor = 0;
  for (const item of idat) {
    compressed.set(item, cursor);
    cursor += item.length;
  }
  const raw = await inflate(compressed, "deflate");
  const data = new Uint8Array(width * height * 4);
  const channels = samplesPerPixel(colorType);
  const writePixel = (x, y, row, pixelIndex) => {
    const p = convertPixel(row, pixelIndex, colorType, bitDepth, palette, transparency);
    const target = (y * width + x) * 4;
    if (p[3] === 0) {
      data[target] = 0;
      data[target + 1] = 0;
      data[target + 2] = 0;
    } else {
      data[target] = p[0];
      data[target + 1] = p[1];
      data[target + 2] = p[2];
    }
    data[target + 3] = p[3];
  };
  if (interlace === 0) {
    const { data: rowData, next } = decodePass(raw, 0, width, height, colorType, bitDepth);
    if (next > raw.length) throw new PngError("PNG 이미지 데이터가 부족합니다");
    const rowBytes = Math.ceil((width * channels * bitDepth) / 8);
    for (let y = 0; y < height; y += 1) {
      const row = rowData.subarray(y * rowBytes, (y + 1) * rowBytes);
      for (let x = 0; x < width; x += 1) writePixel(x, y, row, x * channels);
    }
  } else {
    let passOffset = 0;
    for (const [x0, y0, dx, dy] of ADAM7) {
      const passWidth = Math.ceil((width - x0) / dx);
      const passHeight = Math.ceil((height - y0) / dy);
      if (passWidth <= 0 || passHeight <= 0) continue;
      const { data: rowData, next } = decodePass(raw, passOffset, passWidth, passHeight, colorType, bitDepth);
      passOffset = next;
      const rowBytes = Math.ceil((passWidth * channels * bitDepth) / 8);
      for (let py = 0; py < passHeight; py += 1) {
        const row = rowData.subarray(py * rowBytes, (py + 1) * rowBytes);
        for (let px = 0; px < passWidth; px += 1) writePixel(x0 + px * dx, y0 + py * dy, row, px * channels);
      }
    }
  }
  return { width, height, data };
}

export async function encodePng({ width, height, data }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new PngError("PNG 크기가 잘못되었습니다");
  if (data.length !== width * height * 4) throw new PngError("PNG RGBA 데이터 길이가 맞지 않습니다");
  const rowBytes = width * 4;
  const raw = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (rowBytes + 1)] = 0;
    raw.set(data.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);
  }
  const compressed = await deflate(raw, "deflate");
  const ihdr = new Uint8Array(13);
  ihdr.set(u32(width), 0);
  ihdr.set(u32(height), 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parts = [SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", compressed), chunk("IEND", new Uint8Array())];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function pixelAt(image, x, y) {
  const offset = (y * image.width + x) * 4;
  return [image.data[offset], image.data[offset + 1], image.data[offset + 2], image.data[offset + 3]];
}

export function setPixel(image, x, y, rgba) {
  const offset = (y * image.width + x) * 4;
  image.data[offset] = rgba[3] === 0 ? 0 : rgba[0];
  image.data[offset + 1] = rgba[3] === 0 ? 0 : rgba[1];
  image.data[offset + 2] = rgba[3] === 0 ? 0 : rgba[2];
  image.data[offset + 3] = rgba[3];
}
