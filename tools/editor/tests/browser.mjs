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

function fnvBytes(bytes) {
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pagePixelHash(page, path) {
  return page.evaluate((assetPath) => {
    const data = window.__editor.state.workspace.assets.get(assetPath).current;
    let hash = 2166136261;
    for (const byte of data) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }, path);
}

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
  assert.deepEqual(await page.$$eval("[data-i18n]", (nodes) => nodes.filter((node) => node.textContent === node.dataset.i18n).map((node) => node.dataset.i18n)), []);
  assert.equal(await page.$eval('script[src="src/app.js"]', (node, prefix) => node.src.startsWith(prefix), base), true);
  await page.waitForSelector("#empty-state", { visible: true });
  assert.equal(await page.$eval("#editor", (node) => node.hidden), true);
  assert.equal(await page.$eval("#empty-open-presets", (node) => node.textContent), "프리셋");
  await page.click("#empty-open-presets");
  await page.waitForFunction(() => document.querySelector("#preset-dialog").open);
  assert.equal(await page.$$eval("[data-preset-kind]", (nodes) => nodes.length), 2);
  await page.click("#preset-close");

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
  await page.click("#open-settings");
  await page.waitForFunction(() => document.querySelector("#settings-dialog").open);
  assert.equal(await page.$eval("#settings-language", (node) => node.value), "ko");
  assert.equal(await page.$eval("#settings-antialias", (node) => node.checked), true);
  assert.equal(await page.$eval(".char-slot canvas", (node) => getComputedStyle(node).imageRendering), "auto");
  assert.equal(await page.$eval("#context", (node) => getComputedStyle(node).imageRendering), "pixelated");
  const contextBefore = await page.$eval("#context", (canvas) => canvas.toDataURL());
  const aaBefore = await page.$eval('[data-codepoint="65"] canvas', (canvas) => canvas.toDataURL());
  await page.click("#settings-antialias");
  await page.waitForFunction(() => document.documentElement.dataset.antialias === "off");
  assert.equal(await page.$eval(".char-slot canvas", (node) => getComputedStyle(node).imageRendering), "pixelated");
  assert.equal(await page.evaluate(() => localStorage.getItem("declarative-font-editor-antialias")), "false");
  assert.equal(await page.$eval("#context", (canvas) => canvas.toDataURL()), contextBefore);
  const aaOff = await page.$eval('[data-codepoint="65"] canvas', (canvas) => canvas.toDataURL());
  assert.notEqual(aaOff, aaBefore);
  await page.click("#settings-antialias");
  await page.waitForFunction(() => document.documentElement.dataset.antialias === "on");
  assert.equal(await page.$eval(".char-slot canvas", (node) => getComputedStyle(node).imageRendering), "auto");
  assert.equal(await page.$eval("#context", (canvas) => canvas.toDataURL()), contextBefore);
  await page.select("#settings-language", "en");
  await page.waitForFunction(() => document.documentElement.lang === "en");
  assert.equal(await page.$eval("#open-declaration", (node) => node.textContent), "Open declaration");
  await page.select("#settings-language", "ko");
  await page.waitForFunction(() => document.documentElement.lang === "ko");
  await page.click("#settings-close");
  assert.ok((await page.$eval("#toolbar", (node) => node.getBoundingClientRect().height)) < 60);
  assert.ok((await page.$$eval("#group-list .group-item", (nodes) => nodes.length)) > 0);
  assert.ok((await page.$$eval("#group-glyph-grid .group-glyph-tile", (nodes) => nodes.length)) > 0);
  assert.ok((await page.$$eval("#group-glyph-grid .group-glyph-tile canvas", (nodes) => nodes.length)) > 0);
  assert.equal(await page.evaluate(() => document.querySelector("#navigator").contains(document.querySelector("#group-list"))), true);
  assert.equal(await page.evaluate(() => document.querySelector("#inspector").contains(document.querySelector("#group-glyph-grid"))), true);
  assert.equal(await page.evaluate(() => document.querySelector("#navigator").contains(document.querySelector("#text-preview"))), true);
  assert.equal(await page.evaluate(() => document.querySelector("#group-glyph-section").previousElementSibling?.id), "group-index-controls");
  assert.equal(await page.evaluate(() => Boolean(document.querySelector("#group-glyph-grid").compareDocumentPosition(document.querySelector("#child-info")) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
  await page.click("#toggle-group-grid");
  assert.equal(await page.$eval("#group-glyph-grid", (node) => node.hidden), true);
  assert.equal(await page.$eval("#toggle-group-grid", (node) => node.getAttribute("aria-expanded")), "false");
  await page.click("#toggle-group-grid");
  assert.equal(await page.$eval("#group-glyph-grid", (node) => node.hidden), false);
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
  const groupLight = await page.$eval("#group-glyph-grid .group-glyph-tile canvas", (canvas) => canvas.toDataURL());
  await page.click("#theme-toggle");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  await page.waitForFunction((before) => document.querySelector("#group-glyph-grid .group-glyph-tile canvas").toDataURL() !== before, {}, groupLight);
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
    assert.equal(await page.$eval("#shadow-toggle", (node) => node.disabled), false);
    assert.equal(await page.$('[data-records-tab="compare"]'), null);
    assert.equal(await page.evaluate(() => document.querySelector("#navigator").contains(document.querySelector("#shadow-controls"))), true);
    assert.equal(await page.$eval("#shadow-size", (node) => node.type), "range");
    assert.equal(await page.$eval("#shadow-x", (node) => node.type), "range");
    assert.equal(
      await page.$eval("#shadow-x", (node) => Number(node.max)),
      await page.evaluate(() => window.__editor.state.workspace.declaration.groups.get(window.__editor.state.selected.group).width),
    );
    await page.waitForSelector("#shadow-toggle", { visible: true });
    await page.$eval("#shadow-size", (node) => {
      node.value = "32";
      node.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForFunction(() => window.__editor.state.shadow.size === 32);
    assert.equal(await page.$eval("#shadow-size-value", (node) => node.textContent), "32px");
    assert.deepEqual(await page.$eval("#shadow-size", (input) => {
      const row = input.closest(".shadow-row");
      const label = row.querySelector("label").getBoundingClientRect();
      const slider = input.getBoundingClientRect();
      const output = row.querySelector("output").getBoundingClientRect();
      return {
        labelBeforeSlider: label.right <= slider.left,
        sliderBeforeOutput: slider.right <= output.left,
        sameRow: Math.abs((label.top + label.bottom) / 2 - (slider.top + slider.bottom) / 2) < 1,
      };
    }), { labelBeforeSlider: true, sliderBeforeOutput: true, sameRow: true });
    const shadowColumns = await page.$$eval(".shadow-row", (rows) => rows.map((row) => ({
      sliderLeft: row.querySelector('input[type="range"]').getBoundingClientRect().left,
      outputLeft: row.querySelector("output").getBoundingClientRect().left,
    })));
    assert.equal(shadowColumns.every((column) => Math.abs(column.sliderLeft - shadowColumns[0].sliderLeft) < 1), true);
    assert.equal(shadowColumns.every((column) => Math.abs(column.outputLeft - shadowColumns[0].outputLeft) < 1), true);
    await page.type("#shadow-preset-name", "한글 프리셋");
    await page.click("#save-shadow-preset");
    assert.equal(await page.$$eval("#shadow-preset-list .shadow-preset-item", (nodes) => nodes.length), 1);
    assert.equal(await page.$eval(".shadow-preset-apply strong", (node) => node.textContent), "한글 프리셋");
    await page.$eval("#shadow-size", (node) => {
      node.value = "48";
      node.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForFunction(() => window.__editor.state.shadow.size === 48);
    await page.click(".shadow-preset-apply");
    await page.waitForFunction(() => window.__editor.state.shadow.size === 32);
    await page.evaluate(() => { window.prompt = () => "Renamed"; });
    await page.click('[data-shadow-action="rename"]');
    await page.waitForFunction(() => document.querySelector(".shadow-preset-apply strong").textContent === "Renamed");
    await page.click('[data-shadow-action="delete"]');
    await page.waitForFunction(() => document.querySelector("#confirm-dialog").open);
    await page.click("#confirm-ok");
    await page.waitForFunction(() => document.querySelectorAll("#shadow-preset-list .shadow-preset-item").length === 0);
    await page.click("#shadow-toggle");
    assert.equal(await page.evaluate(() => window.__editor.state.shadow.visible), true);
    await page.$eval("#shadow-x", (input) => {
      input.value = input.min;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForFunction(() => window.__editor.state.shadow.x < 0);
    const shadowOutside = await page.evaluate(() => {
      const canvas = document.querySelector("#board-shadow");
      const board = document.querySelector("#board");
      const wrap = document.querySelector("#board-wrap");
      const wrapRect = wrap.getBoundingClientRect();
      const boardRect = board.getBoundingClientRect();
      const scaleX = canvas.width / Math.max(1, wrap.scrollWidth);
      const scaleY = canvas.height / Math.max(1, wrap.scrollHeight);
      const left = (boardRect.left - wrapRect.left + wrap.scrollLeft) * scaleX;
      const top = (boardRect.top - wrapRect.top + wrap.scrollTop) * scaleY;
      const right = left + boardRect.width * scaleX;
      const bottom = top + boardRect.height * scaleY;
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let outside = 0;
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          if (x >= left - 1 && x <= right + 1 && y >= top - 1 && y <= bottom + 1) continue;
          if (data[(y * canvas.width + x) * 4 + 3] !== 0) outside += 1;
        }
      }
      return outside;
    });
    assert.ok(shadowOutside > 0, "font shadow must paint outside the glyph box");

    await page.evaluate(() => window.__editor.selectGlyph("spare", 0));
    assert.equal(await page.evaluate(() => window.__editor.state.context), null);
    await page.type("#shadow-text", "B");
    await page.waitForFunction(() => window.__editor.state.view.shadowText === "B");
    const typedShadowPixels = await page.$eval("#board-shadow", (canvas) => {
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let index = 3; index < data.length; index += 4) if (data[index] !== 0) count += 1;
      return count;
    });
    assert.ok(typedShadowPixels > 0, "typed shadow character must render without a Unicode context");
    await page.$eval("#shadow-text", (input) => {
      input.value = "U+0042";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForFunction(() => window.__editor.state.view.shadowText === "U+0042");
    assert.ok(await page.$eval("#board-shadow", (canvas) => {
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      for (let index = 3; index < data.length; index += 4) if (data[index] !== 0) return true;
      return false;
    }), "U+XXXX shadow input must render");
    await page.evaluate(() => window.__editor.selectGlyph("chars", 0, { codepoint: 0x41 }));

    await page.$eval("#shadow-text", (input) => {
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForFunction(() => window.__editor.state.view.shadowText === "");
    await page.evaluate(() => window.__editor.selectGlyph("spare", 0));
    await page.waitForFunction(() => window.__editor.state.view.shadowLast === 0x41);
    assert.equal(await page.evaluate(() => window.__editor.state.view.shadowSticky), false);
    const stickyOffPixels = await page.$eval("#board-shadow", (canvas) => {
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let index = 3; index < data.length; index += 4) if (data[index] !== 0) count += 1;
      return count;
    });
    assert.equal(stickyOffPixels, 0);
    await page.click("#shadow-sticky");
    await page.waitForFunction(() => window.__editor.state.view.shadowSticky === true);
    assert.ok(await page.$eval("#board-shadow", (canvas) => {
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      for (let index = 3; index < data.length; index += 4) if (data[index] !== 0) return true;
      return false;
    }), "sticky shadow must keep the previous Unicode on an unassigned child");
    await page.type("#shadow-preset-name", "유지 프리셋");
    await page.click("#save-shadow-preset");
    assert.deepEqual(await page.evaluate(() => Object.keys(window.__editor.state.workspace.shadowPresets.at(-1)).sort()), ["name", "opacity", "size", "x", "y"]);
    await page.click('[data-shadow-action="delete"]');
    await page.waitForFunction(() => document.querySelector("#confirm-dialog").open);
    await page.click("#confirm-ok");
    await page.waitForFunction(() => document.querySelectorAll("#shadow-preset-list .shadow-preset-item").length === 0);
    await page.click("#shadow-sticky");
    await page.waitForFunction(() => window.__editor.state.view.shadowSticky === false);
    assert.equal(await page.$eval("#board-shadow", (canvas) => {
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      for (let index = 3; index < data.length; index += 4) if (data[index] !== 0) return true;
      return false;
    }), false);
    await page.click("#shadow-sticky");
    await page.waitForFunction(() => window.__editor.state.view.shadowSticky === true);
    await page.$eval("#shadow-text", (input) => {
      input.value = "U+0042";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForFunction(() => window.__editor.state.view.shadowText === "U+0042");
    await page.evaluate(() => window.__editor.selectGlyph("chars", 0, { codepoint: 0x41 }));

    const shadowPixels = await page.$eval("#board", (canvas) => {
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let index = 3; index < data.length; index += 4) if (data[index] !== 0) count += 1;
      return count;
    });
    assert.ok(shadowPixels > 10, "font shadow must be visible on the drawing board");
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
  assert.equal(await page.evaluate(() => window.__editor.state.view.shadowText), "U+0042");
  assert.equal(await page.$eval("#shadow-text", (node) => node.value), "U+0042");
  assert.equal(await page.evaluate(() => window.__editor.state.view.shadowSticky), true);
  assert.equal(await page.$eval("#shadow-sticky", (node) => node.checked), true);
  assert.equal(await page.$eval("#group-glyph-grid", (node) => node.hidden), true);
  await page.click("#toggle-group-grid");
  assert.equal(await page.$eval("#group-glyph-grid", (node) => node.hidden), false);
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
  assert.equal(await page.$$eval("#group-glyph-grid .group-glyph-tile", (nodes) => nodes.length), 32);
  assert.equal(await page.$eval("#group-glyph-pager", (node) => node.hidden), false);
  assert.equal(await page.$eval("#group-glyph-page", (node) => node.textContent), "1 / 350");
  await page.click("#group-glyph-next");
  assert.equal(await page.$eval("#group-glyph-page", (node) => node.textContent), "2 / 350");
  await page.click("#group-glyph-prev");
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
  assert.equal(await page.$eval("#child-strip .child-chip canvas", (canvas) => getComputedStyle(canvas).imageRendering), "pixelated");
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

  await page.evaluate(() => window.__editor.selectGlyph("medial_3", 0));
  await page.waitForFunction(() => document.querySelectorAll("#structural-usage .icon-btn").length === 2);
  assert.equal(await page.$eval("#structural-usage .icon-btn", (node) => node.textContent.trim()), "");
  assert.equal(await page.$eval("#structural-usage .icon-btn", (node) => node.title), "이전");
  const usagePageBefore = await page.$eval("#structural-usage", (node) => node.textContent);
  await page.click("#structural-usage .icon-btn:last-of-type");
  assert.notEqual(await page.$eval("#structural-usage", (node) => node.textContent), usagePageBefore);

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

  const presetPage = await browser.newPage();
  await presetPage.setViewport({ width: 1280, height: 720 });
  const presetErrors = [];
  presetPage.on("pageerror", (error) => presetErrors.push(error.message));
  await presetPage.goto(base, { waitUntil: "networkidle0" });
  await presetPage.click("#file-menu-button");
  await presetPage.click("#open-presets");
  await presetPage.waitForFunction(() => document.querySelector("#preset-dialog").open);
  assert.equal(await presetPage.$$eval("[data-preset-kind]", (nodes) => nodes.length), 2);
  assert.equal(await presetPage.$eval("#preset-ascii-preview", (image) => image.getAttribute("src")), "presets/fonts/E1.png");
  await presetPage.waitForFunction(() => document.querySelector("#preset-ascii-preview").naturalWidth > 0);
  assert.equal(await presetPage.$eval("#preset-custom-toggle", (node) => node.textContent), "크기 직접 정하기");
  await presetPage.select("#preset-ascii-font", "E2.png");
  await presetPage.waitForFunction(() => document.querySelector("#preset-ascii-preview").dataset.file === "E2.png");
  await presetPage.click("#preset-load");
  await presetPage.waitForFunction(() => window.__editor.state.workspace?.fileName === "ascii.json" && window.__editor.state.workspace.assets.has("ascii.png"));
  assert.equal(await presetPage.evaluate(() => window.__editor.state.workspace.declaration.unicodeMap.size), 95);
  const e2 = await decodePng(readFileSync(join(EDITOR_ROOT, "presets/fonts/E2.png")));
  assert.equal(await pagePixelHash(presetPage, "ascii.png"), fnvBytes(e2.data));
  assert.equal(await presetPage.$eval("#preset-dialog", (node) => node.open), false);
  await presetPage.click("#file-menu-button");
  await presetPage.click("#open-presets");
  await presetPage.click('[data-preset-kind="hangul"]');
  await presetPage.select("#preset-hangul-english", "E3.png");
  await presetPage.select("#preset-hangul-korean", "H03.png");
  await presetPage.waitForFunction(() => document.querySelector("#preset-hangul-english-preview").naturalWidth === 128 && document.querySelector("#preset-hangul-korean-preview").naturalWidth === 432);
  await presetPage.click("#preset-load");
  await presetPage.waitForFunction(() => window.__editor.state.workspace?.fileName === "hangul.json" && window.__editor.state.workspace.assets.has("hangul.png"));
  assert.equal(await presetPage.evaluate(() => window.__editor.state.workspace.declaration.unicodeMap.size), 11267);
  assert.equal(await presetPage.evaluate(() => window.__editor.state.workspace.assets.get("hangul.png").width), 432);
  const e3 = await decodePng(readFileSync(join(EDITOR_ROOT, "presets/fonts/E3.png")));
  const h03 = await decodePng(readFileSync(join(EDITOR_ROOT, "presets/fonts/H03.png")));
  assert.equal(await pagePixelHash(presetPage, "ascii.png"), fnvBytes(e3.data));
  assert.equal(await pagePixelHash(presetPage, "hangul.png"), fnvBytes(h03.data));

  await presetPage.evaluate(() => window.__editor.selectGlyph("initial_0", 0));
  await presetPage.click("#copy-selection");
  assert.equal(await presetPage.evaluate(() => window.__editor.state.clipboard?.width), 16);
  await presetPage.evaluate(() => window.__editor.selectGlyph("initial_1", 0));
  const beforePaste = await presetPage.evaluate(() => ({
    head: window.__editor.state.workspace.history.headId,
    pixels: [...window.__editor.state.workspace.assets.get("hangul.png").current],
  }));
  await presetPage.click("#paste-selection");
  await presetPage.waitForFunction((head) => window.__editor.state.workspace.history.headId !== head, {}, beforePaste.head);
  const afterPaste = await presetPage.evaluate(() => [...window.__editor.state.workspace.assets.get("hangul.png").current]);
  assert.notEqual(afterPaste.join(","), beforePaste.pixels.join(","));

  await presetPage.evaluate(() => window.__editor.selectGlyph("initial_0", 0));
  await presetPage.focus("#board");
  await presetPage.keyboard.down("Control");
  await presetPage.keyboard.press("c");
  await presetPage.keyboard.up("Control");
  await presetPage.evaluate(() => window.__editor.selectGlyph("initial_2", 0));
  const beforeKeyboardPaste = await presetPage.evaluate(() => window.__editor.state.workspace.history.headId);
  await presetPage.focus("#board");
  await presetPage.keyboard.down("Control");
  await presetPage.keyboard.press("v");
  await presetPage.keyboard.up("Control");
  await presetPage.waitForFunction((head) => window.__editor.state.workspace.history.headId !== head, {}, beforeKeyboardPaste);

  await presetPage.evaluate(() => {
    window.__editor.selectGlyph("initial_0", 0);
    window.__editor.state.selection = { x: 1, y: 1, width: 2, height: 2 };
    window.__editor.drawBoard();
  });
  await presetPage.click("#copy-selection");
  assert.deepEqual(await presetPage.evaluate(() => {
    const clipboard = window.__editor.state.clipboard;
    return { width: clipboard.width, height: clipboard.height };
  }), { width: 2, height: 2 });

  const beforeShift = await presetPage.evaluate(() => {
    const workspace = window.__editor.state.workspace;
    const sample = (path, x, y) => {
      const asset = workspace.assets.get(path);
      const offset = (y * asset.width + x) * 4;
      return [...asset.current.slice(offset, offset + 4)];
    };
    const hash = (data) => {
      let value = 2166136261;
      for (const byte of data) {
        value ^= byte;
        value = Math.imul(value, 16777619);
      }
      return value >>> 0;
    };
    return {
      head: workspace.history.headId,
      revisions: workspace.history.revisions.size,
      assets: workspace.assets.paths(),
      sample: sample("hangul.png", 1, 0),
      asciiHash: hash(workspace.assets.get("ascii.png").current),
      hangulHash: hash(workspace.assets.get("hangul.png").current),
    };
  });
  assert.equal(await presetPage.$eval("#shadow-presets", (node) => node.nextElementSibling?.id), "shift-panel");
  await presetPage.$eval("#shift-x", (node) => { node.value = "-1"; });
  await presetPage.$eval("#shift-y", (node) => { node.value = "1"; });
  await presetPage.click("#shift-textures");
  await presetPage.waitForFunction(() => document.querySelector("#confirm-dialog").open);
  assert.match(await presetPage.$eval("#confirm-message", (node) => node.textContent), /x -1, y 1/);
  await presetPage.click('#confirm-dialog button[value="cancel"]');
  await presetPage.waitForFunction(() => !document.querySelector("#confirm-dialog").open);
  assert.equal(await presetPage.evaluate(() => window.__editor.state.workspace.history.headId), beforeShift.head);
  await presetPage.click("#shift-textures");
  await presetPage.waitForFunction(() => document.querySelector("#confirm-dialog").open);
  await presetPage.click("#confirm-ok");
  await presetPage.waitForFunction((head) => window.__editor.state.workspace.history.headId !== head, {}, beforeShift.head);
  const shifted = await presetPage.evaluate((previous) => {
    const workspace = window.__editor.state.workspace;
    const revision = workspace.history.head;
    const hangul = workspace.assets.get("hangul.png");
    const ascii = workspace.assets.get("ascii.png");
    const offset = (1 * hangul.width + 0) * 4;
    const hash = (data) => {
      let value = 2166136261;
      for (const byte of data) {
        value ^= byte;
        value = Math.imul(value, 16777619);
      }
      return value >>> 0;
    };
    return {
      kind: revision.kind,
      note: revision.note,
      paths: [...revision.changes.keys()].sort(),
      revisions: workspace.history.revisions.size,
      hangulSample: [...hangul.current.slice(offset, offset + 4)],
      asciiHash: hash(ascii.current),
      hangulHash: hash(hangul.current),
      previous,
    };
  }, beforeShift);
  assert.equal(shifted.kind, "shift");
  assert.equal(shifted.note, "x -1, y 1");
  assert.deepEqual(shifted.paths, beforeShift.assets);
  assert.equal(shifted.revisions, beforeShift.revisions + 1);
  assert.deepEqual(shifted.hangulSample, beforeShift.sample);
  assert.notEqual(shifted.asciiHash, beforeShift.asciiHash);
  assert.notEqual(shifted.hangulHash, beforeShift.hangulHash);

  await presetPage.click("#file-menu-button");
  await presetPage.click("#new-project");
  await presetPage.waitForFunction(() => window.__editor.state.workspace === null);
  assert.equal(await presetPage.$eval("#editor", (node) => node.hidden), true);
  assert.equal(await presetPage.evaluate(() => document.querySelector("#empty-state").hidden), false);
  await presetPage.click("#empty-open-works");
  await presetPage.waitForFunction(() => document.querySelectorAll("#works-list .list-item").length > 0);
  await presetPage.click("#works-close");

  await presetPage.click("#file-menu-button");
  await presetPage.click("#open-presets");
  await presetPage.click("#preset-custom-toggle");
  await presetPage.$eval("#preset-width", (node) => { node.value = "5"; });
  await presetPage.$eval("#preset-height", (node) => { node.value = "11"; });
  await presetPage.click("#preset-load");
  await presetPage.waitForFunction(() => window.__editor.state.workspace?.fileName === "ascii-5x11.json");
  const customAscii = await presetPage.evaluate(() => {
    const workspace = window.__editor.state.workspace;
    return {
      size: [workspace.declaration.groups.get("ascii_20").width, workspace.declaration.groups.get("ascii_20").height],
      start: workspace.declaration.groups.get("ascii_20").texture.start,
      assets: workspace.assets.paths().length,
    };
  });
  assert.deepEqual(customAscii, { size: [5, 11], start: [0, 22], assets: 0 });

  await presetPage.click("#file-menu-button");
  await presetPage.click("#open-presets");
  await presetPage.click('[data-preset-kind="hangul"]');
  await presetPage.click("#preset-load");
  await presetPage.waitForFunction(() => window.__editor.state.workspace?.fileName === "hangul-5x11.json");
  const customHangul = await presetPage.evaluate(() => {
    const workspace = window.__editor.state.workspace;
    return {
      ascii: [workspace.declaration.groups.get("ascii_20").width, workspace.declaration.groups.get("ascii_20").height],
      hangul: [workspace.declaration.groups.get("hangul_syllables").width, workspace.declaration.groups.get("hangul_syllables").height],
      assets: workspace.assets.paths().length,
    };
  });
  assert.deepEqual(customHangul, { ascii: [5, 11], hangul: [10, 11], assets: 0 });
  assert.deepEqual(presetErrors, []);
  await presetPage.close();

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
