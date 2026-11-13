import KSX1001 from "./data/ksx1001.js";

export const PAGE_SIZES = [64, 128, 256];

function range(from, to) {
  const out = [];
  for (let cp = from; cp <= to; cp += 1) out.push(cp);
  return out;
}

export const BUILT_IN_SETS = [
  { id: "current", name: "현재 선언의 문자", fixed: null },
  { id: "ascii", name: "ASCII", fixed: range(0x20, 0x7e) },
  { id: "latin1", name: "Latin-1 Supplement", fixed: range(0x80, 0xff) },
  { id: "hangul-compat", name: "한글 호환 자모", fixed: range(0x3130, 0x318f) },
  { id: "hangul-syllables", name: "한글 완성형", fixed: range(0xac00, 0xd7a3) },
  { id: "ksx1001", name: "KS X 1001 한글", fixed: KSX1001 },
  { id: "arrows", name: "화살표", fixed: range(0x2190, 0x21ff) },
  { id: "currency", name: "통화 기호", fixed: range(0x20a0, 0x20cf) },
];

export function codepointLabel(cp) {
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

export function charactersForSet(id, declaration) {
  const set = BUILT_IN_SETS.find((item) => item.id === id) ?? BUILT_IN_SETS[0];
  if (set.id === "current") return [...declaration.unicodeMap.keys()].sort((a, b) => a - b);
  return set.fixed;
}

export function mappedCharacters(declaration, codepoints) {
  return codepoints.filter((cp) => declaration.unicodeMap.has(cp));
}

export function discoverSets(declaration) {
  return BUILT_IN_SETS.map((set) => {
    const all = charactersForSet(set.id, declaration);
    const mapped = set.id === "current" ? all.length : mappedCharacters(declaration, all).length;
    return { ...set, all: all.length, mapped };
  });
}

export function paginate(items, requestedPage = 0, pageSize = 128) {
  const size = PAGE_SIZES.includes(pageSize) ? pageSize : 128;
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const page = Math.max(0, Math.min(pageCount - 1, Number.isInteger(requestedPage) ? requestedPage : 0));
  const start = page * size;
  return {
    items: items.slice(start, start + size),
    page,
    pageCount,
    pageSize: size,
    total,
    start,
    end: Math.min(total, start + size),
  };
}

export function splitScalars(text) {
  const out = [];
  const seen = new Set();
  for (const character of String(text)) {
    const cp = character.codePointAt(0);
    if (!seen.has(cp)) {
      seen.add(cp);
      out.push(cp);
    }
  }
  return out;
}

export function filterCharacters(codepoints, query) {
  if (!query) return codepoints;
  const querySet = new Set(splitScalars(query));
  if (querySet.size === 0) return codepoints;
  return codepoints.filter((cp) => querySet.has(cp));
}

export function characterDisplay(cp) {
  if (cp === 0) return "NUL";
  if (cp === 0x20) return "SPACE";
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return "제어 문자";
  return String.fromCodePoint(cp);
}

export function isBlankCharacter(cp) {
  return cp < 0x21 || (cp >= 0x7f && cp <= 0xa0) || /\s/u.test(String.fromCodePoint(cp));
}
