const LIMITS = {
  declarationBytes: 8 * 1024 * 1024,
  groups: 4096,
  glyphs: 1_000_000,
  placements: 2_000_000,
  depth: 128,
  groupSide: 8192,
  groupPixels: 16_777_216,
};

export class DeclError extends Error {
  constructor(message, path = "$", line = null, column = null) {
    const where = path && path !== "$" ? `${path}: ` : "";
    const loc = line == null ? "" : ` (줄 ${line}, 열 ${column})`;
    super(`${where}${message}${loc}`);
    this.name = "DeclError";
    this.path = path;
    this.line = line;
    this.column = column;
  }
}

const GROUP_FIELDS = new Set(["description", "size", "count", "texture", "imports", "unicode"]);
const TEXTURE_FIELDS = new Set(["set", "source", "start", "direction"]);
const IMPORT_FIELDS = new Set(["group", "offset", "at"]);
const AT_FIELDS = new Set(["from", "to", "repeat"]);
const AXIS_FIELDS = new Set(["count", "from_stride", "to_stride"]);
const UNICODE_FIELDS = new Set(["from", "to"]);
const ROOT_FIELDS = new Set(["metadata", "texture_sets", "groups"]);
const DIRECTIONS = new Set(["right", "left", "down", "up"]);

function fail(path, message) {
  throw new DeclError(message, path);
}

class JsonParser {
  constructor(text) {
    this.text = text;
    this.i = 0;
    this.line = 1;
    this.column = 1;
  }

  error(message) {
    throw new DeclError(message, "$", this.line, this.column);
  }

  peek() {
    return this.text[this.i];
  }

  next() {
    const ch = this.text[this.i++];
    if (ch === "\n") {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
    return ch;
  }

  skip() {
    while (this.i < this.text.length) {
      const ch = this.peek();
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") this.next();
      else break;
    }
  }

  parse() {
    this.skip();
    const value = this.value("$");
    this.skip();
    if (this.i !== this.text.length) this.error("JSON 뒤에 불필요한 문자가 있습니다");
    return value;
  }

  value(path) {
    this.skip();
    const ch = this.peek();
    if (ch === "{") return this.object(path);
    if (ch === "[") return this.array(path);
    if (ch === '"') return this.string();
    if (ch === "-" || (ch >= "0" && ch <= "9")) return this.number();
    if (this.text.startsWith("true", this.i)) {
      this.i += 4;
      this.column += 4;
      return true;
    }
    if (this.text.startsWith("false", this.i)) {
      this.i += 5;
      this.column += 5;
      return false;
    }
    if (this.text.startsWith("null", this.i)) {
      this.i += 4;
      this.column += 4;
      return null;
    }
    this.error("JSON 값을 기대했습니다");
  }

  string() {
    this.next();
    let out = "";
    while (this.i < this.text.length) {
      const ch = this.next();
      if (ch === '"') return out;
      if (ch === "\\") {
        const esc = this.next();
        if (esc === '"' || esc === "\\" || esc === "/") out += esc;
        else if (esc === "b") out += "\b";
        else if (esc === "f") out += "\f";
        else if (esc === "n") out += "\n";
        else if (esc === "r") out += "\r";
        else if (esc === "t") out += "\t";
        else if (esc === "u") {
          let hex = "";
          for (let k = 0; k < 4; k += 1) {
            const digit = this.next();
            if (!/[0-9A-Fa-f]/.test(digit ?? "")) this.error("잘못된 \\u 이스케이프입니다");
            hex += digit;
          }
          out += String.fromCharCode(parseInt(hex, 16));
        } else this.error("잘못된 문자열 이스케이프입니다");
      } else {
        if (ch.charCodeAt(0) < 0x20) this.error("문자열 안에 제어 문자가 있습니다");
        out += ch;
      }
    }
    this.error("문자열이 닫히지 않았습니다");
  }

  number() {
    const start = this.i;
    if (this.peek() === "-") this.next();
    if (this.peek() === "0") this.next();
    else if (this.peek() >= "1" && this.peek() <= "9") {
      while (this.peek() >= "0" && this.peek() <= "9") this.next();
    } else this.error("잘못된 숫자입니다");
    if (this.peek() === ".") {
      this.next();
      if (!(this.peek() >= "0" && this.peek() <= "9")) this.error("잘못된 숫자입니다");
      while (this.peek() >= "0" && this.peek() <= "9") this.next();
    }
    if (this.peek() === "e" || this.peek() === "E") {
      this.next();
      if (this.peek() === "+" || this.peek() === "-") this.next();
      if (!(this.peek() >= "0" && this.peek() <= "9")) this.error("잘못된 숫자입니다");
      while (this.peek() >= "0" && this.peek() <= "9") this.next();
    }
    const value = Number(this.text.slice(start, this.i));
    if (!Number.isFinite(value)) this.error("JSON에서 허용하지 않는 숫자입니다");
    return value;
  }

  object(path) {
    this.next();
    const out = new Map();
    this.skip();
    if (this.peek() === "}") {
      this.next();
      return out;
    }
    for (;;) {
      this.skip();
      if (this.peek() !== '"') this.error("객체 키는 문자열이어야 합니다");
      const key = this.string();
      if (out.has(key)) this.error(`JSON 중복 키입니다 (duplicate key): ${JSON.stringify(key)}`);
      this.skip();
      if (this.peek() !== ":") this.error("':'를 기대했습니다");
      this.next();
      out.set(key, this.value(`${path}.${key}`));
      this.skip();
      const ch = this.next();
      if (ch === "}") return out;
      if (ch !== ",") this.error("',' 또는 '}'를 기대했습니다");
    }
  }

  array(path) {
    this.next();
    const out = [];
    this.skip();
    if (this.peek() === "]") {
      this.next();
      return out;
    }
    for (let index = 0; ; index += 1) {
      out.push(this.value(`${path}[${index}]`));
      this.skip();
      const ch = this.next();
      if (ch === "]") return out;
      if (ch !== ",") this.error("',' 또는 ']'를 기대했습니다");
    }
  }
}

export function parseJsonStrict(text) {
  return new JsonParser(text).parse();
}

function objectAt(value, path) {
  if (!(value instanceof Map)) fail(path, "객체여야 합니다");
  return value;
}

function arrayAt(value, path) {
  if (!Array.isArray(value)) fail(path, "배열이어야 합니다");
  return value;
}

function stringAt(value, path, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    fail(path, allowEmpty ? "문자열이어야 합니다" : "비어 있지 않은 문자열이어야 합니다");
  }
  return value;
}

