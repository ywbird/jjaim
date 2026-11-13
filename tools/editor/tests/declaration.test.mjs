import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { codepointLabel, findGroupGlyphByText, parseDeclaration } from "../src/declaration.js";

const example = (name) => readFileSync(new URL(`../../../examples/${name}`, import.meta.url), "utf8");

test("parses the example declarations and their mappings", () => {
  const hangul = parseDeclaration(example("hangul.json"));
  const ascii = parseDeclaration(example("ascii.json"));
  assert.equal(hangul.groups.size, 23);
  assert.equal(ascii.groups.size, 6);
  assert.equal(hangul.unicodeMap.size, 11172 + 95);
  assert.equal(ascii.unicodeMap.size, 95);
  assert.deepEqual(hangul.unicodeMap.get(0xac00), { group: "hangul_syllables", index: 0 });
  assert.equal(codepointLabel(0xac00), "U+AC00");
});

test("strict JSON rejects duplicates, unknown fields, and bad types", () => {
  const base = (groups) => JSON.stringify({ groups });
  assert.throws(() => parseDeclaration('{"groups":{},"groups":{}}'), /중복 키/);
  assert.throws(() => parseDeclaration(base({ a: { size: [1, 1], count: 1, extra: 1 } })), /알 수 없는 필드/);
  assert.throws(() => parseDeclaration(base({ a: { size: [1, 1], count: true } })), /정수/);
  assert.throws(() => parseDeclaration(base({ a: { size: [1, 1], count: "2" } })), /정수/);
  assert.throws(() => parseDeclaration('{"groups":{"a":{"size":[1,1],"count":NaN}}}'), /JSON/);
  assert.equal(parseDeclaration('{"groups":{"__proto__":{"size":[1,1],"count":1}}}').groups.has("__proto__"), true);
});

test("accepts a UTF-8 BOM without changing the stored declaration text", () => {
  const text = '{"groups":{"a":{"size":[1,1],"count":1}}}';
  const declaration = parseDeclaration(`\uFEFF${text}`);
  assert.equal(declaration.text, `\uFEFF${text}`);
  assert.equal(declaration.groups.get("a").count, 1);
});

test("accepts U+0000 and non-BMP codepoints without UTF-16 splitting", () => {
  const declaration = parseDeclaration(
    JSON.stringify({
      groups: {
        g: {
          size: [1, 1],
          count: 3,
          unicode: [
            { from: [0, 1], to: "U+0000" },
            { from: [1, 2], to: "U+1F600" },
          ],
        },
      },
    }),
  );
  assert.deepEqual(declaration.unicodeMap.get(0), { group: "g", index: 0 });
  assert.deepEqual(declaration.unicodeMap.get(0x1f600), { group: "g", index: 1 });
  assert.equal(findGroupGlyphByText(declaration, "U+0000").index, 0);
  assert.equal(findGroupGlyphByText(declaration, "0x1f600").index, 1);
  assert.equal(findGroupGlyphByText(declaration, "g[2]").group, "g");
});

test("rejects cycles, invalid references, and escaped repeats", () => {
  const decl = (groups) => JSON.stringify({ groups });
  assert.throws(
    () =>
      parseDeclaration(
        decl({
          a: { size: [1, 1], count: 1, imports: [{ group: "b", offset: [0, 0], at: [{ from: [0, 1], to: 0 }] }] },
          b: { size: [1, 1], count: 1, imports: [{ group: "a", offset: [0, 0], at: [{ from: [0, 1], to: 0 }] }] },
        }),
      ),
    /순환/,
  );
  assert.throws(
    () => parseDeclaration(decl({ a: { size: [1, 1], count: 1, imports: [{ group: "x", offset: [0, 0], at: [] }] } })),
    /존재하지 않는 그룹/,
  );
  assert.throws(
    () =>
      parseDeclaration(
        decl({
          a: { size: [1, 1], count: 1, imports: [{ group: "b", offset: [0, 0], at: [{ from: [0, 1], to: 0, repeat: [{ count: 2, to_stride: 1 }] }] }] },
          b: { size: [1, 1], count: 1 },
        }),
      ),
    /범위/,
  );
});

