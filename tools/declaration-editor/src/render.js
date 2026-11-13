// Canvas composition for the editor. Rendering mirrors the layer order in
// ../../SPEC.md: own texture first, then imports in declaration order.

import { placementMap } from "./model.js";

export function textureMapKey(set, source) {
  return `${set}\u0000${source}`;
}

export function drawGlyph(ctx, doc, images, groupName, index, x, y, scale, depth = 0) {
  const group = doc.groups[groupName];
  if (!group || index < 0 || index >= group.count || depth > 64) return;
  const [width, height] = group.size;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width * scale, height * scale);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;

  if (group.texture) {
    const image = images.get(textureMapKey(group.texture.set, group.texture.source));
    if (image && image.complete && image.naturalWidth > 0) {
      const [sx, sy] = textureCrop(group, index);
      ctx.drawImage(
        image,
        sx,
        sy,
        width,
        height,
        x,
        y,
        width * scale,
        height * scale,
      );
    }
  }

  const layers = placementMap(doc, groupName).get(index) ?? [];
  for (const layer of layers) {
    const imp = group.imports[layer.importIndex];
    const [dx, dy] = imp.offset;
    drawGlyph(
      ctx,
      doc,
      images,
      layer.group,
      layer.index,
      x + dx * scale,
      y + dy * scale,
      scale,
      depth + 1,
    );
  }

  ctx.restore();
}

export function textureCrop(group, index) {
  const [width, height] = group.size;
  const [x0, y0] = group.texture.start;
  const [sx, sy] = {
    right: [width, 0],
    left: [-width, 0],
    down: [0, height],
    up: [0, -height],
  }[group.texture.direction];
  return [x0 + index * sx, y0 + index * sy];
}

export function prepareCanvas(canvas, cssWidth, cssHeight) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(cssWidth * dpr));
  canvas.height = Math.max(1, Math.round(cssHeight * dpr));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  return ctx;
}

export function renderGlyphCanvas(canvas, doc, images, groupName, index, scale = 3) {
  const group = doc.groups[groupName];
  if (!group) return;
  const ctx = prepareCanvas(canvas, group.size[0] * scale, group.size[1] * scale);
  drawGlyph(ctx, doc, images, groupName, index, 0, 0, scale);
}

export function renderPageCanvas(canvas, doc, images, groupName, start, count, scale, columns) {
  const group = doc.groups[groupName];
  if (!group) return;
  const [width, height] = group.size;
  const cellWidth = width * scale;
  const cellHeight = height * scale;
  const rows = Math.ceil(count / columns);
  const ctx = prepareCanvas(canvas, cellWidth * columns, cellHeight * rows);
  for (let offset = 0; offset < count; offset += 1) {
    const index = start + offset;
    if (index >= group.count) break;
    const x = (offset % columns) * cellWidth;
    const y = Math.floor(offset / columns) * cellHeight;
    drawGlyph(ctx, doc, images, groupName, index, x, y, scale);
  }
}
