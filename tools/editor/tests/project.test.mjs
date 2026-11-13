import assert from "node:assert/strict";
import test from "node:test";
import { AssetStore } from "../src/assets.js";
import { parseDeclaration } from "../src/declaration.js";
import { History } from "../src/history.js";
import { encodePng } from "../src/png.js";
import { exportProject, importProject, safeProjectName } from "../src/project.js";
import { makeZip, readZip } from "../src/zip.js";

function makeWorkspace() {
  const text = JSON.stringify({
    metadata: { name: "Fixture" },
    texture_sets: { main: { sheet: "sheet.png" } },
    groups: {
      chars: {
        size: [2, 1],
        count: 1,
        texture: { set: "main", source: "sheet", start: [0, 0], direction: "right" },
        unicode: [{ from: [0, 1], to: "U+0041" }],
      },
    },
  });
  const declaration = parseDeclaration(text, { fileName: "fixture.json" });
  const assets = new AssetStore();
  assets.bind("sheet.png", {
    width: 2,
    height: 1,
    data: Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 255]),
  });
  const history = new History(assets);
  const first = history.commit(new Map([["sheet.png", [{
    x: 0,
    y: 0,
    before: [0, 0, 0, 0],
    after: [0, 0, 0, 255],
  }]]]), { kind: "pixels" });
  history.undo();
  const second = history.commit(new Map([["sheet.png", [{
    x: 1,
    y: 0,
    before: [0, 0, 0, 255],
    after: [255, 0, 0, 255],
  }]]]), { kind: "pixels" });
  return {
    name: "Proj",
    fileName: "fixture.json",
    declaration,
    assets,
    history,
    view: { zoom: 8, selected: { group: "chars", index: 0, codepoint: 0x41 } },
    shadowPresets: [{ name: "English", size: 24, x: 2, y: -1, opacity: 0.4 }],
    first,
    second,
  };
}

test("project export stores current PNGs with declaration and history", async () => {
  const workspace = makeWorkspace();
  const result = await exportProject(workspace);
  assert.equal(result.name, "Proj.jjaim");
  const zip = await readZip(result.bytes, { keepNonPng: true });
  assert.deepEqual(zip.entries.map((entry) => entry.name).sort(), ["project.json", "textures/sheet.png"]);
  const raw = JSON.parse(new TextDecoder().decode(zip.entries.find((entry) => entry.name === "project.json").data));
  assert.equal(raw.format, "dgc-texture-project");
  assert.equal(raw.declaration, workspace.declaration.text);
  assert.equal(raw.history.headId, workspace.history.headId);
  assert.deepEqual(raw.shadowPresets, workspace.shadowPresets);
});

test("project import restores current pixels, original pixels, branches, and view", async () => {
  const workspace = makeWorkspace();
  const result = await exportProject(workspace);
  const imported = await importProject(result.bytes);
  assert.equal(imported.name, "Proj");
  assert.equal(imported.fileName, "fixture.json");
  assert.equal(imported.declaration.unicodeMap.get(0x41).group, "chars");
  assert.deepEqual([...imported.assets.get("sheet.png").original], [0, 0, 0, 0, 0, 0, 0, 255]);
  assert.deepEqual([...imported.assets.get("sheet.png").current], [0, 0, 0, 0, 255, 0, 0, 255]);
  assert.equal(imported.history.headId, workspace.history.headId);
  assert.equal(imported.history.revisions.size, 3);
  assert.deepEqual([...imported.history.stateAt(workspace.first.id).get("sheet.png")], [0, 0, 0, 255, 0, 0, 0, 255]);
  assert.deepEqual([...imported.history.stateAt(workspace.second.id).get("sheet.png")], [0, 0, 0, 0, 255, 0, 0, 255]);
  assert.equal(imported.view.zoom, 8);
  assert.deepEqual(imported.view.selected, { group: "chars", index: 0, codepoint: 0x41 });
  assert.deepEqual(imported.shadowPresets, workspace.shadowPresets);
});

test("project import rejects a ZIP without project.json or with wrong metadata", async () => {
  const png = await encodePng({ width: 2, height: 1, data: Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 255]) });
  await assert.rejects(importProject(await makeZip([{ name: "textures/sheet.png", data: png }])), /project\.json/);

  const result = await exportProject(makeWorkspace());
  const zip = await readZip(result.bytes, { keepNonPng: true });
  const raw = JSON.parse(new TextDecoder().decode(zip.entries.find((entry) => entry.name === "project.json").data));
  raw.assets[0].width = 99;
  const entries = zip.entries.map((entry) => entry.name === "project.json"
    ? { name: entry.name, data: new TextEncoder().encode(JSON.stringify(raw)) }
    : entry);
  await assert.rejects(importProject(await makeZip(entries)), /크기가 metadata와 다릅니다/);
});

test("project name keeps the .jjaim extension and strips an unsafe name", () => {
  assert.equal(safeProjectName("내 프로젝트"), "내 프로젝트.jjaim");
  assert.equal(safeProjectName("a/b:c"), "a-b-c.jjaim");
  assert.equal(safeProjectName(""), "project.jjaim");
});
