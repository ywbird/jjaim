import { setPixel } from "./png.js";
import { diffSnapshotToAssets } from "./pixels.js";

function clonePixel(pixel) {
  return [pixel[0], pixel[1], pixel[2], pixel[3]];
}

function samePixel(a, b) {
  if (a[3] !== b[3]) return false;
  return a[3] === 0 || (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);
}

function normalizeChanges(changes) {
  return changes.filter((change) => !samePixel(change.before, change.after));
}

function applyChanges(asset, changes, side) {
  const image = { width: asset.width, height: asset.height, data: asset.current };
  for (const change of changes) setPixel(image, change.x, change.y, change[side]);
  asset.version += 1;
}

export class History {
  constructor(assets) {
    this.assets = assets;
    this.revisions = new Map();
    this.rootId = "r0";
    this.revisions.set(this.rootId, {
      id: this.rootId,
      parent: null,
      timestamp: Date.now(),
      kind: "original",
      start: null,
      changes: new Map(),
      index: 0,
    });
    this.headId = this.rootId;
    this.redoChoice = null;
    this.sequence = 1;
  }

  get head() {
    return this.revisions.get(this.headId);
  }

  revision(id) {
    return this.revisions.get(id) ?? null;
  }

  childrenOf(id) {
    return [...this.revisions.values()].filter((revision) => revision.parent === id).sort((a, b) => a.index - b.index);
  }

  commit(changesByAsset, meta = {}) {
    const normalized = new Map();
    for (const [path, raw] of changesByAsset) {
      const asset = this.assets.get(path);
      if (!asset) throw new Error(`자산을 찾지 못했습니다: ${path}`);
      const changes = normalizeChanges(raw);
      if (changes.length) normalized.set(path, changes);
    }
    if (normalized.size === 0) return null;
    for (const [path, changes] of normalized) {
      const asset = this.assets.get(path);
      for (const change of changes) {
        const offset = (change.y * asset.width + change.x) * 4;
        const current = [asset.current[offset], asset.current[offset + 1], asset.current[offset + 2], asset.current[offset + 3]];
        if (!samePixel(current, change.before)) throw new Error(`픽셀 상태가 명령의 before와 다릅니다: ${path} (${change.x},${change.y})`);
      }
    }
    const parent = this.headId;
    const revision = {
      id: `r${this.sequence++}`,
      parent,
      timestamp: Date.now(),
      kind: meta.kind ?? "pixels",
      start: meta.start ?? null,
      note: meta.note ?? null,
      changes: normalized,
      index: this.sequence,
    };
    this.revisions.set(revision.id, revision);
    for (const [path, changes] of normalized) applyChanges(this.assets.get(path), changes, "after");
    this.headId = revision.id;
    this.redoChoice = null;
    return revision;
  }

  undo() {
    const revision = this.head;
    if (!revision || !revision.parent) return null;
    for (const [path, changes] of revision.changes) {
      const asset = this.assets.get(path);
      if (asset) applyChanges(asset, changes, "before");
    }
    this.redoChoice = revision.id;
    this.headId = revision.parent;
    return revision;
  }

  redo() {
    const children = this.childrenOf(this.headId);
    if (children.length === 0) return null;
    let target = children.find((revision) => revision.id === this.redoChoice);
    if (!target) target = children[children.length - 1];
    for (const [path, changes] of target.changes) {
      const asset = this.assets.get(path);
      if (asset) applyChanges(asset, changes, "after");
    }
    this.headId = target.id;
    this.redoChoice = null;
    return target;
  }

  pathTo(id) {
    const path = [];
    let current = this.revisions.get(id);
    while (current) {
      path.push(current);
      current = current.parent ? this.revisions.get(current.parent) : null;
    }
    return path.reverse();
  }

  stateAt(id) {
    const state = new Map();
    for (const [path, asset] of this.assets.assets) state.set(path, asset.original.slice());
    for (const revision of this.pathTo(id)) {
      for (const [path, changes] of revision.changes) {
        const data = state.get(path);
        if (!data) continue;
        const asset = this.assets.get(path);
        const image = { width: asset.width, height: asset.height, data };
        for (const change of changes) setPixel(image, change.x, change.y, change.after);
      }
    }
    return state;
  }

  diffFor(id) {
    const revision = this.revisions.get(id);
    if (!revision || !revision.parent) return { revision, before: this.stateAt(id), after: this.stateAt(id), changes: new Map() };
    const before = this.stateAt(revision.parent);
    const after = this.stateAt(id);
    const changes = new Map();
    for (const [path, changesForAsset] of revision.changes) changes.set(path, changesForAsset);
    return { revision, before, after, changes };
  }

  restore(id) {
    if (!this.revisions.has(id)) throw new Error("존재하지 않는 revision입니다");
    const before = this.assets.snapshot();
    const target = this.stateAt(id);
    for (const [path, data] of target) {
      const asset = this.assets.get(path);
      if (!asset) continue;
      asset.current.set(data);
      asset.version += 1;
    }
    const changes = diffSnapshotToAssets(before, this.assets);
    if (changes.size === 0) return null;
    // The restore compares against the current head; put pixels back so commit
    // can validate its before values from the same starting point.
    for (const [path, data] of before) this.assets.get(path).current.set(data);
    return this.commit(changes, { kind: "restore", note: `revision ${id} 복원` });
  }

  toJSON() {
    return {
      rootId: this.rootId,
      headId: this.headId,
      redoChoice: this.redoChoice,
      sequence: this.sequence,
      revisions: [...this.revisions.values()].map((revision) => ({
        ...revision,
        changes: [...revision.changes.entries()],
      })),
    };
  }

  static fromJSON(assets, data) {
    const history = new History(assets);
    history.revisions.clear();
    for (const raw of data.revisions) {
      history.revisions.set(raw.id, { ...raw, changes: new Map(raw.changes) });
    }
    history.rootId = data.rootId;
    history.headId = data.headId;
    history.redoChoice = data.redoChoice ?? null;
    history.sequence = data.sequence;
    return history;
  }
}

export function pixelChangesForRect(asset, rect, rgba) {
  const changes = [];
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const offset = (y * asset.width + x) * 4;
      const before = [asset.current[offset], asset.current[offset + 1], asset.current[offset + 2], asset.current[offset + 3]];
      const after = clonePixel(rgba);
      if (!samePixel(before, after)) changes.push({ x, y, before, after });
    }
  }
  return changes;
}