function safeInt(value, path) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    fail(path, "안전한 정수여야 합니다");
  }
  return value;
}

function positiveInt(value, path) {
  const number = safeInt(value, path);
  if (number <= 0) fail(path, "양의 정수여야 합니다");
  return number;
}

function point(value, path) {
  const items = arrayAt(value, path);
  if (items.length !== 2) fail(path, "길이 2의 정수 좌표여야 합니다");
  return [safeInt(items[0], `${path}[0]`), safeInt(items[1], `${path}[1]`)];
}

function range(value, path, allowEmpty = false) {
  const [a, b] = point(value, path);
  if (a < 0) fail(path, "시작 인덱스는 0 이상이어야 합니다");
  if (allowEmpty ? b < a : b <= a) fail(path, allowEmpty ? "역방향 범위입니다" : "빈 범위이거나 역방향 범위입니다");
  return [a, b];
}

function rejectUnknown(obj, allowed, path) {
  for (const key of obj.keys()) {
    if (!allowed.has(key)) fail(`${path}.${key}`, "알 수 없는 필드입니다 (unknown field)");
  }
}

function required(obj, key, path) {
  if (!obj.has(key)) fail(path, `필수 필드 '${key}'가 없습니다`);
  return obj.get(key);
}

function parseCodepoint(value, path) {
  const text = stringAt(value, path);
  const match = /^U\+([0-9A-Fa-f]+)$/.exec(text);
  if (!match) fail(path, "U+XXXX 형식의 코드 포인트여야 합니다");
  const codepoint = parseInt(match[1], 16);
  if (codepoint > 0x10ffff) fail(path, "유니코드 범위를 벗어났습니다");
  if (codepoint >= 0xd800 && codepoint <= 0xdfff) fail(path, "서로게이트는 유효한 스칼라 값이 아닙니다");
  return codepoint;
}

