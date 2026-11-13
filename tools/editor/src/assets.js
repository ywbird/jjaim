import { cropBox } from "./declaration.js";
import { decodePng } from "./png.js";
import { normalizeLogicalPath } from "./zip.js";

export const ASSET_LIMITS = {
  assets: 128,
  totalPixels: 33_554_432,
  fileBytes: 80 * 1024 * 1024,
  side: 8192,
  pixels: 16_777_216,
};

export function resolveLogicalPath(path) {
  try {
    return { path: normalizeLogicalPath(path) };
  } catch (error) {
    return { error: error.message };
  }
}

export function sourcePath(declaration, setName, sourceName) {
  const sources = declaration.textureSets.get(setName);
  const raw = sources?.get(sourceName);
  if (raw === undefined) return { error: "선언에 없는 텍스처 소스입니다" };
  return resolveLogicalPath(raw);
}

export function minimumTextureSizes(declaration) {
  const sizes = new Map();
  for (const group of declaration.groups.values()) {
    if (!group.texture) continue;
    const resolved = sourcePath(declaration, group.texture.set, group.texture.source);
    if (resolved.error) continue;
    const first = cropBox(group, 0);
    const last = cropBox(group, group.count - 1);
    const entry = sizes.get(resolved.path) ?? { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    entry.minX = Math.min(entry.minX, first.x, last.x);
    entry.minY = Math.min(entry.minY, first.y, last.y);
    entry.maxX = Math.max(entry.maxX, first.x + first.width, last.x + last.width);
    entry.maxY = Math.max(entry.maxY, first.y + first.height, last.y + last.height);
    sizes.set(resolved.path, entry);
  }
  const result = new Map();
  for (const [path, entry] of sizes) {
    const width = Math.max(0, entry.maxX);
    const height = Math.max(0, entry.maxY);
    let error = null;
    if (entry.minX < 0 || entry.minY < 0) {
      error = "선언의 추출 사각형이 음수 좌표를 사용합니다";
    } else if (width > ASSET_LIMITS.side || height > ASSET_LIMITS.side || width * height > ASSET_LIMITS.pixels) {
      error = `필요 최소 크기 ${width}×${height}가 PNG 자원 한도를 넘습니다`;
    }
    result.set(path, { width, height, minX: entry.minX, minY: entry.minY, error });
  }
  return result;
}

export function sizeError(required, width, height) {
  if (!required) return null;
  if (required.error) return required.error;
  if (width >= required.width && height >= required.height) return null;
  return `이미지 ${width}×${height}, 최소 ${required.width}×${required.height} 필요`;
}

export function sourceRows(declaration, assets, sizes = minimumTextureSizes(declaration)) {
  const rows = [];
  for (const [setName, sources] of declaration.textureSets) {
    for (const [sourceName, rawPath] of sources) {
      const resolved = resolveLogicalPath(rawPath);
      const asset = resolved.path ? assets.get(resolved.path) : null;
      const required = resolved.path ? sizes.get(resolved.path) ?? null : null;
      const declaredProblem = required?.error ?? null;
      const assetProblem = asset ? sizeError(required, asset.width, asset.height) : null;
      const problem = resolved.error ?? declaredProblem ?? assetProblem;
      rows.push({
        set: setName,
        source: sourceName,
        declaredPath: rawPath,
        path: resolved.path ?? null,
        required,
        error: problem,
        asset,
        status: resolved.error ? "지원 범위 밖 경로" : declaredProblem ? "선언 추출 범위 오류" : assetProblem ? "크기 부족" : asset ? "연결됨" : "미연결",
      });
    }
  }
  return rows;
}

export class AssetStore {
  constructor() {
    this.assets = new Map();
  }

  get(path) {
    return this.assets.get(path) ?? null;
  }

  has(path) {
    return this.assets.has(path);
  }

  paths() {
    return [...this.assets.keys()].sort();
  }

  totalPixels() {
    let total = 0;
    for (const asset of this.assets.values()) total += asset.width * asset.height;
    return total;
  }

  bind(path, decoded, { replace = false, minimum = null } = {}) {
    const normalized = resolveLogicalPath(path);
    if (normalized.error) throw new Error(normalized.error);
    const key = normalized.path;
    const problem = sizeError(minimum, decoded.width, decoded.height);
    if (problem) throw new Error(problem);
    const existing = this.assets.get(key);
    if (existing) {
      if (!replace) return { asset: existing, changed: false };
      if (existing.width !== decoded.width || existing.height !== decoded.height) {
        throw new Error("이미지 크기가 달라 현재 자산을 교체할 수 없습니다. 새 작업으로 여세요.");
      }
      existing.current = decoded.data.slice();
      if (decoded.data[3] === 0) {
        // keep straight-alpha copies stable; zero RGB is normalized by the decoder
      }
      existing.version += 1;
      return { asset: existing, changed: true };
    }
    if (this.assets.size >= ASSET_LIMITS.assets) throw new Error("PNG 자산 수가 128개 한도를 넘습니다");
    if (decoded.width > ASSET_LIMITS.side || decoded.height > ASSET_LIMITS.side || decoded.width * decoded.height > ASSET_LIMITS.pixels) {
      throw new Error("PNG 크기가 자원 한도를 넘습니다");
    }
    const nextTotal = this.totalPixels() + decoded.width * decoded.height;
    if (nextTotal > ASSET_LIMITS.totalPixels) throw new Error("연결된 PNG 전체 픽셀 수가 한도를 넘습니다");
    const asset = {
      id: key,
      path: key,
      width: decoded.width,
      height: decoded.height,
      original: decoded.data.slice(),
      current: decoded.data.slice(),
      version: 1,
    };
    this.assets.set(key, asset);
    return { asset, changed: true };
  }

  async bindPng(path, bytes, options) {
    const decoded = await decodePng(bytes, { maxSide: ASSET_LIMITS.side, maxPixels: ASSET_LIMITS.pixels });
    return this.bind(path, decoded, options);
  }

  changedPaths() {
    return this.paths().filter((path) => !samePixels(this.assets.get(path).original, this.assets.get(path).current));
  }

  clone() {
    const copy = new AssetStore();
    for (const [path, asset] of this.assets) {
      copy.assets.set(path, {
        ...asset,
        original: asset.original.slice(),
        current: asset.current.slice(),
      });
    }
    return copy;
  }

  snapshot() {
    const out = new Map();
    for (const [path, asset] of this.assets) out.set(path, asset.current.slice());
    return out;
  }

  restore(snapshot) {
    for (const [path, data] of snapshot) {
      const asset = this.assets.get(path);
      if (!asset) continue;
      if (asset.current.length === data.length) asset.current.set(data);
      asset.version += 1;
    }
  }
}

export function samePixels(a, b) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}
