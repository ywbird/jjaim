import assert from "node:assert/strict";
import { once } from "node:events";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { decodePng, encodePng } from "../src/png.js";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const EDITOR_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const CHROMIUM = process.env.CHROMIUM_PATH || "/usr/sbin/chromium";
const FONT = process.env.FONT_PATH || "/usr/share/fonts/TTF/MonoidNerdFont-Regular.ttf";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function serve(root) {
  const server = createServer((request, response) => {
    let pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const file = normalize(join(root, pathname));
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(response);
  });
  return server;
}

async function waitDownload(directory, name) {
  const file = join(directory, name);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (existsSync(file) && statSync(file).size > 0 && !existsSync(`${file}.crdownload`)) return file;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error(`다운로드를 찾지 못했습니다: ${file}`);
}

const temp = mkdtempSync(join(tmpdir(), "glyph-editor-browser-"));
const downloadDir = join(temp, "downloads");
const declarationPath = join(temp, "browser.json");
const pngPath = join(temp, "sheet.png");
const smallDir = join(temp, "small");
mkdirSync(smallDir);
const smallPngPath = join(smallDir, "sheet.png");
writeFileSync(
  declarationPath,
  JSON.stringify({
    metadata: { name: "Browser" },
    texture_sets: { main: { sheet: "sheet.png", blank: "blank.png" } },
    groups: {
      chars: {
        size: [2, 1],
        count: 1,
        texture: { set: "main", source: "sheet", start: [0, 0], direction: "right" },
        unicode: [{ from: [0, 1], to: "U+0041" }],
      },
      spare: {
        size: [1, 1],
        count: 1,
        texture: { set: "main", source: "blank", start: [0, 0], direction: "right" },
      },
    },
  }),
);
writeFileSync(
  pngPath,
  await encodePng({
    width: 2,
    height: 1,
    data: Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 255]),
  }),
);
writeFileSync(smallPngPath, await encodePng({ width: 1, height: 1, data: Uint8Array.from([0, 0, 0, 255]) }));

