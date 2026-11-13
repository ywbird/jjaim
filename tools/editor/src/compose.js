import { cropBox } from "./declaration.js";
import { sourcePath } from "./assets.js";

export const MAX_LAYER_NODES = 2_000_000;

function blank(width, height) {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

function copyRect(source, x, y, width, height) {
  const out = blank(width, height);
  for (let row = 0; row < height; row += 1) {
    const srcStart = ((y + row) * source.width + x) * 4;
    out.data.set(source.data.subarray(srcStart, srcStart + width * 4), row * width * 4);
  }
  return out;
}

export function sourceOverInto(dst, src, dx = 0, dy = 0) {
  const x0 = Math.max(0, dx);
  const y0 = Math.max(0, dy);
  const sx0 = Math.max(0, -dx);
  const sy0 = Math.max(0, -dy);
  const width = Math.min(src.width - sx0, dst.width - x0);
  const height = Math.min(src.height - sy0, dst.height - y0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const si = ((sy0 + y) * src.width + sx0 + x) * 4;
      const di = ((y0 + y) * dst.width + x0 + x) * 4;
      const sa = src.data[si + 3];
      if (sa === 0) continue;
      const da = dst.data[di + 3];
      if (sa === 255) {
        dst.data[di] = src.data[si];
        dst.data[di + 1] = src.data[si + 1];
        dst.data[di + 2] = src.data[si + 2];
        dst.data[di + 3] = 255;
        continue;
      }
      const saN = sa / 255;
      const daN = da / 255;
      const oa = saN + daN * (1 - saN);
      if (oa <= 0) continue;
      dst.data[di] = Math.round((src.data[si] * saN + dst.data[di] * daN * (1 - saN)) / oa);
      dst.data[di + 1] = Math.round((src.data[si + 1] * saN + dst.data[di + 1] * daN * (1 - saN)) / oa);
      dst.data[di + 2] = Math.round((src.data[si + 2] * saN + dst.data[di + 2] * daN * (1 - saN)) / oa);
      dst.data[di + 3] = Math.round(oa * 255);
    }
  }
  return dst;
}

export function ownLayer(declaration, assets, group, index) {
  const image = blank(group.width, group.height);
  if (!group.texture) return { image, error: null };
  const resolved = sourcePath(declaration, group.texture.set, group.texture.source);
  if (resolved.error) return { image, error: { kind: "path", message: resolved.error } };
  const asset = assets.get(resolved.path);
  if (!asset) return { image, error: { kind: "missing", message: `리소스 없음: ${resolved.path}`, path: resolved.path } };
  const box = cropBox(group, index);
  if (box.x < 0 || box.y < 0 || box.x + box.width > asset.width || box.y + box.height > asset.height) {
    return { image, error: { kind: "crop", message: `추출 범위 오류: ${resolved.path} (${box.x},${box.y})-(${box.x + box.width},${box.y + box.height})`, path: resolved.path } };
  }
  return { image: copyRect({ width: asset.width, height: asset.height, data: asset.current }, box.x, box.y, box.width, box.height), error: null, path: resolved.path, box, asset };
}

export function layerId(parentId, importIndex, atIndex, placement, nodeIndex) {
  return `${parentId}/i${importIndex}a${atIndex}e${placement.combo.join(".")}j${placement.j}n${nodeIndex}`;
}

export function buildLayerTree(declaration, groupName, index) {
  let nodes = 0;
  const walk = (name, glyphIndex, parentId, depth) => {
    const group = declaration.groups.get(name);
    const own = { id: `${parentId}/own`, kind: "own", group: name, index: glyphIndex, depth, children: [] };
    nodes += 1;
    if (nodes > MAX_LAYER_NODES) throw new Error("배치 트리 전개가 2,000,000건 한도를 넘습니다");
    const placements = declaration.placement(name).get(glyphIndex) ?? [];
    for (let n = 0; n < placements.length; n += 1) {
      const item = placements[n];
      const id = layerId(parentId, item.importIndex, item.atIndex, item, n);
      const child = {
        id,
        kind: "placement",
        group: item.child,
        index: item.childIndex,
        depth,
        importIndex: item.importIndex,
        atIndex: item.atIndex,
        offset: item.offset,
        combo: item.combo,
        j: item.j,
        children: [],
      };
      nodes += 1;
      if (nodes > MAX_LAYER_NODES) throw new Error("배치 트리 전개가 2,000,000건 한도를 넘습니다");
      child.children.push(walk(item.child, item.childIndex, id, depth + 1));
      own.children.push(child);
    }
    return own;
  };
  const root = walk(groupName, index, "root", 0);
  return { root, nodeCount: nodes };
}