const NO_FINAL_INITIAL = {
  0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 20: 0,
  8: 1, 12: 1, 18: 1,
  13: 2, 17: 2,
  9: 3, 10: 3, 11: 3, 19: 3,
  14: 4, 15: 4, 16: 4,
};
const WITH_FINAL_INITIAL = {
  0: 5, 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5, 7: 5, 20: 5,
  8: 6, 12: 6, 13: 6, 17: 6, 18: 6,
  9: 7, 10: 7, 11: 7, 14: 7, 15: 7, 16: 7, 19: 7,
};
const FINAL_BATCH = {
  0: 0, 2: 0, 9: 0,
  4: 1, 6: 1, 11: 1, 14: 1, 16: 1, 19: 1, 20: 1,
  1: 2, 3: 2, 5: 2, 7: 2, 10: 2, 15: 2,
  8: 3, 12: 3, 13: 3, 17: 3, 18: 3,
};

function expectedGroups(codepoint) {
  const index = codepoint - 0xac00;
  const [lead, rest] = [Math.floor(index / 588), index % 588];
  const [vowel, tail] = [Math.floor(rest / 28), rest % 28];
  const names = ["hangul_syllables"];
  if (tail === 0) {
    names.push(`initial_${NO_FINAL_INITIAL[vowel]}`, `medial_${lead === 0 || lead === 15 ? 0 : 1}`);
  } else {
    names.push(
      `initial_${WITH_FINAL_INITIAL[vowel]}`,
      `medial_${lead === 0 || lead === 15 ? 2 : 3}`,
      `final_${FINAL_BATCH[vowel]}`,
    );
  }
  return names;
}

test("full hangul example matches an independent 8x4x4 classification", () => {
  const declaration = parseDeclaration(example("hangul.json"));
  for (let codepoint = 0xac00; codepoint <= 0xd7a3; codepoint += 1) {
    const target = declaration.unicodeMap.get(codepoint);
    assert.deepEqual(target, { group: "hangul_syllables", index: codepoint - 0xac00 });
    assert.deepEqual(declaration.participating(target.group, target.index), expectedGroups(codepoint), `U+${codepoint.toString(16).toUpperCase()}`);
  }
});

test("repeat order is outer axis first and inner index last", () => {
  const declaration = parseDeclaration(
    JSON.stringify({
      groups: {
        child: { size: [1, 1], count: 12 },
        parent: {
          size: [1, 1],
          count: 12,
          imports: [
            {
              group: "child",
              offset: [0, 0],
              at: [{ from: [0, 2], to: 0, repeat: [{ count: 2, to_stride: 6 }, { count: 3, to_stride: 2 }] }],
            },
          ],
        },
      },
    }),
  );
  const targets = [...declaration.placement("parent").entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([target, items]) => [target, items[0].childIndex]);
  assert.deepEqual(targets, [
    [0, 0],
    [1, 1],
    [2, 0],
    [3, 1],
    [4, 0],
    [5, 1],
    [6, 0],
    [7, 1],
    [8, 0],
    [9, 1],
    [10, 0],
    [11, 1],
  ]);
});

test("rejects compressed repeats before materializing them", () => {
  const declaration = {
    groups: {
      child: { size: [1, 1], count: 1_000_000 },
      parent: {
        size: [1, 1],
        count: 1,
        imports: [
          {
            group: "child",
            offset: [0, 0],
            at: [{ from: [0, 1], to: 0, repeat: [{ count: 3 }, { count: 1_000_000 }] }],
          },
        ],
      },
    },
  };
  assert.throws(() => parseDeclaration(JSON.stringify(declaration)), /한도|범위/);
});
