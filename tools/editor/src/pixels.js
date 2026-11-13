import { pixelAt, setPixel } from "./png.js";

export const PENCIL = [0, 0, 0, 255];
export const ERASER = [0, 0, 0, 0];

function inside(bounds, x, y) {
  return x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.width && y < bounds.y + bounds.height;
}

function sourceOver(source, destination) {
  const sa = source[3] / 255;
  const da = destination[3] / 255;
  const alpha = sa + da * (1 - sa);
  if (alpha === 0) return [0, 0, 0, 0];
  const blend = (index) => Math.round((source[index] * sa + destination[index] * da * (1 - sa)) / alpha);
  return [blend(0), blend(1), blend(2), Math.round(alpha * 255)];
}

export class PixelDraft {
  constructor(asset, bounds) {
    this.asset = asset;
    this.bounds = { ...bounds };
    this.before = asset.current.slice();
    this.data = asset.current.slice();
    this.touched = new Set();
  }

  set(x, y, rgba) {
    if (!inside(this.bounds, x, y)) return false;
    const image = { width: this.asset.width, height: this.asset.height, data: this.data };
    setPixel(image, x, y, rgba);
    this.touched.add(y * this.asset.width + x);
    return true;
  }

  erase(x, y) {
    return this.set(x, y, ERASER);
  }

  line(x0, y0, x1, y1, rgba) {
    let x = x0;
    let y = y0;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      this.set(x, y, rgba);
      if (x === x1 && y === y1) break;
      const twice = 2 * error;
      if (twice >= dy) {
        error += dy;
        x += sx;
      }
      if (twice <= dx) {
        error += dx;
        y += sy;
      }
    }
  }

  fillRect(rect, rgba) {
    for (let y = rect.y; y < rect.y + rect.height; y += 1) {
      for (let x = rect.x; x < rect.x + rect.width; x += 1) this.set(x, y, rgba);
    }
  }

  move(rect, dx, dy) {
    if (dx === 0 && dy === 0) return { dx: 0, dy: 0 };
    const source = { width: this.asset.width, height: this.asset.height, data: this.data };
    const snapshot = [];
    for (let y = 0; y < rect.height; y += 1) {
      for (let x = 0; x < rect.width; x += 1) {
        const sx = rect.x + x;
        const sy = rect.y + y;
        snapshot.push(inside(this.bounds, sx, sy) ? pixelAt(source, sx, sy) : [0, 0, 0, 0]);
      }
    }
    this.fillRect(rect, ERASER);
    let cursor = 0;
    for (let y = 0; y < rect.height; y += 1) {
      for (let x = 0; x < rect.width; x += 1) {
        const tx = rect.x + x + dx;
        const ty = rect.y + y + dy;
        // Moving past the glyph edge trims the outside pixels; the selection
        // rectangle itself may stay outside so it can be dragged back in.
        if (inside(this.bounds, tx, ty)) this.set(tx, ty, snapshot[cursor]);
        cursor += 1;
      }
    }
    return { dx, dy };
  }

  paste(rect, data) {
    const image = { width: this.asset.width, height: this.asset.height, data: this.data };
    for (let y = 0; y < rect.height; y += 1) {
      for (let x = 0; x < rect.width; x += 1) {
        const tx = rect.x + x;
        const ty = rect.y + y;
        if (!inside(this.bounds, tx, ty)) continue;
        const offset = (y * rect.width + x) * 4;
        const source = [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
        if (source[3] === 0) continue;
        this.set(tx, ty, sourceOver(source, pixelAt(image, tx, ty)));
      }
    }
  }

  changes() {
    const changes = [];
    const beforeImage = { width: this.asset.width, height: this.asset.height, data: this.before };
    const afterImage = { width: this.asset.width, height: this.asset.height, data: this.data };
    const width = this.asset.width;
    for (const index of [...this.touched].sort((a, b) => a - b)) {
      const x = index % width;
      const y = Math.floor(index / width);
      const before = pixelAt(beforeImage, x, y);
      const after = pixelAt(afterImage, x, y);
      if (before[3] === after[3] && (after[3] === 0 || (before[0] === after[0] && before[1] === after[1] && before[2] === after[2]))) continue;
      changes.push({ x, y, before, after });
    }
    return changes;
  }
}

export function boundsOf(changes) {
  if (changes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const change of changes) {
    minX = Math.min(minX, change.x);
    minY = Math.min(minY, change.y);
    maxX = Math.max(maxX, change.x + 1);
    maxY = Math.max(maxY, change.y + 1);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function diffSnapshotToAssets(before, assetStore) {
  const result = new Map();
  for (const [path, previous] of before) {
    const asset = assetStore.get(path);
    if (!asset) continue;
    const next = asset.current;
    if (previous.length !== next.length) continue;
    const changes = [];
    for (let i = 0; i < previous.length; i += 4) {
      const same =
        previous[i + 3] === next[i + 3] &&
        (next[i + 3] === 0 ||
          (previous[i] === next[i] && previous[i + 1] === next[i + 1] && previous[i + 2] === next[i + 2]));
      if (!same) {
        const pixel = i / 4;
        changes.push({
          x: pixel % asset.width,
          y: Math.floor(pixel / asset.width),
          before: [...previous.subarray(i, i + 4)],
          after: [...next.subarray(i, i + 4)],
        });
      }
    }
    if (changes.length) result.set(path, changes);
  }
  return result;
}