export function flattenLayers(root) {
  const out = [];
  const visit = (node) => {
    if (node.kind === "placement") out.push(node);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return out;
}

export class Renderer {
  constructor(declaration, assets) {
    this.declaration = declaration;
    this.assets = assets;
    this.cache = new Map();
  }

  invalidate() {
    this.cache.clear();
  }

  renderGlyph(name, index, hidden = null) {
    if (!hidden || hidden.size === 0) {
      const key = `${name}\u0000${index}`;
      const cached = this.cache.get(key);
      if (cached) return cached;
      const result = this.#render(name, index, "root", null);
      this.cache.set(key, result);
      return result;
    }
    return this.#render(name, index, "root", hidden);
  }

  #render(name, index, nodeId, hidden) {
    const group = this.declaration.groups.get(name);
    const result = { image: blank(group.width, group.height), errors: [] };
    if (!hidden?.has(`${nodeId}/own`)) {
      const own = ownLayer(this.declaration, this.assets, group, index);
      result.image = own.image;
      if (own.error) result.errors.push(own.error);
    }
    const placements = this.declaration.placement(name).get(index) ?? [];
    for (let n = 0; n < placements.length; n += 1) {
      const item = placements[n];
      const id = layerId(nodeId, item.importIndex, item.atIndex, item, n);
      if (hidden?.has(id)) continue;
      const child = this.#render(item.child, item.childIndex, id, hidden);
      sourceOverInto(result.image, child.image, item.offset[0], item.offset[1]);
      result.errors.push(...child.errors);
    }
    return result;
  }

  ownImage(name, index) {
    return ownLayer(this.declaration, this.assets, this.declaration.groups.get(name), index);
  }

  board(name, index, { hidden = new Set(), ownHidden = false } = {}) {
    const effective = new Set(hidden);
    if (ownHidden) effective.add("root/own");
    const tree = buildLayerTree(this.declaration, name, index);
    const result = this.renderGlyph(name, index, effective);
    return { ...result, tree };
  }
}

export function affectedGroupsForRect(declaration, assets, path, rect) {
  const direct = new Set();
  const keys = new Map();
  for (const group of declaration.groups.values()) {
    if (!group.texture) continue;
    const resolved = sourcePath(declaration, group.texture.set, group.texture.source);
    if (resolved.error || resolved.path !== path) continue;
    for (let index = 0; index < group.count; index += 1) {
      const box = cropBox(group, index);
      if (box.x < rect.x + rect.width && box.x + box.width > rect.x && box.y < rect.y + rect.height && box.y + box.height > rect.y) {
        const key = `${group.name}\u0000${index}`;
        direct.add(key);
        keys.set(key, { group: group.name, index });
      }
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of declaration.groups.values()) {
      for (const [target, items] of declaration.placement(group.name)) {
        const key = `${group.name}\u0000${target}`;
        if (keys.has(key)) continue;
        if (items.some((item) => direct.has(`${item.child}\u0000${item.childIndex}`))) {
          keys.set(key, { group: group.name, index: target });
          direct.add(key);
          changed = true;
        }
      }
    }
  }
  return [...keys.values()];
}

export function affectedCharacters(declaration, assets, changesByPath) {
  const glyphKeys = new Set();
  for (const [path, rects] of changesByPath) {
    for (const rect of rects) {
      for (const glyph of affectedGroupsForRect(declaration, assets, path, rect)) glyphKeys.add(`${glyph.group}\u0000${glyph.index}`);
    }
  }
  const codepoints = new Set();
  for (const key of glyphKeys) {
    const [group, index] = key.split("\u0000");
    for (const cp of declaration.glyphAliases.get(`${group}\u0000${Number(index)}`) ?? []) codepoints.add(cp);
  }
  return [...codepoints].sort((a, b) => a - b);
}

export function actualChanges(declaration, assets, changesByPath, codepoints, beforeSnapshot, afterSnapshot = null) {
  const after = assets.clone();
  if (afterSnapshot) after.restore(afterSnapshot);
  const renderer = new Renderer(declaration, after);
  const before = assets.clone();
  for (const [path, data] of beforeSnapshot) before.restore(new Map([[path, data]]));
  const beforeRenderer = new Renderer(declaration, before);
  const changed = [];
  const unknown = [];
  for (const cp of codepoints) {
    const target = declaration.unicodeMap.get(cp);
    if (!target) continue;
    const afterResult = renderer.renderGlyph(target.group, target.index);
    const beforeResult = beforeRenderer.renderGlyph(target.group, target.index);
    if (afterResult.errors.length || beforeResult.errors.length) {
      unknown.push(cp);
      continue;
    }
    if (!sameImage(beforeResult.image, afterResult.image)) changed.push(cp);
  }
  return { changed, unknown };
}

export function sameImage(a, b) {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.data.length; i += 4) {
    const aa = a.data[i + 3];
    const ba = b.data[i + 3];
    if (aa !== ba) return false;
    if (aa !== 0) {
      if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) return false;
    }
  }
  return true;
}

export function diffImages(before, after) {
  const counts = { added: 0, removed: 0, changed: 0, same: 0 };
  const width = Math.min(before.width, after.width);
  const height = Math.min(before.height, after.height);
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    let row = "";
    for (let x = 0; x < width; x += 1) {
      const i = (y * before.width + x) * 4;
      const j = (y * after.width + x) * 4;
      const ba = before.data[i + 3];
      const aa = after.data[j + 3];
      if (ba === 0 && aa !== 0) {
        counts.added += 1;
        row += "A";
      } else if (ba !== 0 && aa === 0) {
        counts.removed += 1;
        row += "R";
      } else if (ba !== 0 && aa !== 0 && (before.data[i] !== after.data[j] || before.data[i + 1] !== after.data[j + 1] || before.data[i + 2] !== after.data[j + 2] || ba !== aa)) {
        counts.changed += 1;
        row += "C";
      } else {
        counts.same += 1;
        row += ".";
      }
    }
    rows.push(row);
  }
  return { counts, rows };
}
