import { decodePng, isPng } from "./png.js";
import { readZip } from "./zip.js";
import { AssetStore, resolveLogicalPath, sourceRows } from "./assets.js";

export const IMPORT_LIMITS = {
  fileBytes: 80 * 1024 * 1024,
  batchBytes: 256 * 1024 * 1024,
  entries: 512,
};

export class ImportError extends Error {
  constructor(message) {
    super(message);
    this.name = "ImportError";
  }
}

function basename(path) {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function declaredPaths(declaration) {
  const rows = sourceRows(declaration, new AssetStore());
  return rows.map((row) => row.path).filter(Boolean);
}

async function bytesOf(file) {
  if (typeof file.arrayBuffer === "function") return new Uint8Array(await file.arrayBuffer());
  if (file.bytes instanceof Uint8Array) return file.bytes;
  throw new ImportError(`파일을 읽지 못했습니다: ${file.name}`);
}

export async function readImageFiles(files) {
  const list = [...files];
  let total = 0;
  const candidates = [];
  const skipped = [];
  for (const file of list) {
    if (file.size > IMPORT_LIMITS.fileBytes) throw new ImportError(`PNG 파일이 80 MiB 한도를 넘습니다: ${file.name}`);
    total += file.size;
    if (total > IMPORT_LIMITS.batchBytes) throw new ImportError("한 번에 가져오는 파일이 256 MiB 한도를 넘습니다");
    const lower = file.name.toLowerCase();
    const bytes = await bytesOf(file);
    if (lower.endsWith(".zip") || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
      const result = await readZip(bytes, { entries: IMPORT_LIMITS.entries });
      for (const entry of result.entries) candidates.push({ name: entry.name, bytes: entry.data, fromZip: true });
      skipped.push(...result.skipped);
    } else if (lower.endsWith(".png") || isPng(bytes)) {
      if (!isPng(bytes)) throw new ImportError(`PNG 시그니처가 아닙니다: ${file.name}`);
      candidates.push({ name: basename(file.name), bytes, fromZip: false });
    } else {
      skipped.push(file.name);
    }
  }
  return { candidates, skipped };
}

export async function decodeCandidates(candidates) {
  const decoded = [];
  for (const candidate of candidates) {
    try {
      const image = await decodePng(candidate.bytes);
      decoded.push({ ...candidate, image });
    } catch (error) {
      decoded.push({ ...candidate, error: error.message });
    }
  }
  return decoded;
}

export function planLinks(declaration, assets, candidates) {
  const rows = sourceRows(declaration, assets);
  const unlinked = rows.filter((row) => row.path && !row.asset);
  const declared = new Set(unlinked.map((row) => row.path));
  const byExact = new Map();
  const byBase = new Map();
  for (const candidate of candidates) {
    const resolved = resolveLogicalPath(candidate.name);
    if (resolved.error) continue;
    if (declared.has(resolved.path) && !byExact.has(resolved.path)) byExact.set(resolved.path, { ...candidate, path: resolved.path });
    const base = basename(resolved.path);
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push({ ...candidate, path: resolved.path });
  }
  const links = new Map();
  for (const [path, candidate] of byExact) links.set(path, candidate);
  for (const row of unlinked) {
    if (links.has(row.path)) continue;
    const base = basename(row.path);
    const matchingPaths = unlinked.filter((item) => basename(item.path) === base);
    const matchingCandidates = byBase.get(base) ?? [];
    if (matchingPaths.length === 1 && matchingCandidates.length === 1 && !matchingCandidates[0].fromZip) {
      links.set(row.path, matchingCandidates[0]);
    }
  }
  const linkedPaths = new Set([...assets.assets.keys()]);
  for (const path of links.keys()) linkedPaths.add(path);
  const referenced = new Set([...declared, ...linkedPaths]);
  const unreferenced = candidates.filter((candidate) => {
    const resolved = resolveLogicalPath(candidate.name);
    return resolved.path && !referenced.has(resolved.path);
  });
  return { links, unreferenced, unlinked, rows };
}

export async function importImages(declaration, assets, files) {
  if (!declaration) throw new ImportError("먼저 선언을 여세요. PNG/ZIP만으로 그룹을 만들 수 없습니다.");
  const { candidates, skipped } = await readImageFiles(files);
  const decoded = await decodeCandidates(candidates);
  const plan = planLinks(declaration, assets, decoded);
  const linked = [];
  const errors = [];
  for (const [path, candidate] of plan.links) {
    if (candidate.error) {
      errors.push(`${path}: ${candidate.error}`);
      continue;
    }
    if (path === candidate.path) {
      try {
        const result = assets.bind(path, candidate.image);
        if (result.changed) linked.push(path);
      } catch (error) {
        errors.push(`${path}: ${error.message}`);
      }
    } else errors.push(`${path}: 연결 대상을 찾지 못했습니다`);
  }
  return {
    linked,
    errors,
    skipped,
    unreferenced: plan.unreferenced.map((candidate) => candidate.name),
    rows: sourceRows(declaration, assets),
    decoded,
    plan,
  };
}

export async function replaceAssets(declaration, assets, pairs) {
  const prepared = [];
  for (const { path, bytes } of pairs) {
    const image = await decodePng(bytes);
    const asset = assets.get(path);
    if (!asset) throw new ImportError(`연결된 자산이 아닙니다: ${path}`);
    if (asset.width !== image.width || asset.height !== image.height) throw new ImportError(`이미지 크기가 다릅니다: ${path}`);
    prepared.push({ path, image });
  }
  for (const { path, image } of prepared) assets.bind(path, image, { replace: true });
  return prepared.map((item) => item.path);
}

export async function manualLink(declaration, assets, path, bytes) {
  const image = await decodePng(bytes);
  const asset = assets.get(path);
  if (asset) {
    if (asset.width !== image.width || asset.height !== image.height) throw new ImportError("이미지 크기가 달라 교체할 수 없습니다");
    assets.bind(path, image, { replace: true });
  } else assets.bind(path, image);
  return sourceRows(declaration, assets);
}
