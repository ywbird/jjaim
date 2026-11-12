// Pure declaration model for the editor: parsing, validation, expansion,
// reverse references, and search. No DOM and no texture loading here.

export const DIRECTIONS = ["right", "left", "down", "up"];

const GROUP_FIELDS = new Set([
  "description",
  "size",
  "count",
  "texture",
  "imports",
  "unicode",
]);
const TEXTURE_FIELDS = new Set(["set", "source", "start", "direction"]);
const IMPORT_FIELDS = new Set(["group", "offset", "at"]);
const AT_FIELDS = new Set(["from", "to", "repeat"]);
const AXIS_FIELDS = new Set(["count", "from_stride", "to_stride"]);
const UNICODE_FIELDS = new Set(["from", "to"]);
const MAX_EXPANDED_PLACEMENTS = 1_000_000;

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isInt = (value) => typeof value === "number" && Number.isInteger(value);
const isString = (value) => typeof value === "string";

function pathError(path, message) {
  return `${path}: ${message}`;
}

function expectObject(value, path, errors) {
  if (!isObject(value)) {
    errors.push(pathError(path, "객체여야 합니다"));
    return null;
  }
  return value;
}

function expectArray(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(pathError(path, "배열이어야 합니다"));
    return null;
  }
  return value;
}

function expectString(value, path, errors, allowEmpty = false) {
  if (!isString(value) || (!allowEmpty && value.length === 0)) {
    errors.push(
      pathError(path, allowEmpty ? "문자열이어야 합니다" : "비어 있지 않은 문자열이어야 합니다"),
    );
    return false;
  }
  return true;
}

function expectInt(value, path, errors) {
  if (!isInt(value)) {
    errors.push(pathError(path, "정수여야 합니다"));
    return false;
  }
  return true;
}

function expectPositiveInt(value, path, errors) {
  if (!expectInt(value, path, errors)) return false;
  if (value <= 0) {
    errors.push(pathError(path, "양의 정수여야 합니다"));
    return false;
  }
  return true;
}

function expectPoint(value, path, errors) {
  const items = expectArray(value, path, errors);
  if (!items) return null;
  if (items.length !== 2) {
    errors.push(pathError(path, "길이 2의 정수 좌표여야 합니다"));
    return null;
  }
  const ok = expectInt(items[0], `${path}[0]`, errors) && expectInt(items[1], `${path}[1]`, errors);
  return ok ? [items[0], items[1]] : null;
}

function expectRange(value, path, errors) {
  const point = expectPoint(value, path, errors);
  if (!point) return null;
  const [a, b] = point;
  if (a < 0) errors.push(pathError(path, "시작 인덱스는 0 이상이어야 합니다"));
  if (b <= a) errors.push(pathError(path, "빈 범위이거나 역방향 범위입니다"));
  return point;
}

function rejectUnknown(object, allowed, path, errors) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) {
      errors.push(pathError(`${path}.${key}`, "알 수 없는 필드입니다 (unknown field)"));
    }
  }
}

