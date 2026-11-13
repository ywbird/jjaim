import { AssetStore, minimumTextureSizes, sizeError } from "./assets.js";
import { parseDeclaration } from "./declaration.js";
import { History } from "./history.js";
import { decodePng, encodePng } from "./png.js";
import { makeZip, normalizeLogicalPath, readZip } from "./zip.js";

export const PROJECT_FORMAT = "dgc-texture-project";
export const PROJECT_VERSION = 1;
const PROJECT_ENTRY = "project.json";
const TEXTURE_DIR = "textures/";

export function safeProjectName(name) {
  const cleaned = String(name || "project")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .trim()
    .slice(0, 100);
  return `${cleaned || "project"}.jjaim`;
}

export async function exportProject(workspace) {
  const entries = [];
  const assets = [];
  for (const asset of workspace.assets.assets.values()) {
    const file = `${TEXTURE_DIR}${normalizeLogicalPath(asset.path)}`;
    entries.push({ name: file, data: await encodePng({ width: asset.width, height: asset.height, data: asset.current }) });
    assets.push({ path: asset.path, width: asset.width, height: asset.height, file });
  }
  const project = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: workspace.name,
    fileName: workspace.fileName,
    exportedAt: Date.now(),
    declaration: workspace.declaration.text,
    assets,
    history: workspace.history.toJSON(),
    view: workspace.view ?? {},
  };
  entries.push({ name: PROJECT_ENTRY, data: new TextEncoder().encode(JSON.stringify(project)) });
  return { name: safeProjectName(workspace.name), bytes: await makeZip(entries), project };
}

function pixelOffset(asset, change, file) {
  if (!Number.isInteger(change.x) || !Number.isInteger(change.y) || change.x < 0 || change.y < 0 || change.x >= asset.width || change.y >= asset.height) {
    throw new Error(`프로젝트 이력의 픽셀 좌표가 잘못되었습니다: ${file}`);
  }
  if (!Array.isArray(change.before) || change.before.length !== 4) {
    throw new Error(`프로젝트 이력의 이전 픽셀이 잘못되었습니다: ${file}`);
  }
  return (change.y * asset.width + change.x) * 4;
}

// The project stores current PNGs plus history deltas. Walk the current head
// backwards to recover the immutable originals required by History.
function restoreOriginals(assets, historyData) {
  const revisions = new Map();
  for (const revision of historyData.revisions) {
    if (!revision || typeof revision.id !== "string" || !Array.isArray(revision.changes)) {
      throw new Error("프로젝트 이력 형식이 잘못되었습니다");
    }
    revisions.set(revision.id, revision);
  }
  for (const asset of assets.assets.values()) asset.original.set(asset.current);
  let revision = revisions.get(historyData.headId);
  if (!revision) throw new Error("프로젝트의 현재 revision을 찾지 못했습니다");
  const seen = new Set();
  while (revision) {
    if (seen.has(revision.id)) throw new Error("프로젝트 이력에 순환이 있습니다");
    seen.add(revision.id);
    for (const entry of revision.changes) {
      if (!Array.isArray(entry) || entry.length !== 2 || !Array.isArray(entry[1])) {
        throw new Error("프로젝트 이력의 변경 목록이 잘못되었습니다");
      }
      const [path, changes] = entry;
      const asset = assets.get(path);
      if (!asset) throw new Error(`프로젝트 이력에만 있는 자산입니다: ${path}`);
      for (let index = changes.length - 1; index >= 0; index -= 1) {
        const change = changes[index];
        asset.original.set(change.before, pixelOffset(asset, change, path));
      }
    }
    if (revision.parent == null) break;
    const parent = revisions.get(revision.parent);
    if (!parent) throw new Error(`프로젝트 이력의 부모 revision이 없습니다: ${revision.parent}`);
    revision = parent;
  }
}

function samePixels(a, b) {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

function verifyHead(assets, history, headId) {
  const state = history.stateAt(headId);
  for (const [path, asset] of assets.assets) {
    const current = state.get(path);
    if (!current || !samePixels(current, asset.current)) {
      throw new Error(`프로젝트 이력과 현재 텍스처가 일치하지 않습니다: ${path}`);
    }
  }
}

export async function importProject(bytes) {
  const { entries } = await readZip(bytes, { keepNonPng: true });
  const projectEntry = entries.find((entry) => entry.name === PROJECT_ENTRY);
  if (!projectEntry) throw new Error("프로젝트 파일에 project.json이 없습니다");
  let raw;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(projectEntry.data));
  } catch {
    throw new Error("project.json을 읽지 못했습니다");
  }
  if (raw?.format !== PROJECT_FORMAT) throw new Error("지원하지 않는 프로젝트 형식입니다");
  if (raw.version !== PROJECT_VERSION) throw new Error(`지원하지 않는 프로젝트 버전입니다: ${raw.version ?? "없음"}`);
  if (typeof raw.declaration !== "string") throw new Error("프로젝트에 선언 원문이 없습니다");
  if (!Array.isArray(raw.assets)) throw new Error("프로젝트에 자산 목록이 없습니다");
  if (!raw.history || !Array.isArray(raw.history.revisions) || typeof raw.history.headId !== "string") {
    throw new Error("프로젝트에 편집 이력이 없습니다");
  }
  const fileName = typeof raw.fileName === "string" && raw.fileName ? raw.fileName : "project.json";
  const declaration = parseDeclaration(raw.declaration, { fileName });
  const sizes = minimumTextureSizes(declaration);
  const files = new Map(entries.filter((entry) => /\.png$/i.test(entry.name)).map((entry) => [entry.name, entry]));
  const assets = new AssetStore();
  for (const item of raw.assets) {
    if (!item || typeof item.path !== "string" || typeof item.file !== "string") {
      throw new Error("프로젝트 자산 항목이 잘못되었습니다");
    }
    const path = normalizeLogicalPath(item.path);
    const file = normalizeLogicalPath(item.file);
    if (!file.startsWith(TEXTURE_DIR)) throw new Error(`프로젝트 텍스처 경로가 ${TEXTURE_DIR} 밖입니다: ${file}`);
    if (assets.has(path)) throw new Error(`프로젝트에 중복 자산 경로가 있습니다: ${path}`);
    const entry = files.get(file);
    if (!entry) throw new Error(`프로젝트에 텍스처가 없습니다: ${file}`);
    const image = await decodePng(entry.data);
    if (image.width !== item.width || image.height !== item.height) {
      throw new Error(`프로젝트 텍스처 크기가 metadata와 다릅니다: ${file}`);
    }
    const required = sizes.get(path) ?? null;
    const problem = sizeError(required, image.width, image.height);
    if (problem) throw new Error(`${path}: ${problem}`);
    assets.bind(path, image, { minimum: required });
  }
  restoreOriginals(assets, raw.history);
  const history = History.fromJSON(assets, raw.history);
  verifyHead(assets, history, raw.history.headId);
  const name = typeof raw.name === "string" && raw.name ? raw.name : declaration.metadata.get("name") ?? "프로젝트";
  return {
    name,
    fileName,
    declarationText: raw.declaration,
    declaration,
    assets,
    history,
    view: raw.view && typeof raw.view === "object" ? raw.view : {},
  };
}