const server = serve(REPO_ROOT);
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}/tools/editor/`;
const externalRequests = [];
let browser = null;

try {
  browser = await puppeteer.launch({
    executablePath: CHROMIUM,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const origin = new URL(base).origin;
  page.on("request", (request) => {
    const url = request.url();
    if (/^https?:/i.test(url) && new URL(url).origin !== origin) externalRequests.push(url);
  });
  const client = await page.createCDPSession();
  await client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir });
  await page.goto(base, { waitUntil: "networkidle0" });
  assert.equal(await page.title(), "JJaim 텍스쳐 편집기");
  assert.equal(await page.$eval('script[src="src/app.js"]', (node, prefix) => node.src.startsWith(prefix), base), true);
  await page.waitForSelector("#empty-state", { visible: true });
  assert.equal(await page.$eval("#editor", (node) => node.hidden), true);

  await page.setOfflineMode(true);

  await (await page.$("#declaration-file")).uploadFile(declarationPath);
  await page.waitForFunction(() => window.__editor?.state.workspace?.fileName === "browser.json");
  assert.equal(await page.evaluate(() => window.__editor.state.workspace.declaration.unicodeMap.get(0x41).group), "chars");

  await (await page.$("#image-file")).uploadFile(smallPngPath);
  await page.waitForFunction(() => document.querySelector("#import-report").textContent.includes("최소 2×1"));
  assert.equal(await page.evaluate(() => window.__editor.state.workspace.assets.has("sheet.png")), false);

  await page.click("#file-menu-button");
  await page.click("#open-sources");
  await page.waitForSelector('[data-blank-source="blank.png"]');
  await page.click('[data-blank-source="blank.png"]');
  await page.waitForFunction(() => window.__editor.state.workspace.assets.has("blank.png"));
  assert.deepEqual(await page.evaluate(() => {
    const asset = window.__editor.state.workspace.assets.get("blank.png");
    return { width: asset.width, height: asset.height, transparent: asset.current.every((value, index) => index % 4 !== 3 || value === 0) };
  }), { width: 1, height: 1, transparent: true });
  await page.click('#source-dialog button[value="close"]');

  await (await page.$("#image-file")).uploadFile(pngPath);
  await page.waitForFunction(() => window.__editor.state.workspace.assets.has("sheet.png"));
  await page.waitForFunction(() => document.querySelector("#save-status").classList.contains("saved"));

  assert.equal(await page.$eval("#board", (canvas) => {
    const data = canvas.getContext("2d").getImageData(canvas.width / 2 - 1, canvas.height / 2, 1, 1).data;
    return data[3] > 0 && data[3] < 255;
  }), true, "grid line must be at least 2 CSS pixels thick");

  assert.equal(await page.$eval("#child-filter", (node) => node.checked), true);
  assert.equal(await page.$eval('[data-tool="pencil"]', (node) => node.textContent.trim()), "");
  assert.equal(await page.$("#possible-impact"), null);
  assert.equal(await page.$("#actual-impact"), null);
  assert.equal(await page.$eval("#grid-toggle", (node) => getComputedStyle(node).borderRadius), "0px");
  assert.equal(await page.$eval("#grid-toggle", (node) => getComputedStyle(node).appearance), "none");
  assert.notEqual(await page.$eval("#grid-toggle", (node) => getComputedStyle(node).backgroundImage), "none");
  assert.ok((await page.$$eval("#group-list .group-tile", (nodes) => nodes.length)) > 0);
  assert.ok((await page.$$eval("#group-list .group-tile canvas", (nodes) => nodes.length)) > 0);
  await page.click("#toggle-group-grid");
  assert.equal(await page.$eval("#group-list", (node) => node.hidden), true);
  assert.equal(await page.$eval("#toggle-group-grid", (node) => node.getAttribute("aria-expanded")), "false");
  await page.click("#toggle-group-grid");
  assert.equal(await page.$eval("#group-list", (node) => node.hidden), false);
  assert.equal(await page.$eval("#toggle-character-grid .collapse-label", (node) => node.textContent), "접기");
  await page.click("#toggle-character-grid");
  assert.equal(await page.$eval("#character-grid", (node) => node.hidden), true);
  assert.equal(await page.$eval("#page-controls", (node) => node.hidden), true);
  assert.equal(await page.$eval("#toggle-character-grid .collapse-label", (node) => node.textContent), "펼치기");
  await page.click("#toggle-character-grid");
  assert.equal(await page.$eval("#character-grid", (node) => node.hidden), false);
  await page.waitForFunction(() => document.querySelector("#text-preview").width > 1);
  const inlinePreview = await page.$eval("#text-preview", (canvas) => {
    const rect = canvas.getBoundingClientRect();
    return { ratio: rect.width / rect.height, intrinsic: canvas.width / canvas.height, rendering: getComputedStyle(canvas).imageRendering };
  });
  assert.ok(Math.abs(inlinePreview.ratio - inlinePreview.intrinsic) < 0.05, `inline text preview must preserve aspect ratio: ${JSON.stringify(inlinePreview)}`);
  assert.equal(inlinePreview.rendering, "auto");
  await page.click("#text-preview-open");
  await page.waitForFunction(() => document.querySelector("#text-preview-dialog").open);
  const largePreview = await page.$eval("#text-preview-large", (canvas) => {
    const rect = canvas.getBoundingClientRect();
    return { ratio: rect.width / rect.height, intrinsic: canvas.width / canvas.height, width: canvas.style.width };
  });
  assert.ok(Math.abs(largePreview.ratio - largePreview.intrinsic) < 0.05, `large text preview must preserve aspect ratio: ${JSON.stringify(largePreview)}`);
  await page.select("#text-zoom", "4");
  await page.waitForFunction(() => document.querySelector("#text-preview-large").style.width.endsWith("px"));
  const zoomed = await page.$eval("#text-preview-large", (canvas) => {
    const rect = canvas.getBoundingClientRect();
    return { ratio: rect.width / rect.height, intrinsic: canvas.width / canvas.height, width: canvas.style.width, naturalWidth: canvas.width };
  });
  assert.ok(Math.abs(zoomed.ratio - zoomed.intrinsic) < 0.05, `zoomed text preview must preserve aspect ratio: ${JSON.stringify(zoomed)}`);
  assert.equal(zoomed.width, `${zoomed.naturalWidth * 4}px`);
  await page.click("#text-preview-close");
  await page.click("#lang-toggle");
  assert.equal(await page.evaluate(() => document.documentElement.lang), "en");
  assert.equal(await page.$eval("#open-declaration", (node) => node.textContent), "Open declaration");
  await page.click("#lang-toggle");
  assert.equal(await page.evaluate(() => document.documentElement.lang), "ko");
  const groupLight = await page.$eval("#group-list .group-tile canvas", (canvas) => canvas.toDataURL());
  await page.click("#theme-toggle");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  await page.waitForFunction((before) => document.querySelector("#group-list .group-tile canvas").toDataURL() !== before, {}, groupLight);
  assert.equal(await page.$eval("#board", (canvas) => {
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] === 255 && data[index] === 255 && data[index + 1] === 255 && data[index + 2] === 255) return true;
    }
    return false;
  }), true);
  await page.click("#theme-toggle");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  await page.click("#toggle-nav");
  assert.equal(await page.$eval("#layout", (node) => node.classList.contains("hide-left")), true);
  const collapsedBoard = await (await page.$("#board")).boundingBox();
  assert.ok(collapsedBoard.width > 0 && collapsedBoard.height > 0, "board must remain visible when the left panel is collapsed");
  assert.ok(collapsedBoard.x >= 0 && collapsedBoard.x + collapsedBoard.width <= 1280, `collapsed board must stay inside the viewport: ${JSON.stringify(collapsedBoard)}`);
  await page.click("#toggle-nav");
  await page.click("#toggle-inspector");
  assert.equal(await page.$eval("#layout", (node) => node.classList.contains("hide-right")), true);
  await page.click("#toggle-inspector");

  if (existsSync(FONT)) {
    await (await page.$("#font-file")).uploadFile(FONT);
    await page.waitForFunction(() => window.__editor.state.font?.hasCodepoint(0x41) === true);
    await page.click("#open-works");
    await page.click('[data-records-tab="compare"]');
    assert.equal(await page.$eval("#shadow-toggle", (node) => node.disabled), false);
    await page.waitForSelector("#shadow-toggle", { visible: true });
    await page.click("#shadow-toggle");
    assert.equal(await page.evaluate(() => window.__editor.state.shadow.visible), true);
    const shadowPixels = await page.$eval("#board", (canvas) => {
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let index = 3; index < data.length; index += 4) if (data[index] !== 0) count += 1;
      return count;
    });
    assert.ok(shadowPixels > 10, "font shadow must be visible on the drawing board");
    await page.click("#works-close");
  }

  const board = await page.$("#board");
  const box = await board.boundingBox();
  assert.ok(box.width >= 32 && box.height >= 16);
  await page.mouse.click(box.x + 8, box.y + 8);
  await page.waitForFunction(() => window.__editor.state.workspace.history.revisions.size === 2);
  await page.waitForFunction(() => document.querySelector("#save-status").classList.contains("saved"));

  await page.mouse.click(box.x + 24, box.y + 8, { button: "right" });
  await page.waitForFunction(() => window.__editor.state.workspace.history.revisions.size === 3);
  await page.waitForFunction(() => document.querySelector("#save-status").classList.contains("saved"));

  const editedHead = await page.evaluate(() => window.__editor.state.workspace.history.headId);
  await page.click("#undo");
  await page.waitForFunction((head) => window.__editor.state.workspace.history.headId !== head, {}, editedHead);
  await page.click("#redo");
  await page.waitForFunction((head) => window.__editor.state.workspace.history.headId === head, {}, editedHead);

  await page.click("#file-menu-button");
  await page.click("#export-changed");
  const zipPath = await waitDownload(downloadDir, "Browser-textures.zip");
  const zipBytes = new Uint8Array(readFileSync(zipPath));
  const { readZip } = await import("../src/zip.js");
  const zip = await readZip(zipBytes);
  assert.deepEqual(zip.entries.map((entry) => entry.name), ["sheet.png"]);
  const exported = await decodePng(zip.entries[0].data);
  assert.deepEqual([...exported.data], [0, 0, 0, 255, 0, 0, 0, 0]);

  await page.click('[data-tool="select"]');
  await page.mouse.move(box.x + 4, box.y + 4);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + 12);
  await page.mouse.up();
  await page.waitForFunction(() => Boolean(window.__editor.state.selection));
  assert.equal(await page.evaluate(() => window.__editor.state.view.tool), "move");
  assert.equal(await page.$eval('[data-tool="move"]', (node) => node.classList.contains("active")), true);

  const head = await page.evaluate(() => window.__editor.state.workspace.history.headId);
  await page.click("#toggle-group-grid");
  await page.waitForFunction(() => window.__editor.state.workspace.view.groupGridCollapsed === true);
  await page.click("#file-menu-button");
  await page.click("#export-project");
  const projectPath = await waitDownload(downloadDir, "Browser.jjaim");
  const projectZip = await readZip(new Uint8Array(readFileSync(projectPath)), { keepNonPng: true });
  assert.deepEqual(projectZip.entries.map((entry) => entry.name).sort(), ["project.json", "textures/blank.png", "textures/sheet.png"]);

  await page.evaluate(() => window.__editor.state.storage.lock?.release());
  await page.setOfflineMode(false);
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForFunction(() => window.__editor?.state.workspace?.fileName === "browser.json");
  assert.equal(await page.evaluate(() => window.__editor.state.workspace.history.headId), head);
  assert.equal(await page.$eval("#group-list", (node) => node.hidden), true);
  await page.click("#toggle-group-grid");
  assert.equal(await page.$eval("#group-list", (node) => node.hidden), false);
  await page.click("#open-works");
  await page.waitForFunction(() => document.querySelectorAll("#works-list .list-item").length === 1);
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("#works-list button")].find((node) => node.textContent === "열기");
    button.click();
  });
  await page.waitForFunction(() => window.__editor?.state.workspace?.history?.revisions.size === 3);
  if (existsSync(FONT)) await page.waitForFunction(() => window.__editor.state.font?.hasCodepoint(0x41) === true);
  const restored = await page.evaluate(() => ({
    head: window.__editor.state.workspace.history.headId,
    pixels: [...window.__editor.state.workspace.assets.get("sheet.png").current],
  }));
  assert.equal(restored.head, head);
  assert.deepEqual(restored.pixels, [0, 0, 0, 255, 0, 0, 0, 0]);

  await (await page.$("#declaration-file")).uploadFile(join(REPO_ROOT, "examples/hangul.json"));
  await page.waitForFunction(() => window.__editor.state.workspace.declaration.unicodeMap.size === 11267);
  await (await page.$("#image-file")).uploadFile(join(REPO_ROOT, "examples/hangul.png"));
  await page.waitForFunction(() => window.__editor.state.workspace.assets.has("hangul.png"));
  await page.evaluate(() => window.__editor.selectGlyph("initial_0", 0));
  await page.waitForFunction(() => Boolean(document.querySelector("#structural-usage button")));
  const beforeContext = await page.$eval("#context", (canvas) => canvas.toDataURL());
  const beforeBoard = await page.$eval("#board", (canvas) => canvas.toDataURL());
  await page.click("#structural-usage button");
  await page.waitForFunction(() => window.__editor.state.selected?.group === "hangul_syllables");
  assert.equal(await page.evaluate(() => window.__editor.state.context?.group), "hangul_syllables");
  assert.equal(await page.$eval("#editing-badge", (node) => node.textContent), "합성 전용 · 읽기 전용");
  assert.equal(await page.$eval('[data-tool="pencil"]', (node) => node.disabled), true);
  const childLight = await page.$eval("#child-strip .child-chip canvas", (canvas) => canvas.toDataURL());
  const inspectorLight = await page.$eval("#child-info canvas", (canvas) => canvas.toDataURL());
  await page.click("#theme-toggle");
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await page.waitForFunction((before) => document.querySelector("#child-strip .child-chip canvas").toDataURL() !== before, {}, childLight);
  assert.notEqual(await page.$eval("#child-info canvas", (canvas) => canvas.toDataURL()), inspectorLight);
  const childDark = await page.$eval("#child-strip .child-chip canvas", (canvas) => canvas.toDataURL());
  await page.click("#theme-toggle");
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await page.waitForFunction((before) => document.querySelector("#child-strip .child-chip canvas").toDataURL() !== before, {}, childDark);
  assert.notEqual(await page.$eval("#context", (canvas) => canvas.toDataURL()), beforeContext);
  assert.notEqual(await page.$eval("#board", (canvas) => canvas.toDataURL()), beforeBoard);
  assert.equal(await page.$$eval("#child-info .list-item", (nodes) => nodes.length), 2);
  await page.click("#child-filter");
  assert.ok((await page.$$eval("#child-info .list-item", (nodes) => nodes.length)) > 2);
  await page.click("#child-filter");
  assert.equal(await page.$$eval("#child-strip .child-chip", (nodes) => nodes.length), 2);
  assert.ok((await page.$$eval("#child-info canvas", (nodes) => nodes.length)) > 0);
  const contextBox = await page.$eval("#context", (canvas) => Math.max(canvas.clientWidth, canvas.clientHeight));
  const tileBox = await page.$eval("#child-strip .child-chip canvas", (canvas) => Math.max(canvas.clientWidth, canvas.clientHeight));
  assert.equal(tileBox, contextBox);
  const beforeToggleBoard = await page.$eval("#board", (canvas) => canvas.toDataURL());
  const hiddenBefore = await page.evaluate(() => window.__editor.state.view.hidden.size);
  await page.click("#child-strip .child-chip");
  await page.waitForFunction((count) => window.__editor.state.view.hidden.size === count + 1, {}, hiddenBefore);
  assert.notEqual(await page.$eval("#board", (canvas) => canvas.toDataURL()), beforeToggleBoard);
  await page.click("#child-strip .child-chip");
  await page.waitForFunction((count) => window.__editor.state.view.hidden.size === count, {}, hiddenBefore);
  const beforeChildContext = await page.$eval("#context", (canvas) => canvas.toDataURL());
  await page.click("#child-strip .child-chip .child-nav");
  await page.waitForFunction(() => window.__editor.state.selected?.group === "initial_0");
  assert.equal(await page.evaluate(() => window.__editor.state.context), null);
  assert.equal(await page.$eval("#editing-badge", (node) => node.textContent), "원본 픽셀 편집");
  assert.equal(await page.$eval('[data-tool="pencil"]', (node) => node.disabled), false);
  assert.notEqual(await page.$eval("#context", (canvas) => canvas.toDataURL()), beforeChildContext);
  const beforeCharContext = await page.$eval("#context", (canvas) => canvas.toDataURL());
  const beforeCharBoard = await page.$eval("#board", (canvas) => canvas.toDataURL());
  await page.type("#character-search", "가");
  await page.waitForSelector('[data-codepoint="44032"]');
  await page.click('[data-codepoint="44032"]');
  await page.waitForFunction(() => window.__editor.state.selected?.group === "hangul_syllables");
  assert.equal(await page.evaluate(() => window.__editor.state.context?.codepoint), 0xac00);
  assert.notEqual(await page.$eval("#context", (canvas) => canvas.toDataURL()), beforeCharContext);
  assert.notEqual(await page.$eval("#board", (canvas) => canvas.toDataURL()), beforeCharBoard);

  const beforeProjectImport = await page.evaluate(() => window.__editor.state.workspace.id);
  await (await page.$("#project-file")).uploadFile(projectPath);
  await page.waitForFunction((id) => window.__editor.state.workspace?.id !== id && window.__editor.state.workspace?.fileName === "browser.json", {}, beforeProjectImport);
  const importedProject = await page.evaluate(() => {
    const workspace = window.__editor.state.workspace;
    const asset = workspace.assets.get("sheet.png");
    return {
      id: workspace.id,
      head: workspace.history.headId,
      revisions: workspace.history.revisions.size,
      current: [...asset.current],
      original: [...asset.original],
    };
  });
  assert.notEqual(importedProject.id, beforeProjectImport);
  assert.equal(importedProject.head, head);
  assert.equal(importedProject.revisions, 3);
  assert.deepEqual(importedProject.current, [0, 0, 0, 255, 0, 0, 0, 0]);
  assert.deepEqual(importedProject.original, [0, 0, 0, 0, 0, 0, 0, 255]);

  await page.evaluate(() => window.__editor.selectGlyph("chars", 0));
  await page.click('[data-tool="select"]');
  const scrollBoard = await (await page.$("#board")).boundingBox();
  await page.mouse.move(scrollBoard.x + 1, scrollBoard.y + 1);
  await page.mouse.down();
  await page.mouse.move(scrollBoard.x + scrollBoard.width - 1, scrollBoard.y + scrollBoard.height - 1);
  await page.mouse.up();
  await page.waitForFunction(() => window.__editor.state.view.tool === "move");
  const selected = await page.evaluate(() => window.__editor.state.selection);
  assert.deepEqual(selected, { x: 0, y: 0, width: 2, height: 1 });
  const beforeMoveHead = await page.evaluate(() => window.__editor.state.workspace.history.headId);

  const zoom = await page.evaluate(() => Number(window.__editor.state.view.zoom));
  await page.mouse.move(scrollBoard.x + 8, scrollBoard.y + 8);
  await page.mouse.down();
  await page.mouse.move(scrollBoard.x + 8 + zoom * 4, scrollBoard.y + 8);
  await page.waitForFunction((x) => window.__editor.state.selection.x === x, {}, 4);
  const moving = await page.evaluate(() => window.__editor.state.selection);
  assert.equal(moving.x, 4, "selection box must follow the drag before drop");
  await page.mouse.up();
  await page.waitForFunction((headId) => window.__editor.state.workspace.history.headId !== headId, {}, beforeMoveHead);
  const trimmed = await page.evaluate(() => ({
    selection: window.__editor.state.selection,
    pixels: [...window.__editor.state.workspace.assets.get("sheet.png").current],
  }));
  assert.equal(trimmed.selection.x, 4);
  assert.deepEqual(trimmed.pixels, [0, 0, 0, 0, 0, 0, 0, 0], "pixels outside the glyph must be trimmed");

  const directServer = serve(EDITOR_ROOT);
  directServer.listen(0, "127.0.0.1");
  await once(directServer, "listening");
  try {
    const directPage = await browser.newPage();
    await directPage.setViewport({ width: 1280, height: 720 });
    await directPage.goto(`http://127.0.0.1:${directServer.address().port}/`, { waitUntil: "networkidle0" });
    assert.equal(await directPage.title(), "JJaim 텍스쳐 편집기");
    await directPage.waitForFunction(() => window.__editor?.state?.workspace === null);
  } finally {
    directServer.close();
  }

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(externalRequests, []);
  console.log("browser: Chromium headless passed (repo subpath and editor-root serving, offline edits/save/export, reload restore, no remote requests)");
} finally {
  if (browser) await browser.close();
  server.close();
}

// Keep the editor path assertion meaningful if the working directory changes.
assert.equal(EDITOR_ROOT.endsWith(`${sep}editor`), true);