export function parseCodepoint(text) {
  if (typeof text !== "string") return null;
  const match = /^U\+([0-9A-Fa-f]+)$/.exec(text.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  if (value > 0x10ffff) return null;
  if (value >= 0xd800 && value <= 0xdfff) return null;
  return value;
}

export function formatCodepoint(codepoint) {
  return `U+${codepoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

export function normalizeAxis(axis, span) {
  return {
    count: axis.count,
    from_stride: axis.from_stride ?? 0,
    to_stride: axis.to_stride ?? span,
  };
}

export function expandAt(at) {
  const [a, b] = at.from;
  const span = b - a;
  const axes = (at.repeat ?? []).map((axis) => normalizeAxis(axis, span));
  const placements = [];
  const walk = (axisIndex, sourceShift, targetShift) => {
    if (axisIndex === axes.length) {
      for (let j = 0; j < span; j += 1) {
        placements.push([a + j + sourceShift, at.to + j + targetShift]);
      }
      return;
    }
    const axis = axes[axisIndex];
    for (let k = 0; k < axis.count; k += 1) {
      walk(
        axisIndex + 1,
        sourceShift + k * axis.from_stride,
        targetShift + k * axis.to_stride,
      );
    }
  };
  walk(0, 0, 0);
  return placements;
}

const placementCache = new WeakMap();

// Map target glyph index -> layer list in import/at/expansion order.
export function placementMap(doc, groupName) {
  let perDoc = placementCache.get(doc);
  if (!perDoc) {
    perDoc = new Map();
    placementCache.set(doc, perDoc);
  }
  if (perDoc.has(groupName)) return perDoc.get(groupName);

  const group = doc.groups[groupName];
  const result = new Map();
  if (!group) return result;
  for (let importIndex = 0; importIndex < (group.imports ?? []).length; importIndex += 1) {
    const imp = group.imports[importIndex];
    for (const at of imp.at ?? []) {
      for (const [source, target] of expandAt(at)) {
        const layers = result.get(target);
        const layer = { group: imp.group, index: source, importIndex };
        if (layers) layers.push(layer);
        else result.set(target, [layer]);
      }
    }
  }
  perDoc.set(groupName, result);
  return result;
}

export function placementsForImport(imp) {
  return (imp.at ?? []).flatMap((at) => expandAt(at));
}

export function children(doc, groupName) {
  const group = doc.groups[groupName];
  if (!group) return [];
  const byName = new Map();
  for (const imp of group.imports ?? []) {
    let entry = byName.get(imp.group);
    if (!entry) {
      entry = {
        name: imp.group,
        description: doc.groups[imp.group]?.description,
        importCount: 0,
        placementCount: 0,
      };
      byName.set(imp.group, entry);
    }
    entry.importCount += 1;
    entry.placementCount += placementsForImport(imp).length;
  }
  return [...byName.values()];
}

export function parents(doc, groupName) {
  const result = [];
  for (const [name, group] of Object.entries(doc.groups)) {
    let entry = null;
    for (const imp of group.imports ?? []) {
      if (imp.group !== groupName) continue;
      if (!entry) {
        entry = { name, description: group.description, importCount: 0, placementCount: 0 };
      }
      entry.importCount += 1;
      entry.placementCount += placementsForImport(imp).length;
    }
    if (entry) result.push(entry);
  }
  return result;
}

// All direct-parent target glyphs that can contain a layer from groupName.
export function affectedParentGlyphs(doc, groupName) {
  const result = [];
  for (const [name, group] of Object.entries(doc.groups)) {
    if (name === groupName) continue;
    const indices = new Set();
    for (const imp of group.imports ?? []) {
      if (imp.group !== groupName) continue;
      for (const [, target] of placementsForImport(imp)) indices.add(target);
    }
    if (indices.size) {
      result.push({ name, indices: [...indices].sort((a, b) => a - b) });
    }
  }
  return result;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function glyphFieldsChanged(beforeGroup, afterGroup) {
  if (!beforeGroup || !afterGroup) return true;
  return (
    canonical(beforeGroup.texture ?? null) !== canonical(afterGroup.texture ?? null) ||
    canonical(beforeGroup.size) !== canonical(afterGroup.size) ||
    beforeGroup.count !== afterGroup.count ||
    canonical(beforeGroup.imports ?? []) !== canonical(afterGroup.imports ?? [])
  );
}

// Target glyphs in the edited group whose composition may change.
export function changedOwnIndices(beforeDoc, afterDoc, groupName) {
  const beforeGroup = beforeDoc.groups[groupName];
  const afterGroup = afterDoc.groups[groupName];
  if (!beforeGroup || !afterGroup) return new Set();
  if (
    canonical(beforeGroup.texture ?? null) !== canonical(afterGroup.texture ?? null) ||
    canonical(beforeGroup.size) !== canonical(afterGroup.size) ||
    beforeGroup.count !== afterGroup.count
  ) {
    const count = Math.max(beforeGroup.count, afterGroup.count);
    return new Set(Array.from({ length: count }, (_, index) => index));
  }

  const changed = new Set();
  const beforeImports = beforeGroup.imports ?? [];
  const afterImports = afterGroup.imports ?? [];
  const importCount = Math.max(beforeImports.length, afterImports.length);
  for (let index = 0; index < importCount; index += 1) {
    const beforeImp = beforeImports[index];
    const afterImp = afterImports[index];
    if (canonical(beforeImp ?? null) === canonical(afterImp ?? null)) continue;
    if (beforeImp) {
      for (const [, target] of placementsForImport(beforeImp)) changed.add(target);
    }
    if (afterImp) {
      for (const [, target] of placementsForImport(afterImp)) changed.add(target);
    }
  }

  const beforeMap = placementMap(beforeDoc, groupName);
  const afterMap = placementMap(afterDoc, groupName);
  for (const index of new Set([...beforeMap.keys(), ...afterMap.keys()])) {
    if (canonical(beforeMap.get(index) ?? []) !== canonical(afterMap.get(index) ?? [])) {
      changed.add(index);
    }
  }
  return changed;
}

export function unicodeMap(doc) {
  const map = new Map();
  for (const [groupName, group] of Object.entries(doc.groups)) {
    for (const range of group.unicode ?? []) {
      const [a, b] = range.from;
      for (let offset = 0; offset < b - a; offset += 1) {
        const codepoint = parseCodepoint(range.to) + offset;
        map.set(codepoint, { group: groupName, index: a + offset });
      }
    }
  }
  return map;
}

export function searchDocument(doc, query, currentGroup) {
  const text = query.trim();
  if (!text || !doc) return [];

  const results = [];
  const seen = new Set();
  const add = (result) => {
    const key = `${result.kind}:${result.group}:${result.index ?? ""}`;
    if (seen.has(key) || results.length >= 100) return;
    seen.add(key);
    results.push(result);
  };

  const codepoint = parseCodepoint(text);
  if (codepoint !== null) {
    const hit = unicodeMap(doc).get(codepoint);
    if (hit) {
      add({
        kind: "glyph",
        group: hit.group,
        index: hit.index,
        label: `${formatCodepoint(codepoint)} ${String.fromCodePoint(codepoint)}`,
        detail: `${hit.group}[${hit.index}]`,
      });
    }
    return results;
  }

  const bracket = /^(.+)\[(\d+)\]$/.exec(text);
  if (bracket) {
    const group = doc.groups[bracket[1]];
    const index = Number(bracket[2]);
    if (group && index < group.count) {
      add({
        kind: "glyph",
        group: bracket[1],
        index,
        label: `${bracket[1]}[${index}]`,
        detail: "글리프",
      });
    }
  }

  const char = [...text].length === 1 ? text.codePointAt(0) : null;
  if (char !== null) {
    const hit = unicodeMap(doc).get(char);
    if (hit) {
      add({
        kind: "glyph",
        group: hit.group,
        index: hit.index,
        label: `${formatCodepoint(char)} ${text}`,
        detail: `${hit.group}[${hit.index}]`,
      });
    }
  }

  if (/^\d+$/.test(text)) {
    const index = Number(text);
    for (const [name, group] of Object.entries(doc.groups)) {
      if (index < group.count) {
        add({
          kind: "glyph",
          group: name,
          index,
          label: `${name}[${index}]`,
          detail: "로컬 인덱스",
        });
      }
    }
  }

  const lowered = text.toLowerCase();
  for (const [name, group] of Object.entries(doc.groups)) {
    if (name.toLowerCase().includes(lowered)) {
      add({
        kind: "group",
        group: name,
        label: name,
        detail: group.description?.trim() || "(no description)",
      });
    }
  }

  if (currentGroup && doc.groups[currentGroup]) {
    const chars = [...text];
    if (chars.length > 0) {
      for (const [cp, hit] of unicodeMap(doc)) {
        if (hit.group !== currentGroup) continue;
        if (!text.includes(String.fromCodePoint(cp))) continue;
        add({
          kind: "glyph",
          group: hit.group,
          index: hit.index,
          label: `${formatCodepoint(cp)} ${String.fromCodePoint(cp)}`,
          detail: `${hit.group}[${hit.index}]`,
        });
      }
    }
  }

  return results;
}

function validateTexture(value, path, errors) {
  const texture = expectObject(value, path, errors);
  if (!texture) return;
  rejectUnknown(texture, TEXTURE_FIELDS, path, errors);
  for (const field of ["set", "source", "start", "direction"]) {
    if (!(field in texture)) errors.push(pathError(path, `필수 필드 '${field}'가 없습니다`));
  }
  if ("set" in texture) expectString(texture.set, `${path}.set`, errors);
  if ("source" in texture) expectString(texture.source, `${path}.source`, errors);
  if ("start" in texture) expectPoint(texture.start, `${path}.start`, errors);
  if ("direction" in texture) {
    expectString(texture.direction, `${path}.direction`, errors);
    if (DIRECTIONS.includes(texture.direction)) {
      // valid
    } else if (isString(texture.direction)) {
      errors.push(pathError(`${path}.direction`, "right|left|down|up 중 하나여야 합니다"));
    }
  }
}

function validateAxis(value, path, span, errors) {
  const axis = expectObject(value, path, errors);
  if (!axis) return;
  rejectUnknown(axis, AXIS_FIELDS, path, errors);
  if (!("count" in axis)) errors.push(pathError(path, "필수 필드 'count'가 없습니다"));
  if ("count" in axis) expectPositiveInt(axis.count, `${path}.count`, errors);
  if ("from_stride" in axis) expectInt(axis.from_stride, `${path}.from_stride`, errors);
  if ("to_stride" in axis) expectInt(axis.to_stride, `${path}.to_stride`, errors);
  if (
    isInt(axis.count) &&
    axis.count > 0 &&
    (axis.from_stride === undefined || isInt(axis.from_stride)) &&
    (axis.to_stride === undefined || isInt(axis.to_stride))
  ) {
    const normalized = normalizeAxis(axis, span);
    const expanded = normalized.count * span;
    if (expanded > MAX_EXPANDED_PLACEMENTS) {
      errors.push(pathError(path, "반복 확장이 너무 큽니다"));
    }
  }
}

function validateAt(value, path, errors) {
  const at = expectObject(value, path, errors);
  if (!at) return;
  rejectUnknown(at, AT_FIELDS, path, errors);
  for (const field of ["from", "to"]) {
    if (!(field in at)) errors.push(pathError(path, `필수 필드 '${field}'가 없습니다`));
  }
  const range = "from" in at ? expectRange(at.from, `${path}.from`, errors) : null;
  if ("to" in at) {
    if (expectInt(at.to, `${path}.to`, errors) && at.to < 0) {
      errors.push(pathError(`${path}.to`, "0 이상이어야 합니다"));
    }
  }
  if ("repeat" in at) {
    const repeat = expectArray(at.repeat, `${path}.repeat`, errors);
    if (repeat) {
      const span = range ? range[1] - range[0] : 1;
      repeat.forEach((axis, index) => validateAxis(axis, `${path}.repeat[${index}]`, span, errors));
    }
  }
  return range && range[1] > range[0] ? range[1] - range[0] : null;
}

function validateImport(value, path, errors) {
  const imp = expectObject(value, path, errors);
  if (!imp) return;
  rejectUnknown(imp, IMPORT_FIELDS, path, errors);
  for (const field of ["group", "offset", "at"]) {
    if (!(field in imp)) errors.push(pathError(path, `필수 필드 '${field}'가 없습니다`));
  }
  if ("group" in imp) expectString(imp.group, `${path}.group`, errors);
  if ("offset" in imp) expectPoint(imp.offset, `${path}.offset`, errors);
  if ("at" in imp) {
    const ats = expectArray(imp.at, `${path}.at`, errors);
    if (ats) ats.forEach((at, index) => validateAt(at, `${path}.at[${index}]`, errors));
  }
}

function validateUnicode(value, path, errors) {
  const range = expectObject(value, path, errors);
  if (!range) return null;
  rejectUnknown(range, UNICODE_FIELDS, path, errors);
  for (const field of ["from", "to"]) {
    if (!(field in range)) errors.push(pathError(path, `필수 필드 '${field}'가 없습니다`));
  }
  const span = "from" in range ? expectRange(range.from, `${path}.from`, errors) : null;
  let start = null;
  if ("to" in range) {
    start = parseCodepoint(range.to);
    if (start === null) {
      errors.push(pathError(`${path}.to`, "U+XXXX 형식의 유효한 코드 포인트여야 합니다"));
    }
  }
  if (span && start !== null) {
    const last = start + span[1] - span[0] - 1;
    if (last > 0x10ffff) {
      errors.push(pathError(path, "유니코드 범위를 벗어났습니다"));
    } else if (start <= 0xdfff && last >= 0xd800) {
      errors.push(pathError(path, "서로게이트를 포함한 범위입니다"));
    }
  }
  return span && start !== null ? { a: span[0], b: span[1], start } : null;
}

function validateTextureSets(value, errors) {
  const sets = expectObject(value, "$.texture_sets", errors);
  if (!sets) return;
  for (const [setName, sources] of Object.entries(sets)) {
    expectString(setName, "$.texture_sets.<name>", errors);
    const path = `$.texture_sets.${setName}`;
    const members = expectObject(sources, path, errors);
    if (!members) continue;
    for (const [sourceName, imagePath] of Object.entries(members)) {
      expectString(sourceName, `${path}.<name>`, errors);
      expectString(imagePath, `${path}.${sourceName}`, errors);
    }
  }
}

export function validateDocument(doc) {
  const errors = [];
  const root = expectObject(doc, "$", errors);
  if (!root) return errors;
  rejectUnknown(root, new Set(["metadata", "texture_sets", "groups"]), "$", errors);

  if ("metadata" in root) {
    const metadata = expectObject(root.metadata, "$.metadata", errors);
    if (metadata) {
      for (const key of ["name", "version", "author"]) {
        if (key in metadata && !isString(metadata[key])) {
          errors.push(pathError(`$.metadata.${key}`, "문자열이어야 합니다"));
        }
      }
    }
  }

  if ("texture_sets" in root) validateTextureSets(root.texture_sets, errors);

  if (!("groups" in root)) {
    errors.push(pathError("$", "필수 필드 'groups'가 없습니다"));
    return errors;
  }
  const groups = expectObject(root.groups, "$.groups", errors);
  if (!groups) return errors;

  const parsed = new Map();
  for (const [name, value] of Object.entries(groups)) {
    const path = `groups.${name}`;
    expectString(name, "groups.<name>", errors);
    const group = expectObject(value, path, errors);
    if (!group) continue;
    rejectUnknown(group, GROUP_FIELDS, path, errors);
    for (const field of ["size", "count"]) {
      if (!(field in group)) errors.push(pathError(path, `필수 필드 '${field}'가 없습니다`));
    }
    let size = null;
    let count = null;
    if ("size" in group) {
      size = expectPoint(group.size, `${path}.size`, errors);
      if (size && (size[0] <= 0 || size[1] <= 0)) {
        errors.push(pathError(`${path}.size`, "양의 정수 크기여야 합니다"));
      }
    }
    if ("count" in group && expectPositiveInt(group.count, `${path}.count`, errors)) {
      count = group.count;
    }
    if ("description" in group) {
      expectString(group.description, `${path}.description`, errors, true);
    }
    if ("texture" in group) validateTexture(group.texture, `${path}.texture`, errors);
    if ("imports" in group) {
      const imports = expectArray(group.imports, `${path}.imports`, errors);
      if (imports) imports.forEach((imp, index) => validateImport(imp, `${path}.imports[${index}]`, errors));
    }
    const unicodeRanges = [];
    if ("unicode" in group) {
      const ranges = expectArray(group.unicode, `${path}.unicode`, errors);
      if (ranges) {
        ranges.forEach((range, index) => {
          const parsedRange = validateUnicode(range, `${path}.unicode[${index}]`, errors);
          if (parsedRange) unicodeRanges.push(parsedRange);
        });
      }
    }
    parsed.set(name, { group, size, count, unicodeRanges });
  }

  // Texture references.
  const sets = isObject(root.texture_sets) ? root.texture_sets : {};
  for (const [name, entry] of parsed) {
    const texture = entry.group.texture;
    if (!isObject(texture)) continue;
    const sources = isObject(sets[texture.set]) ? sets[texture.set] : null;
    if (!sources) {
      errors.push(
        pathError(`groups.${name}.texture.set`, `존재하지 않는 텍스처셋입니다: ${JSON.stringify(texture.set)}`),
      );
    } else if (isString(texture.source) && !(texture.source in sources)) {
      errors.push(
        pathError(
          `groups.${name}.texture.source`,
          `텍스처셋 ${JSON.stringify(texture.set)}에 없는 소스입니다: ${JSON.stringify(texture.source)}`,
        ),
      );
    }
  }

  // Import references and expanded index bounds.
  for (const [name, entry] of parsed) {
    const group = entry.group;
    if (!Array.isArray(group.imports)) continue;
    group.imports.forEach((imp, importIndex) => {
      if (!isObject(imp)) return;
      const path = `groups.${name}.imports[${importIndex}]`;
      const child = parsed.get(imp.group);
      if (!child) {
        if (isString(imp.group)) {
          errors.push(pathError(`${path}.group`, `존재하지 않는 그룹입니다: ${JSON.stringify(imp.group)}`));
        }
        return;
      }
      if (!Array.isArray(imp.at)) return;
      imp.at.forEach((at, atIndex) => {
        if (!isObject(at) || !Array.isArray(at.from) || at.from.length !== 2) return;
        const [a, b] = at.from;
        if (!isInt(a) || !isInt(b) || a < 0 || b <= a || !isInt(at.to)) return;
        if (child.count !== null && b > child.count) {
          errors.push(
            pathError(`${path}.at[${atIndex}].from`, `원본 그룹 ${JSON.stringify(imp.group)}의 인덱스 범위를 벗어났습니다`),
          );
          return;
        }
        if (!Array.isArray(at.repeat)) {
          for (let j = 0; j < b - a; j += 1) {
            const source = a + j;
            const target = at.to + j;
            if (child.count !== null && !(0 <= source && source < child.count)) {
              errors.push(pathError(`${path}.at[${atIndex}]`, `반복을 편 원본 인덱스 ${source}가 그룹 ${JSON.stringify(imp.group)}의 범위를 벗어났습니다`));
            }
            if (entry.count !== null && !(0 <= target && target < entry.count)) {
              errors.push(pathError(`${path}.at[${atIndex}]`, `반복을 편 대상 인덱스 ${target}가 그룹 ${name}의 범위를 벗어났습니다`));
            }
          }
          return;
        }
        // Validate with the same expansion the renderer uses, but never
        // materialize an unbounded repetition from a malformed edit.
        let expandedSize = b - a;
        for (const axis of at.repeat) {
          if (isObject(axis) && isInt(axis.count) && axis.count > 0) {
            expandedSize *= axis.count;
          } else {
            expandedSize = Infinity;
            break;
          }
        }
        if (expandedSize > MAX_EXPANDED_PLACEMENTS) {
          errors.push(pathError(`${path}.at[${atIndex}]`, "반복 확장이 너무 큽니다"));
          return;
        }
        let placements;
        try {
          placements = expandAt(at);
        } catch {
          return;
        }
        for (const [source, target] of placements) {
          if (child.count !== null && !(0 <= source && source < child.count)) {
            errors.push(pathError(`${path}.at[${atIndex}]`, `반복을 편 원본 인덱스 ${source}가 그룹 ${JSON.stringify(imp.group)}의 범위를 벗어났습니다`));
            break;
          }
          if (entry.count !== null && !(0 <= target && target < entry.count)) {
            errors.push(pathError(`${path}.at[${atIndex}]`, `반복을 편 대상 인덱스 ${target}가 그룹 ${name}의 범위를 벗어났습니다`));
            break;
          }
        }
      });
    });
  }

  // Cycles.
  const state = new Map();
  const visit = (name, trail) => {
    const marker = state.get(name) ?? 0;
    if (marker === 1) {
      const cycle = [...trail.slice(trail.indexOf(name)), name];
      errors.push(`임포트 순환 참조입니다: ${cycle.join(" -> ")}`);
      return;
    }
    if (marker === 2) return;
    state.set(name, 1);
    trail.push(name);
    const group = groups[name];
    if (isObject(group) && Array.isArray(group.imports)) {
      for (const imp of group.imports) {
        if (isObject(imp) && isString(imp.group) && groups[imp.group]) {
          visit(imp.group, trail);
        }
      }
    }
    trail.pop();
    state.set(name, 2);
  };
  for (const name of Object.keys(groups)) visit(name, []);

  // Unicode ranges and collisions.
  const assigned = new Map();
  for (const [name, entry] of parsed) {
    const count = entry.count;
    for (const range of entry.unicodeRanges) {
      if (count !== null && range.b > count) {
        errors.push(pathError(`groups.${name}.unicode`, `그룹 인덱스 범위를 벗어났습니다 (count=${count})`));
        continue;
      }
      for (let offset = 0; offset < range.b - range.a; offset += 1) {
        const codepoint = range.start + offset;
        const localIndex = range.a + offset;
        const previous = assigned.get(codepoint);
        if (!previous) {
          assigned.set(codepoint, { group: name, index: localIndex });
        } else if (previous.group !== name || previous.index !== localIndex) {
          errors.push(
            pathError(
              `groups.${name}.unicode`,
              `${formatCodepoint(codepoint)} 충돌: ${previous.group}[${previous.index}]와 ${name}[${localIndex}]`,
            ),
          );
        }
      }
    }
  }

  return errors;
}

export function parseDocument(text) {
  let doc;
  try {
    doc = JSON.parse(text.replace(/^\ufeff/, ""));
  } catch (error) {
    return { doc: null, errors: [`JSON 파싱 실패: ${error.message}`] };
  }
  return { doc, errors: validateDocument(doc) };
}

export function serializeDocument(doc) {
  const errors = validateDocument(doc);
  if (errors.length) {
    const error = new Error(errors.join("\n"));
    error.validationErrors = errors;
    throw error;
  }
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function groupNames(doc) {
  return doc ? Object.keys(doc.groups) : [];
}
