import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  affectedParentGlyphs,
  changedOwnIndices,
  children,
  expandAt,
  formatCodepoint,
  parseDocument,
  parents,
  placementMap,
  searchDocument,
  serializeDocument,
  unicodeMap,
  validateDocument,
} from "./model.js";

const read = (name) =>
  readFileSync(new URL(`../../../examples/${name}`, import.meta.url), "utf8");

const hangul = parseDocument(read("hangul.json"));
const ascii = parseDocument(read("ascii.json"));

test("existing example declarations parse without errors", () => {
  assert.deepEqual(hangul.errors, []);
  assert.deepEqual(ascii.errors, []);
  assert.equal(Object.keys(hangul.doc.groups).length, 23);
  assert.equal(Object.keys(ascii.doc.groups).length, 6);
});

test("unicode maps cover all Hangul syllables and printable ASCII", () => {
  assert.equal(unicodeMap(hangul.doc).size, 11172 + 95);
  assert.equal(unicodeMap(ascii.doc).size, 95);
  assert.deepEqual(unicodeMap(hangul.doc).get(0xac00), {
    group: "hangul_syllables",
    index: 0,
  });
  assert.deepEqual(unicodeMap(hangul.doc).get(0x7e), {
    group: "ascii_70",
    index: 14,
  });
});

test("expandAt applies defaults and nested repetition", () => {
  assert.deepEqual(expandAt({ from: [0, 3], to: 5 }), [
    [0, 5],
    [1, 6],
    [2, 7],
  ]);
  assert.deepEqual(
    expandAt({
      from: [0, 3],
      to: 0,
      repeat: [
        { count: 2, from_stride: 3, to_stride: 6 },
        { count: 2, to_stride: 3 },
      ],
    }),
    [
      [0, 0],
      [1, 1],
      [2, 2],
      [0, 3],
      [1, 4],
      [2, 5],
      [3, 6],
      [4, 7],
      [5, 8],
      [3, 9],
      [4, 10],
      [5, 11],
    ],
  );
});

test("child and parent queries use expanded placements", () => {
  const initial = children(hangul.doc, "hangul_syllables").find(
    (entry) => entry.name === "initial_0",
  );
  assert.deepEqual(initial, {
    name: "initial_0",
    description:
      "Initial consonants without a final, for medials ㅏㅐㅑㅒㅓㅔㅕㅖㅣ.",
    importCount: 1,
    placementCount: 171,
  });
  assert.equal(children(hangul.doc, "hangul_syllables").length, 16);
  assert.deepEqual(
    parents(hangul.doc, "initial_0").map((entry) => entry.name),
    ["hangul_syllables"],
  );
  assert.equal(placementMap(hangul.doc, "initial_0").size, 0);
});

test("affected parent glyphs are direct targets of the child group", () => {
  const affected = affectedParentGlyphs(hangul.doc, "initial_0");
  assert.equal(affected.length, 1);
  assert.equal(affected[0].name, "hangul_syllables");
  assert.equal(affected[0].indices.length, 171);
  assert.deepEqual(affectedParentGlyphs(hangul.doc, "ascii_20"), []);
});

test("changedOwnIndices distinguishes description-only edits", () => {
  const descriptionOnly = structuredClone(hangul.doc);
  descriptionOnly.groups.initial_0.description = "changed";
  assert.equal(changedOwnIndices(hangul.doc, descriptionOnly, "initial_0").size, 0);

  const moved = structuredClone(hangul.doc);
  moved.groups.hangul_syllables.imports[0].offset = [1, 0];
  const changed = changedOwnIndices(hangul.doc, moved, "hangul_syllables");
  assert.equal(changed.size, 171);
  assert.ok(changed.has(0));
});

test("validation rejects cycles, out-of-range repeats, and duplicates", () => {
  const cycle = structuredClone(ascii.doc);
  cycle.groups.ascii_20.imports = [
    { group: "ascii_70", offset: [0, 0], at: [{ from: [0, 1], to: 0 }] },
  ];
  cycle.groups.ascii_70.imports = [
    { group: "ascii_20", offset: [0, 0], at: [{ from: [0, 1], to: 0 }] },
  ];
  assert.ok(validateDocument(cycle).some((error) => error.includes("순환 참조")));

  const outOfRange = structuredClone(ascii.doc);
  outOfRange.groups.ascii_20.imports = [
    { group: "ascii_30", offset: [0, 0], at: [{ from: [0, 17], to: 0 }] },
  ];
  assert.ok(
    validateDocument(outOfRange).some((error) => error.includes("인덱스 범위를 벗어났습니다")),
  );

  const duplicate = structuredClone(ascii.doc);
  duplicate.groups.ascii_20.unicode = [{ from: [0, 1], to: "U+0030" }];
  assert.ok(validateDocument(duplicate).some((error) => error.includes("충돌")));

  const unknown = structuredClone(ascii.doc);
  unknown.groups.ascii_20.paint = true;
  assert.ok(validateDocument(unknown).some((error) => error.includes("알 수 없는 필드")));
});

test("search finds groups, codepoints, characters, and local indices", () => {
  assert.deepEqual(
    searchDocument(hangul.doc, "U+AC00").map((hit) => [hit.group, hit.index]),
    [["hangul_syllables", 0]],
  );
  assert.equal(searchDocument(hangul.doc, "가")[0].group, "hangul_syllables");
  assert.equal(
    searchDocument(hangul.doc, "ascii_20")[0].detail,
    hangul.doc.groups.ascii_20.description,
  );
  assert.equal(searchDocument(hangul.doc, "ascii_20[3]")[0].index, 3);
  assert.equal(formatCodepoint(0xac00), "U+AC00");
});

test("serialization round-trips the example document", () => {
  const text = serializeDocument(hangul.doc);
  assert.deepEqual(JSON.parse(text), hangul.doc);
  assert.equal(parseDocument(text).errors.length, 0);
});

test("huge ranges fail fast without materializing repetitions", () => {
  const huge = structuredClone(ascii.doc);
  huge.groups.ascii_20.imports = [
    { group: "ascii_30", offset: [0, 0], at: [{ from: [0, 999999], to: 0 }] },
  ];
  const errors = validateDocument(huge);
  assert.ok(errors.some((error) => error.includes("인덱스 범위를 벗어났습니다")));

  const repeated = structuredClone(ascii.doc);
  repeated.groups.ascii_20.imports = [
    {
      group: "ascii_30",
      offset: [0, 0],
      at: [
        {
          from: [0, 1],
          to: 0,
          repeat: [{ count: 2_000_000, to_stride: 1 }],
        },
      ],
    },
  ];
  assert.ok(validateDocument(repeated).some((error) => error.includes("반복 확장이 너무 큽니다")));
});