function parseTextureSets(value) {
  const sets = objectAt(value, "$.texture_sets");
  const out = new Map();
  for (const [setName, sources] of sets) {
    stringAt(setName, "$.texture_sets.<name>");
    const setPath = `$.texture_sets.${setName}`;
    const members = objectAt(sources, setPath);
    const mapped = new Map();
    for (const [sourceName, imagePath] of members) {
      stringAt(sourceName, `${setPath}.<name>`);
      mapped.set(sourceName, stringAt(imagePath, `${setPath}.${sourceName}`));
    }
    out.set(setName, mapped);
  }
  return out;
}

function parseTexture(value, path) {
  const obj = objectAt(value, path);
  rejectUnknown(obj, TEXTURE_FIELDS, path);
  const direction = stringAt(required(obj, "direction", path), `${path}.direction`);
  if (!DIRECTIONS.has(direction)) fail(`${path}.direction`, "right|left|down|up 중 하나여야 합니다");
  return {
    set: stringAt(required(obj, "set", path), `${path}.set`),
    source: stringAt(required(obj, "source", path), `${path}.source`),
    start: point(required(obj, "start", path), `${path}.start`),
    direction,
  };
}

function parseAxis(value, path, span) {
  const obj = objectAt(value, path);
  rejectUnknown(obj, AXIS_FIELDS, path);
  return {
    count: positiveInt(required(obj, "count", path), `${path}.count`),
    fromStride: obj.has("from_stride") ? safeInt(obj.get("from_stride"), `${path}.from_stride`) : 0,
    toStride: obj.has("to_stride") ? safeInt(obj.get("to_stride"), `${path}.to_stride`) : span,
  };
}

function parseAt(value, path) {
  const obj = objectAt(value, path);
  rejectUnknown(obj, AT_FIELDS, path);
  const [a, b] = range(required(obj, "from", path), `${path}.from`);
  const to = safeInt(required(obj, "to", path), `${path}.to`);
  if (to < 0) fail(`${path}.to`, "0 이상이어야 합니다");
  const repeat = arrayAt(obj.get("repeat") ?? [], `${path}.repeat`).map((item, index) =>
    parseAxis(item, `${path}.repeat[${index}]`, b - a),
  );
  for (const axis of repeat) {
    if (!Number.isSafeInteger(axis.count * (b - a))) fail(`${path}.repeat`, "반복 확장 수가 안전한 정수 범위를 벗어났습니다");
  }
  return { a, b, to, repeat };
}

function parseImport(value, path) {
  const obj = objectAt(value, path);
  rejectUnknown(obj, IMPORT_FIELDS, path);
  const at = arrayAt(required(obj, "at", path), `${path}.at`).map((item, index) => parseAt(item, `${path}.at[${index}]`));
  return {
    group: stringAt(required(obj, "group", path), `${path}.group`),
    offset: point(required(obj, "offset", path), `${path}.offset`),
    at,
  };
}

function parseGroup(name, value) {
  const path = `groups.${name}`;
  const obj = objectAt(value, path);
  rejectUnknown(obj, GROUP_FIELDS, path);
  const [width, height] = point(required(obj, "size", path), `${path}.size`);
  if (width <= 0 || height <= 0) fail(`${path}.size`, "양의 정수 크기여야 합니다");
  if (width > LIMITS.groupSide || height > LIMITS.groupSide || width * height > LIMITS.groupPixels) {
    fail(`${path}.size`, "그룹 크기가 자원 한계를 넘습니다");
  }
  const count = positiveInt(required(obj, "count", path), `${path}.count`);
  const description = obj.has("description") ? stringAt(obj.get("description"), `${path}.description`, true) : null;
  const texture = obj.has("texture") ? parseTexture(obj.get("texture"), `${path}.texture`) : null;
  const imports = arrayAt(obj.get("imports") ?? [], `${path}.imports`).map((item, index) =>
    parseImport(item, `${path}.imports[${index}]`),
  );
  const unicode = arrayAt(obj.get("unicode") ?? [], `${path}.unicode`).map((item, index) => {
    const p = `${path}.unicode[${index}]`;
    const rangeObj = objectAt(item, p);
    rejectUnknown(rangeObj, UNICODE_FIELDS, p);
    const [a, b] = range(required(rangeObj, "from", p), `${p}.from`);
    const to = parseCodepoint(required(rangeObj, "to", p), `${p}.to`);
    const last = to + (b - a) - 1;
    if (last > 0x10ffff) fail(`${p}.to`, "유니코드 범위를 벗어났습니다");
    if (to <= 0xdfff && last >= 0xd800) fail(`${p}.to`, "서로게이트를 포함한 범위입니다");
    return { a, b, to };
  });
  return { name, width, height, count, description, texture, imports, unicode };
}

