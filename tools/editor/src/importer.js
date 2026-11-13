import { decodePng, isPng } from "./png.js";
import { readZip } from "./zip.js";
import { AssetStore, minimumTextureSizes, resolveLogicalPath, sizeError, sourceRows } from "./assets.js";

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
      const result = await readZip(bytes, { entries: IMPORT_LIMITS.entries, fileBytes: IMPORT_LIMITS.fileBytes });
      for (const entry of result.entries) candidates.push({ name: entry.name, bytes: entry.data, fromZip: true });
      skipped.push(...result.skipped);
    } else if (lower.endsWith(".png") || isPng(bytes)) {
      if (!isPng(bytes)) throw new ImportError(`PNG 시그니처가 아닙니다: ${file.name}`);
      candidates.push({ name: basename(file.name), bytes, fromZip: false });
    } else {
      skipped.push(file.name);
    }
  }
  if (candidates.length === 0) throw new ImportError("가져올 PNG가 없습니다");
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
  const connected = new Set(assets.paths());
  const declared = new Set(rows.map((row) => row.path).filter(Boolean));
  const byExact = new Map();
  const byBase = new Map();
  const byConnectedBase = new Map();
  for (const candidate of candidates) {
    const resolved = resolveLogicalPath(candidate.name);
    if (resolved.error) continue;
    const item = { ...candidate, path: resolved.path };
    if ((connected.has(resolved.path) || declared.has(resolved.path)) && !byExact.has(resolved.path)) {
      byExact.set(resolved.path, item);
    }
    const base = basename(resolved.path);
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(item);
    if (connected.has(resolved.path)) {
      if (!byConnectedBase.has(base)) byConnectedBase.set(base, []);
      byConnectedBase.get(base).push(item);
    }
  }
  const links = new Map();
  const replacements = new Map();
  for (const [path, candidate] of byExact) {
    if (connected.has(path)) replacements.set(path, candidate);
    else links.set(path, candidate);
  }
  for (const row of unlinked) {
    if (links.has(row.path)) continue;
    const base = basename(row.path);
    const matchingPaths = unlinked.filter((item) => basename(item.path) === base);
    const matchingCandidates = byBase.get(base) ?? [];
    if (matchingPaths.length === 1 && matchingCandidates.length === 1 && !matchingCandidates[0].fromZip) {
      links.set(row.path, matchingCandidates[0]);
    }
  }
  for (const [base, items] of byConnectedBase) {
    const matchingPaths = [...connected].filter((path) => basename(path) === base);
    if (matchingPaths.length === 1 && items.length === 1 && !items[0].fromZip && !replacements.has(matchingPaths[0])) {
      replacements.set(matchingPaths[0], items[0]);
    }
  }
  const referenced = new Set([...declared, ...connected, ...links.keys()]);
  const unreferenced = candidates.filter((candidate) => {
    const resolved = resolveLogicalPath(candidate.name);
    return resolved.path && !referenced.has(resolved.path);
  });
  return { links, replacements, unreferenced, unlinked, rows };
}

export async function importImages(declaration, assets, files) {
  if (!declaration) throw new ImportError("먼저 선언을 여세요. PNG/ZIP만으로 그룹을 만들 수 없습니다.");
  const { candidates, skipped } = await readImageFiles(files);
  const decoded = await decodeCandidates(candidates);
  const sizes = minimumTextureSizes(declaration);
  const plan = planLinks(declaration, assets, decoded);
  for (const [path, candidate] of plan.replacements) {
    const problem = candidate.error ?? sizeError(sizes.get(path), candidate.image.width, candidate.image.height);
    if (problem) candidate.error = problem;
  }
  const linked = [];
  const errors = [];
  for (const [path, candidate] of plan.links) {
    if (candidate.error) {
      errors.push(`${path}: ${candidate.error}`);
      continue;
    }
    if (path === candidate.path) {
      try {
        const result = assets.bind(path, candidate.image, { minimum: sizes.get(path) });
        if (result.changed) linked.push(path);
      } catch (error) {
        errors.push(`${path}: ${error.message}`);
      }
    } else errors.push(`${path}: 연결 대상을 찾지 못했습니다`);
  }
  return {
    linked,
    replacements: plan.replacements,
    errors,
    skipped,
    unreferenced: plan.unreferenced.map((candidate) => candidate.name),
    rows: sourceRows(declaration, assets, sizes),
    decoded,
    plan,
  };
}

export async function replaceAssets(declaration, assets, pairs) {
  const sizes = minimumTextureSizes(declaration);
  const prepared = [];
  for (const { path, bytes } of pairs) {
    const image = await decodePng(bytes);
    const asset = assets.get(path);
    if (!asset) throw new ImportError(`연결된 자산이 아닙니다: ${path}`);
    const problem = sizeError(sizes.get(path), image.width, image.height);
    if (problem) throw new ImportError(`${path}: ${problem}`);
    if (asset.width !== image.width || asset.height !== image.height) throw new ImportError(`이미지 크기가 다릅니다: ${path}`);
    prepared.push({ path, image, minimum: sizes.get(path) });
  }
  for (const { path, image, minimum } of prepared) assets.bind(path, image, { replace: true, minimum });
  return prepared.map((item) => item.path);
}

export async function manualLink(declaration, assets, path, bytes) {
  const image = await decodePng(bytes);
  const asset = assets.get(path);
  const minimum = minimumTextureSizes(declaration).get(path);
  if (asset) {
    const problem = sizeError(minimum, image.width, image.height);
    if (problem) throw new ImportError(`${path}: ${problem}`);
    if (asset.width !== image.width || asset.height !== image.height) throw new ImportError("이미지 크기가 달라 교체할 수 없습니다");
    assets.bind(path, image, { replace: true, minimum });
  } else assets.bind(path, image, { minimum });
  return sourceRows(declaration, assets);
}
