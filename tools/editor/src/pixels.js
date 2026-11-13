import { pixelAt, setPixel } from "./png.js";

export const PENCIL = [0, 0, 0, 255];
export const ERASER = [0, 0, 0, 0];

function inside(bounds, x, y) {
  return x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.width && y < bounds.y + bounds.height;
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
    const boundedDx = Math.max(this.bounds.x - rect.x, Math.min(this.bounds.x + this.bounds.width - rect.x - rect.width, dx));
    const boundedDy = Math.max(this.bounds.y - rect.y, Math.min(this.bounds.y + this.bounds.height - rect.y - rect.height, dy));
    if (boundedDx === 0 && boundedDy === 0) return { dx: 0, dy: 0 };
    const snapshot = [];
    for (let y = 0; y < rect.height; y += 1) {
      for (let x = 0; x < rect.width; x += 1) {
        const source = { width: this.asset.width, height: this.asset.height, data: this.data };
        snapshot.push(pixelAt(source, rect.x + x, rect.y + y));
      }
    }
    this.fillRect(rect, ERASER);
    const image = { width: this.asset.width, height: this.asset.height, data: this.data };
    let cursor = 0;
    for (let y = 0; y < rect.height; y += 1) {
      for (let x = 0; x < rect.width; x += 1) {
        setPixel(image, rect.x + x + boundedDx, rect.y + y + boundedDy, snapshot[cursor++]);
        this.touched.add((rect.y + y + boundedDy) * this.asset.width + rect.x + x + boundedDx);
      }
    }
    return { dx: boundedDx, dy: boundedDy };
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