function directionStep(texture, width, height) {
  if (texture.direction === "right") return [width, 0];
  if (texture.direction === "left") return [-width, 0];
  if (texture.direction === "down") return [0, height];
  return [0, -height];
}

export function cropBox(group, index) {
  const [sx, sy] = directionStep(group.texture, group.width, group.height);
  const x = group.texture.start[0] + index * sx;
  const y = group.texture.start[1] + index * sy;
  return { x, y, width: group.width, height: group.height };
}

function expandAt(at) {
  const result = [];
  const axes = at.repeat;
  const combo = new Array(axes.length).fill(0);
  const total = axes.reduce((acc, axis) => acc * axis.count, 1);
  if (!Number.isSafeInteger(total)) fail("$.groups", "반복 확장 수가 안전한 정수 범위를 벗어났습니다");
  for (let n = 0; n < total; n += 1) {
    let sourceShift = 0;
    let targetShift = 0;
    for (let k = 0; k < axes.length; k += 1) {
      sourceShift += combo[k] * axes[k].fromStride;
      targetShift += combo[k] * axes[k].toStride;
    }
    if (!Number.isSafeInteger(sourceShift) || !Number.isSafeInteger(targetShift)) {
      fail("$.groups", "반복 이동량이 안전한 정수 범위를 벗어났습니다");
    }
    for (let j = 0; j < at.b - at.a; j += 1) {
      result.push({
        source: at.a + j + sourceShift,
        target: at.to + j + targetShift,
        combo: combo.slice(),
        j,
      });
    }
    for (let k = axes.length - 1; k >= 0; k -= 1) {
      combo[k] += 1;
      if (combo[k] < axes[k].count) break;
      combo[k] = 0;
    }
  }
  return result;
}

function placementKey(placement) {
  return `${placement.importIndex}:${placement.atIndex}:${placement.source}:${placement.target}:${placement.combo.join(",")}:${placement.j}`;
}

