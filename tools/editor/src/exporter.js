import { encodePng } from "./png.js";
import { makeZip } from "./zip.js";

export function safeZipName(name) {
  const cleaned = String(name || "glyphs")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .trim()
    .slice(0, 100);
  return `${cleaned || "glyphs"}-textures.zip`;
}

export async function exportSingle(assets, path) {
  const asset = assets.get(path);
  if (!asset) throw new Error(`자산을 찾지 못했습니다: ${path}`);
  const bytes = await encodePng({ width: asset.width, height: asset.height, data: asset.current });
  return { name: path.slice(path.lastIndexOf("/") + 1), bytes };
}

export async function exportZip(assets, paths, workspaceName) {
  const entries = [];
  const seen = new Set();
  for (const path of [...paths].sort()) {
    if (seen.has(path)) continue;
    seen.add(path);
    const asset = assets.get(path);
    if (!asset) throw new Error(`자산을 찾지 못했습니다: ${path}`);
    entries.push({ name: path, data: await encodePng({ width: asset.width, height: asset.height, data: asset.current }) });
  }
  if (entries.length === 0) throw new Error("내보낼 PNG가 없습니다");
  const bytes = await makeZip(entries);
  return { name: safeZipName(workspaceName), bytes, entries: entries.map((entry) => entry.name) };
}

export async function exportChanged(assets, workspaceName) {
  return exportZip(assets, assets.changedPaths(), workspaceName);
}

export async function exportAll(assets, workspaceName) {
  return exportZip(assets, assets.paths(), workspaceName);
}
