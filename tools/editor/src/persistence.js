import { AssetStore, minimumTextureSizes } from "./assets.js";
import { parseDeclaration } from "./declaration.js";
import { History } from "./history.js";

export const SCHEMA_VERSION = 1;
const DB_NAME = "declarative-font-editor";
const STORE = "workspaces";

export class StorageError extends Error {
  constructor(message, cause = null) {
    super(message);
    this.name = "StorageError";
    this.cause = cause;
  }
}

export class PersistenceUnavailable extends StorageError {
  constructor(message = "이 브라우저에서는 IndexedDB를 사용할 수 없습니다") {
    super(message);
    this.name = "PersistenceUnavailable";
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new PersistenceUnavailable());
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onerror = () => reject(new StorageError("IndexedDB를 열지 못했습니다", request.error));
    request.onsuccess = () => resolve(request.result);
  });
}

function transaction(db, mode, work) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result;
    try {
      result = work(store);
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(new StorageError("브라우저 저장 트랜잭션이 실패했습니다", tx.error));
    tx.onabort = () => reject(new StorageError("브라우저 저장이 중단되었습니다", tx.error));
  });
}

export function serializeWorkspace(workspace) {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: workspace.id,
    name: workspace.name,
    fileName: workspace.fileName,
    declarationText: workspace.declaration.text,
    createdAt: workspace.createdAt,
    updatedAt: Date.now(),
    assets: [...workspace.assets.assets.values()].map((asset) => ({
      path: asset.path,
      width: asset.width,
      height: asset.height,
      original: asset.original.slice(),
      current: asset.current.slice(),
    })),
    history: workspace.history.toJSON(),
    view: JSON.parse(JSON.stringify(workspace.view ?? {})),
    font: workspace.font
      ? {
          name: workspace.font.name,
          family: workspace.font.family,
          bytes: workspace.font.bytes?.slice() ?? null,
          settings: { ...workspace.font.settings },
        }
      : null,
  };
}

export function deserializeWorkspace(raw) {
  if (!raw || raw.schemaVersion !== SCHEMA_VERSION) {
    throw new StorageError(`알 수 없는 저장 스키마 버전입니다: ${raw?.schemaVersion ?? "없음"}`);
  }
  const declaration = parseDeclaration(raw.declarationText, { fileName: raw.fileName });
  const assets = new AssetStore();
  const sizes = minimumTextureSizes(declaration);
  for (const item of raw.assets) {
    try {
      assets.bind(item.path, { width: item.width, height: item.height, data: item.original }, { minimum: sizes.get(item.path) });
    } catch (error) {
      throw new StorageError(`저장된 이미지를 열 수 없습니다: ${item.path} (${error.message})`);
    }
    const asset = assets.get(item.path);
    asset.current = item.current.slice();
  }
  const history = History.fromJSON(assets, raw.history);
  return {
    schemaVersion: SCHEMA_VERSION,
    id: raw.id,
    name: raw.name,
    fileName: raw.fileName,
    declaration,
    assets,
    history,
    view: raw.view ?? {},
    font: raw.font
      ? { ...raw.font, bytes: raw.font.bytes ? new Uint8Array(raw.font.bytes) : null, settings: { ...raw.font.settings } }
      : null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export async function saveWorkspace(workspace) {
  const db = await openDb();
  try {
    const record = serializeWorkspace(workspace);
    await transaction(db, "readwrite", (store) => store.put(record));
    return record;
  } finally {
    db.close();
  }
}

export async function loadWorkspace(id) {
  const db = await openDb();
  try {
    const raw = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(id);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(new StorageError("저장된 작업을 읽지 못했습니다", request.error));
    });
    if (!raw) return null;
    return deserializeWorkspace(raw);
  } finally {
    db.close();
  }
}

export async function listWorkspaces() {
  const db = await openDb();
  try {
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result ?? []);
      request.onerror = () => reject(new StorageError("최근 작업 목록을 읽지 못했습니다", request.error));
    });
    return rows
      .map((row) => {
        let images = 0;
        let revisions = 0;
        try {
          images = row.assets?.length ?? 0;
          revisions = row.history?.revisions?.length ?? 0;
        } catch {
          // Corrupt metadata stays visible; load reports the detailed error.
        }
        return {
          id: row.id,
          name: row.name,
          fileName: row.fileName,
          updatedAt: row.updatedAt,
          createdAt: row.createdAt,
          images,
          revisions,
          schemaVersion: row.schemaVersion,
        };
      })
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  } finally {
    db.close();
  }
}

export async function deleteWorkspace(id) {
  const db = await openDb();
  try {
    await transaction(db, "readwrite", (store) => store.delete(id));
  } finally {
    db.close();
  }
}

export async function renameWorkspace(id, name) {
  const workspace = await loadWorkspace(id);
  if (!workspace) throw new StorageError("작업을 찾지 못했습니다");
  workspace.name = name;
  return saveWorkspace(workspace);
}

export class WorkspaceLock {
  constructor(workspaceId, tabId) {
    this.key = `declarative-font-editor-lock:${workspaceId}`;
    this.tabId = tabId;
    this.timer = null;
  }

  tryAcquire() {
    try {
      const raw = localStorage.getItem(this.key);
      const now = Date.now();
      if (raw) {
        const lock = JSON.parse(raw);
        if (lock.tabId !== this.tabId && lock.expires > now) return false;
      }
      this.write();
      return true;
    } catch {
      return true;
    }
  }

  acquire() {
    if (!this.tryAcquire()) return false;
    this.timer = setInterval(() => this.write(), 10000);
    return true;
  }

  write() {
    try {
      localStorage.setItem(this.key, JSON.stringify({ tabId: this.tabId, expires: Date.now() + 120000 }));
    } catch {
      // A storage failure must not block an otherwise usable temporary session.
    }
  }

  release() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      const raw = localStorage.getItem(this.key);
      if (raw && JSON.parse(raw).tabId === this.tabId) localStorage.removeItem(this.key);
    } catch {
      // ignore
    }
  }
}
