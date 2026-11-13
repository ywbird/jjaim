import { sourceOverInto } from "./compose.js";

const MAX_SCALARS = 4096;
const MAX_SIDE = 32768;
const MAX_PIXELS = 16_777_216;

function blank(width, height) {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

export function mappedMetrics(declaration) {
  let width = 0;
  let height = 0;
  const groups = new Set();
  for (const { group } of declaration.unicodeMap.values()) {
    if (groups.has(group)) continue;
    groups.add(group);
    const model = declaration.groups.get(group);
    width = Math.max(width, model.width);
    height = Math.max(height, model.height);
  }
  return { width, height };
}

export function buildTextModel(declaration, text) {
  const normalized = String(text).replace(/\r\n?/g, "\n");
  if ([...normalized].length > MAX_SCALARS) throw new Error("문구 미리보기는 4,096개 스칼라 값까지만 지원합니다");
  const metrics = mappedMetrics(declaration);
  const zero = declaration.unicodeMap.get(0);
  const lines = normalized.split("\n").map((line) => {
    const runs = [];
    for (const character of line) {
      const codepoint = character.codePointAt(0);
      const target = declaration.unicodeMap.get(codepoint);
      if (target) {
        const group = declaration.groups.get(target.group);
        runs.push({ kind: "glyph", codepoint, group: target.group, index: target.index, width: group.width, height: group.height });
      } else if (zero) {
        const group = declaration.groups.get(zero.group);
        runs.push({ kind: "substitute", codepoint, group: zero.group, index: zero.index, width: group.width, height: group.height });
      } else {
        runs.push({ kind: "box", codepoint, width: metrics.width || 1, height: metrics.height || 1 });
      }
    }
    return runs;
  });
  return {
    text: normalized,
    lines,
    lineHeight: Math.max(1, metrics.height),
    boxWidth: Math.max(1, metrics.width),
    boxHeight: Math.max(1, metrics.height),
    unmapped: lines.flat().filter((run) => run.kind !== "glyph").map((run) => run.codepoint),
    hasMappings: declaration.unicodeMap.size > 0,
  };
}

function drawBox(image, x, y, width, height) {
  const put = (px, py) => {
    if (px < 0 || py < 0 || px >= image.width || py >= image.height) return;
    const offset = (py * image.width + px) * 4;
    image.data[offset] = 0;
    image.data[offset + 1] = 0;
    image.data[offset + 2] = 0;
    image.data[offset + 3] = 255;
  };
  for (let px = x; px < x + width; px += 1) {
    put(px, y);
    put(px, y + height - 1);
  }
  for (let py = y; py < y + height; py += 1) {
    put(x, py);
    put(x + width - 1, py);
  }
}

export function renderText(declaration, renderer, text) {
  const model = buildTextModel(declaration, text);
  const widths = model.lines.map((runs) => runs.reduce((sum, run) => sum + run.width, 0));
  const width = Math.max(1, ...widths);
  const height = Math.max(model.lineHeight, model.lines.length * model.lineHeight);
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
    throw new Error("문구 미리보기 캔버스가 자원 한도를 넘습니다");
  }
  const image = blank(width, height);
  const errors = [];
  for (let lineIndex = 0; lineIndex < model.lines.length; lineIndex += 1) {
    let x = 0;
    const y = lineIndex * model.lineHeight;
    for (const run of model.lines[lineIndex]) {
      if (run.kind === "glyph" || run.kind === "substitute") {
        const result = renderer.renderGlyph(run.group, run.index);
        sourceOverInto(image, result.image, x, y);
        errors.push(...result.errors);
      } else {
        drawBox(image, x, y, run.width, run.height);
      }
      x += run.width;
    }
  }
  return { ...model, image, errors };
}

export function scaleImage(image, factor) {
  const factorInt = Math.max(1, Math.trunc(factor));
  if (factorInt === 1) return image;
  const width = image.width * factorInt;
  const height = image.height * factorInt;
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) throw new Error("확대한 미리보기 캔버스가 자원 한도를 넘습니다");
  const out = blank(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = ((Math.floor(y / factorInt) * image.width) + Math.floor(x / factorInt)) * 4;
      const target = (y * width + x) * 4;
      out.data.set(image.data.subarray(source, source + 4), target);
    }
  }
  return out;
}
