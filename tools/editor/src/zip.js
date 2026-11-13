import { crc32, deflate, inflate } from "./png.js";

const LIMITS = {
  zipBytes: 256 * 1024 * 1024,
  entries: 512,
  uncompressedBytes: 256 * 1024 * 1024,
  fileBytes: 256 * 1024 * 1024,
};

export class ZipError extends Error {
  constructor(message) {
    super(message);
    this.name = "ZipError";
  }
}

const u16 = (view, offset) => view[offset] | (view[offset + 1] << 8);
const u32 = (view, offset) => (view[offset] | (view[offset + 1] << 8) | (view[offset + 2] << 16) | (view[offset + 3] << 24)) >>> 0;
const u64 = (view, offset) => u32(view, offset) + u32(view, offset + 4) * 0x1_0000_0000;

function put16(out, offset, value) {
  out[offset] = value & 255;
  out[offset + 1] = (value >>> 8) & 255;
}

function put32(out, offset, value) {
  out[offset] = value & 255;
  out[offset + 1] = (value >>> 8) & 255;
  out[offset + 2] = (value >>> 16) & 255;
  out[offset + 3] = (value >>> 24) & 255;
}

export function normalizeLogicalPath(path) {
  if (typeof path !== "string" || path.length === 0) throw new ZipError("경로가 비어 있습니다");
  if (/^[a-zA-Z]:/.test(path) || path.startsWith("/") || path.startsWith("\\")) throw new ZipError(`절대 경로는 지원하지 않습니다: ${path}`);
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) throw new ZipError(`URL 경로는 지원하지 않습니다: ${path}`);
  const parts = path.replaceAll("\\", "/").split("/");
  const out = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) throw new ZipError(`상위 경로로 나가는 경로입니다: ${path}`);
      out.pop();
    } else out.push(part);
  }
  if (out.length === 0) throw new ZipError(`유효하지 않은 경로입니다: ${path}`);
  return out.join("/");
}

function findEocd(view) {
  const min = Math.max(0, view.length - 65557);
  for (let offset = view.length - 22; offset >= min; offset -= 1) {
    if (u32(view, offset) === 0x06054b50) return offset;
  }
  return -1;
}

export async function readZip(bytes, options = {}) {
  const limits = { ...LIMITS, ...options };
  if (bytes.length > limits.zipBytes) throw new ZipError("ZIP 파일이 256 MiB 한도를 넘습니다");
  if (bytes.length < 22) throw new ZipError("ZIP 파일이 아닙니다");
  const eocd = findEocd(bytes);
  if (eocd < 0) throw new ZipError("ZIP 끝 레코드를 찾지 못했습니다");
  const disk = u16(bytes, eocd + 4);
  const cdDisk = u16(bytes, eocd + 6);
  const diskEntries = u16(bytes, eocd + 8);
  const totalEntries = u16(bytes, eocd + 10);
  const cdSize = u32(bytes, eocd + 12);
  const cdOffset = u32(bytes, eocd + 16);
  if (disk !== 0 || cdDisk !== 0 || diskEntries !== totalEntries) throw new ZipError("분할 ZIP은 지원하지 않습니다");
  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ZipError("ZIP64는 지원하지 않습니다");
  if (totalEntries > limits.entries) throw new ZipError("ZIP 항목 수가 512개 한도를 넘습니다");
  if (cdOffset + cdSize > bytes.length || cdOffset < 0) throw new ZipError("ZIP 중앙 디렉터리가 잘렸습니다");
  let offset = cdOffset;
  let totalBytes = 0;
  const entries = [];
  const skipped = [];
  const seen = new Set();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > bytes.length || u32(bytes, offset) !== 0x02014b50) throw new ZipError("ZIP 중앙 디렉터리 항목이 잘못되었습니다");
    const versionMade = u16(bytes, offset + 4);
    const flags = u16(bytes, offset + 8);
    const method = u16(bytes, offset + 10);
    const expectedCrc = u32(bytes, offset + 16);
    const compressedSize = u32(bytes, offset + 20);
    const uncompressedSize = u32(bytes, offset + 24);
    const nameLength = u16(bytes, offset + 28);
    const extraLength = u16(bytes, offset + 30);
    const commentLength = u16(bytes, offset + 32);
    const external = u32(bytes, offset + 38);
    const localOffset = u32(bytes, offset + 42);
    if (flags & 1) throw new ZipError("암호화된 ZIP 항목은 지원하지 않습니다");
    if (method !== 0 && method !== 8) throw new ZipError(`지원하지 않는 ZIP 압축 방식입니다: ${method}`);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) throw new ZipError("ZIP64 항목은 지원하지 않습니다");
    if (uncompressedSize > limits.fileBytes) throw new ZipError("ZIP 항목이 파일 크기 한도를 넘습니다");
    totalBytes += uncompressedSize;
    if (totalBytes > limits.uncompressedBytes) throw new ZipError("ZIP 전체 압축 해제 크기가 256 MiB 한도를 넘습니다");
    let nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    let name;
    try {
      name = decoder.decode(nameBytes);
    } catch {
      throw new ZipError("ZIP 항목 이름이 UTF-8이 아닙니다");
    }
    const unixMode = (external >>> 16) & 0xffff;
    if ((versionMade >>> 8) === 3 && (unixMode & 0xf000) === 0xa000) throw new ZipError(`ZIP 심볼릭 링크는 지원하지 않습니다: ${name}`);
    if (name.endsWith("/")) {
      skipped.push(name);
      offset += 46 + nameLength + extraLength + commentLength;
      continue;
    }
    const normalized = normalizeLogicalPath(name);
    if (seen.has(normalized)) throw new ZipError(`ZIP 안에 정규화 후 중복된 경로가 있습니다: ${normalized}`);
    seen.add(normalized);
    if (!/\.png$/i.test(normalized)) {
      skipped.push(normalized);
      offset += 46 + nameLength + extraLength + commentLength;
      continue;
    }
    if (localOffset + 30 > bytes.length || u32(bytes, localOffset) !== 0x04034b50) throw new ZipError(`ZIP 로컬 헤더가 잘못되었습니다: ${normalized}`);
    const localNameLength = u16(bytes, localOffset + 26);
    const localExtraLength = u16(bytes, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressedSize > bytes.length) throw new ZipError(`ZIP 항목이 잘렸습니다: ${normalized}`);
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = compressed.slice();
    else data = await inflate(compressed, "deflate-raw");
    if (data.length !== uncompressedSize) throw new ZipError(`ZIP 항목 크기가 맞지 않습니다: ${normalized}`);
    if (crc32(data) !== expectedCrc) throw new ZipError(`ZIP 항목 CRC가 맞지 않습니다: ${normalized}`);
    entries.push({ name: normalized, data });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { entries, skipped };
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | (Math.floor(date.getSeconds() / 2) & 31),
    date: (((year - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31),
  };
}