export function parseDeclaration(text, { fileName = "declaration.json" } = {}) {
  if (typeof text !== "string") throw new DeclError("선언은 문자열이어야 합니다");
  const sourceText = text;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (new TextEncoder().encode(text).length > LIMITS.declarationBytes) {
    throw new DeclError("선언 JSON이 8 MiB 한도를 넘습니다");
  }
  const root = objectAt(parseJsonStrict(text), "$");
  rejectUnknown(root, ROOT_FIELDS, "$");
  const metadata = root.has("metadata") ? objectAt(root.get("metadata"), "$.metadata") : new Map();
  for (const key of ["name", "version", "author"]) {
    if (metadata.has(key) && typeof metadata.get(key) !== "string") fail(`$.metadata.${key}`, "문자열이어야 합니다");
  }
  const textureSets = root.has("texture_sets") ? parseTextureSets(root.get("texture_sets")) : new Map();
  const groupObjects = objectAt(required(root, "groups", "$"), "$.groups");
  if (groupObjects.size > LIMITS.groups) fail("$.groups", "그룹 수가 4,096개 한도를 넘습니다");
  const groups = new Map();
  let glyphTotal = 0;
  for (const [name, value] of groupObjects) {
    stringAt(name, "$.groups.<name>");
    const group = parseGroup(name, value);
    glyphTotal += group.count;
    if (glyphTotal > LIMITS.glyphs) fail(`groups.${name}.count`, "전체 그룹 글리프 수가 1,000,000개 한도를 넘습니다");
    groups.set(name, group);
  }

  // Structural texture references.
  for (const group of groups.values()) {
    if (!group.texture) continue;
    const sources = textureSets.get(group.texture.set);
    if (!sources) fail(`groups.${group.name}.texture.set`, `존재하지 않는 텍스처셋입니다: ${JSON.stringify(group.texture.set)}`);
    if (!sources.has(group.texture.source)) {
      fail(`groups.${group.name}.texture.source`, `텍스처셋 ${JSON.stringify(group.texture.set)}에 없는 소스입니다: ${JSON.stringify(group.texture.source)}`);
    }
  }

  // Import references, ranges and expansion limits.
  let placementTotal = 0;
  for (const group of groups.values()) {
    for (let importIndex = 0; importIndex < group.imports.length; importIndex += 1) {
      const imp = group.imports[importIndex];
      const child = groups.get(imp.group);
      if (!child) fail(`groups.${group.name}.imports[${importIndex}].group`, `존재하지 않는 그룹입니다: ${JSON.stringify(imp.group)}`);
      for (let atIndex = 0; atIndex < imp.at.length; atIndex += 1) {
        const at = imp.at[atIndex];
        if (at.b > child.count) fail(`groups.${group.name}.imports[${importIndex}].at[${atIndex}].from`, `원본 그룹 ${JSON.stringify(child.name)}의 인덱스 범위를 벗어났습니다`);
        const count = at.repeat.reduce((acc, axis) => acc * axis.count, 1) * (at.b - at.a);
        placementTotal += count;
        if (placementTotal > LIMITS.placements) fail(`groups.${group.name}.imports[${importIndex}]`, "확장 배치 수가 2,000,000개 한도를 넘습니다");
        for (const placement of expandAt(at)) {
          if (placement.source < 0 || placement.source >= child.count) fail(`groups.${group.name}.imports[${importIndex}].at[${atIndex}]`, `반복을 편 원본 인덱스 ${placement.source}가 그룹 ${JSON.stringify(child.name)}의 범위를 벗어났습니다`);
          if (placement.target < 0 || placement.target >= group.count) fail(`groups.${group.name}.imports[${importIndex}].at[${atIndex}]`, `반복을 편 대상 인덱스 ${placement.target}가 그룹 ${JSON.stringify(group.name)}의 범위를 벗어났습니다`);
        }
      }
    }
  }

  const depths = new Map();
  const visiting = new Set();
  const depthOf = (name) => {
    if (depths.has(name)) return depths.get(name);
    if (visiting.has(name)) throw new DeclError(`임포트 순환 참조입니다: ${name}`, `groups.${name}.imports`);
    visiting.add(name);
    let depth = 0;
    for (const imp of groups.get(name).imports) depth = Math.max(depth, 1 + depthOf(imp.group));
    visiting.delete(name);
    if (depth > LIMITS.depth) fail(`groups.${name}.imports`, "임포트 깊이가 128 한도를 넘습니다");
    depths.set(name, depth);
    return depth;
  };
  for (const name of groups.keys()) depthOf(name);

  const unicodeMap = new Map();
  const glyphAliases = new Map();
  for (const group of groups.values()) {
    for (let rangeIndex = 0; rangeIndex < group.unicode.length; rangeIndex += 1) {
      const item = group.unicode[rangeIndex];
      if (item.b > group.count) fail(`groups.${group.name}.unicode[${rangeIndex}].from`, `그룹 인덱스 범위를 벗어났습니다 (count=${group.count})`);
      for (let offset = 0; offset < item.b - item.a; offset += 1) {
        const codepoint = item.to + offset;
        const index = item.a + offset;
        const previous = unicodeMap.get(codepoint);
        if (previous && (previous.group !== group.name || previous.index !== index)) {
          fail(`groups.${group.name}.unicode[${rangeIndex}]`, `U+${codepoint.toString(16).toUpperCase().padStart(4, "0")} 충돌: ${previous.group}[${previous.index}]와 ${group.name}[${index}]`);
        }
        unicodeMap.set(codepoint, { group: group.name, index });
        const key = `${group.name}\u0000${index}`;
        if (!glyphAliases.has(key)) glyphAliases.set(key, []);
        if (!glyphAliases.get(key).includes(codepoint)) glyphAliases.get(key).push(codepoint);
      }
    }
  }
  for (const list of glyphAliases.values()) list.sort((a, b) => a - b);

  const placementMaps = new Map();
  const placement = (name) => {
    if (placementMaps.has(name)) return placementMaps.get(name);
    const group = groups.get(name);
    const map = new Map();
    for (let importIndex = 0; importIndex < group.imports.length; importIndex += 1) {
      const imp = group.imports[importIndex];
      for (let atIndex = 0; atIndex < imp.at.length; atIndex += 1) {
        for (const item of expandAt(imp.at[atIndex])) {
          if (!map.has(item.target)) map.set(item.target, []);
          map.get(item.target).push({
            child: imp.group,
            childIndex: item.source,
            importIndex,
            atIndex,
            offset: imp.offset,
            combo: item.combo,
            j: item.j,
            key: placementKey({ importIndex, atIndex, source: item.source, target: item.target, combo: item.combo, j: item.j }),
          });
        }
      }
    }
    placementMaps.set(name, map);
    return map;
  };

  const participating = (name, index) => {
    const ordered = [name];
    const seen = new Set([name]);
    const visit = (groupName, glyphIndex) => {
      for (const item of placement(groupName).get(glyphIndex) ?? []) {
        if (!seen.has(item.child)) {
          seen.add(item.child);
          ordered.push(item.child);
        }
        visit(item.child, item.childIndex);
      }
    };
    visit(name, index);
    return ordered;
  };

  const usages = (name, index) => {
    const found = new Map();
    const add = (codepoint, count = 1) => {
      if (!found.has(codepoint)) found.set(codepoint, 0);
      found.set(codepoint, Math.max(found.get(codepoint), count));
    };
    for (const cp of glyphAliases.get(`${name}\u0000${index}`) ?? []) add(cp, 1);
    const visited = new Set();
    const walk = (childName, childIndex, occurrence) => {
      for (const [parentName, parentGroup] of groups) {
        for (const [targetIndex, items] of placement(parentName)) {
          const hits = items.filter((item) => item.child === childName && item.childIndex === childIndex);
          if (hits.length === 0) continue;
          const key = `${parentName}\u0000${targetIndex}`;
          const nextOccurrence = Math.min(1_000_000, occurrence * hits.length);
          for (const cp of glyphAliases.get(key) ?? []) add(cp, nextOccurrence);
          if (!visited.has(key)) {
            visited.add(key);
            walk(parentName, targetIndex, nextOccurrence);
          }
        }
      }
    };
    walk(name, index, 1);
    return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([codepoint, occurrences]) => ({ codepoint, occurrences }));
  };

  return {
    fileName,
    text: sourceText,
    metadata,
    textureSets,
    groups,
    unicodeMap,
    glyphAliases,
    placement,
    participating,
    usages,
    limits: LIMITS,
  };
}

export function codepointLabel(codepoint) {
  return `U+${codepoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

export function findGroupGlyphByText(declaration, text) {
  const cpMatch = /^(?:U\+|0x)([0-9a-f]+)$/i.exec(text.trim());
  if (cpMatch) {
    const cp = parseInt(cpMatch[1], 16);
    if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return { error: "유효하지 않은 코드 포인트입니다" };
    const found = declaration.unicodeMap.get(cp);
    return found ? { ...found, codepoint: cp } : { error: `${codepointLabel(cp)}에 매핑된 글자가 없습니다` };
  }
  const glyphMatch = /^(.+)\[(\d+)\]$/.exec(text.trim());
  if (glyphMatch) {
    const group = declaration.groups.get(glyphMatch[1]);
    if (!group) return { error: `그룹을 찾지 못했습니다: ${glyphMatch[1]}` };
    const index = Number(glyphMatch[2]);
    if (!Number.isSafeInteger(index) || index < 0 || index >= group.count) return { error: `${group.name}의 인덱스 범위를 벗어났습니다` };
    return { group: group.name, index };
  }
  return null;
}
