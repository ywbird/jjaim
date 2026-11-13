import assert from "node:assert/strict";
import { once } from "node:events";
import { createReadStream, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { decodePng, encodePng } from "../src/png.js";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const EDITOR_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const CHROMIUM = process.env.CHROMIUM_PATH || "/usr/sbin/chromium";
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
writeFileSync(
  declarationPath,
  JSON.stringify({
    metadata: { name: "Browser" },
    texture_sets: { main: { sheet: "sheet.png" } },
    groups: {
      chars: {
        size: [2, 1],
        count: 1,
        texture: { set: "main", source: "sheet", start: [0, 0], direction: "right" },
        unicode: [{ from: [0, 1], to: "U+0041" }],
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
  const origin = new URL(base).origin;
  page.on("request", (request) => {
    const url = request.url();
    if (/^https?:/i.test(url) && new URL(url).origin !== origin) externalRequests.push(url);
  });
  const client = await page.createCDPSession();
  await client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir });
  await page.goto(base, { waitUntil: "networkidle0" });
  assert.equal(await page.title(), "선언 기반 글꼴 텍스처 편집기");
  assert.equal(await page.$eval('script[src="src/app.js"]', (node, prefix) => node.src.startsWith(prefix), base), true);

  await page.setOfflineMode(true);

  await (await page.$("#declaration-file")).uploadFile(declarationPath);
  await page.waitForFunction(() => window.__editor?.state.workspace?.fileName === "browser.json");
  assert.equal(await page.evaluate(() => window.__editor.state.workspace.declaration.unicodeMap.get(0x41).group), "chars");

  await (await page.$("#image-file")).uploadFile(pngPath);
  await page.waitForFunction(() => window.__editor.state.workspace.assets.has("sheet.png"));
  await page.waitForFunction(() => document.querySelector("#save-status").textContent.includes("저장됨"));

  const board = await page.$("#board");
  const box = await board.boundingBox();
  assert.ok(box.width >= 32 && box.height >= 16);
  await page.mouse.click(box.x + 8, box.y + 8);
  await page.waitForFunction(() => window.__editor.state.workspace.history.revisions.size === 2);
  await page.waitForFunction(() => document.querySelector("#save-status").textContent.includes("저장됨"));

  await page.mouse.click(box.x + 24, box.y + 8, { button: "right" });
  await page.waitForFunction(() => window.__editor.state.workspace.history.revisions.size === 3);
  await page.waitForFunction(() => document.querySelector("#save-status").textContent.includes("저장됨"));

  await page.click("#export-changed");
  const zipPath = await waitDownload(downloadDir, "Browser-textures.zip");
  const zipBytes = new Uint8Array(readFileSync(zipPath));
  const { readZip } = await import("../src/zip.js");
  const zip = await readZip(zipBytes);
  assert.deepEqual(zip.entries.map((entry) => entry.name), ["sheet.png"]);
  const exported = await decodePng(zip.entries[0].data);
  assert.deepEqual([...exported.data], [0, 0, 0, 255, 0, 0, 0, 0]);

  const head = await page.evaluate(() => window.__editor.state.workspace.history.headId);
  await page.evaluate(() => window.__editor.state.storage.lock?.release());
  await page.setOfflineMode(false);
  await page.reload({ waitUntil: "networkidle0" });
  await page.click("#open-works");
  await page.waitForFunction(() => document.querySelectorAll("#works-list .list-item").length === 1);
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("#works-list button")].find((node) => node.textContent === "열기");
    button.click();
  });
  await page.waitForFunction(() => window.__editor?.state.workspace?.history?.revisions.size === 3);
  const restored = await page.evaluate(() => ({
    head: window.__editor.state.workspace.history.headId,
    pixels: [...window.__editor.state.workspace.assets.get("sheet.png").current],
  }));
  assert.equal(restored.head, head);
  assert.deepEqual(restored.pixels, [0, 0, 0, 255, 0, 0, 0, 0]);

  assert.deepEqual(externalRequests, []);
  console.log("browser: Chromium headless passed (relative subpath, offline edits/save/export, reload restore, no remote requests)");
} finally {
  if (browser) await browser.close();
  server.close();
}

// Keep the editor path assertion meaningful if the working directory changes.
assert.equal(EDITOR_ROOT.endsWith(`${sep}editor`), true);