export async function makeZip(entries, { now = new Date() } = {}) {
  if (entries.length > LIMITS.entries) throw new ZipError("ZIP 항목 수가 512개 한도를 넘습니다");
  const encoder = new TextEncoder();
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const seen = new Set();
  const prepared = [];
  let total = 0;
  for (const entry of sorted) {
    const name = normalizeLogicalPath(entry.name);
    if (seen.has(name)) throw new ZipError(`ZIP 안에 중복된 경로가 있습니다: ${name}`);
    seen.add(name);
    const crc = crc32(entry.data);
    const compressed = await deflate(entry.data, "deflate-raw");
    const useDeflate = compressed.length < entry.data.length;
    const body = useDeflate ? compressed : entry.data;
    total += entry.data.length;
    if (total > LIMITS.uncompressedBytes) throw new ZipError("ZIP 전체 크기가 256 MiB 한도를 넘습니다");
    prepared.push({ name: encoder.encode(name), data: entry.data, body, crc, method: useDeflate ? 8 : 0 });
  }
  const { time, date } = dosDateTime(now);
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const entry of prepared) {
    const local = new Uint8Array(30 + entry.name.length);
    put32(local, 0, 0x04034b50);
    put16(local, 4, 20);
    put16(local, 6, 0x0800);
    put16(local, 8, entry.method);
    put16(local, 10, time);
    put16(local, 12, date);
    put32(local, 14, entry.crc);
    put32(local, 18, entry.body.length);
    put32(local, 22, entry.data.length);
    put16(local, 26, entry.name.length);
    local.set(entry.name, 30);
    localParts.push(local, entry.body);
    const central = new Uint8Array(46 + entry.name.length);
    put32(central, 0, 0x02014b50);
    put16(central, 4, 20);
    put16(central, 6, 20);
    put16(central, 8, 0x0800);
    put16(central, 10, entry.method);
    put16(central, 12, time);
    put16(central, 14, date);
    put32(central, 16, entry.crc);
    put32(central, 20, entry.body.length);
    put32(central, 24, entry.data.length);
    put16(central, 28, entry.name.length);
    put32(central, 42, localOffset);
    central.set(entry.name, 46);
    centralParts.push(central);
    localOffset += local.length + entry.body.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  put32(eocd, 0, 0x06054b50);
  put16(eocd, 8, prepared.length);
  put16(eocd, 10, prepared.length);
  put32(eocd, 12, centralSize);
  put32(eocd, 16, localOffset);
  const totalLength = localOffset + centralSize + eocd.length;
  const out = new Uint8Array(totalLength);
  let cursor = 0;
  for (const part of [...localParts, ...centralParts, eocd]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

export { LIMITS as ZIP_LIMITS };
