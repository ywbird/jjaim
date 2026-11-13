import { parseDeclaration, findGroupGlyphByText, cropBox } from "./declaration.js";
import { AssetStore, sourcePath, sourceRows } from "./assets.js";
import {
  Renderer,
  actualChanges,
  affectedCharacters,
  buildLayerTree,
  flattenLayers,
  diffImages,
  sameImage,
} from "./compose.js";
import { History, pixelChangesForRect } from "./history.js";
import { PixelDraft, ERASER, PENCIL, boundsOf, diffSnapshotToAssets } from "./pixels.js";
import { importImages, manualLink, replaceAssets } from "./importer.js";
import { exportAll, exportChanged, exportSingle } from "./exporter.js";
import {
  BUILT_IN_SETS,
  PAGE_SIZES,
  characterDisplay,
  charactersForSet,
  codepointLabel,
  discoverSets,
  filterCharacters,
  isBlankCharacter,
  paginate,
} from "./unicode-sets.js";
import { renderText, scaleImage } from "./text.js";
import { loadFont, clampShadowSettings } from "./font.js";
import {
  PersistenceUnavailable,
  WorkspaceLock,
  deleteWorkspace,
  listWorkspaces,
  loadWorkspace,
  renameWorkspace,
  saveWorkspace,
} from "./persistence.js";

const $ = (selector) => document.querySelector(selector);
const DEFAULT_TEXT = "다람쥐 헌 쳇바퀴에 타고파.";

const state = {
  workspace: null,
  renderer: null,
  selected: null,
  context: null,
  set: { id: "current", mappedOnly: true, page: 0, pageSize: 128, search: "" },
  view: {
    zoom: 16,
    grid: true,
    tool: "pencil",
    hidden: [],
    ownHidden: false,
    childrenHidden: false,
    diff: false,
    onion: false,
    diffBase: "r0",
    onionBase: "r0",
    onionOpacity: 0.25,
    text: DEFAULT_TEXT,
    textZoom: 1,
  },
  selection: null,
  draft: null,
  drag: null,
  keyMove: null,
  space: false,
  storage: { reading: false, blocked: false, temp: false, readOnly: false, lock: null },
  saveQueue: Promise.resolve(),
  saveToken: 0,
  historyPreview: null,
  impact: null,
  impactToken: 0,
  usageQuery: {},
  font: null,
  shadow: { visible: false, size: 16, x: 0, y: 0, opacity: 0.25 },
  linkTarget: null,
  baseCache: new Map(),
  lastFocused: null,
};

const els = {
  topbar: $("#topbar"),
  openDeclaration: $("#open-declaration"),
  emptyOpenDeclaration: $("#empty-open-declaration"),
  openWorks: $("#open-works"),
  emptyOpenWorks: $("#empty-open-works"),
  openSources: $("#open-sources"),
  workspaceName: $("#workspace-name"),
  saveStatus: $("#save-status"),
  exportSingle: $("#export-single"),
  exportChanged: $("#export-changed"),
  exportAll: $("#export-all"),
  emptyState: $("#empty-state"),
  editor: $("#editor"),
  setSelect: $("#set-select"),
  mappedOnly: $("#mapped-only"),
  setSummary: $("#set-summary"),
  characterSearch: $("#character-search"),
  characterGrid: $("#character-grid"),
  pageFirst: $("#page-first"),
  pagePrev: $("#page-prev"),
  pageInput: $("#page-input"),
  pageCount: $("#page-count"),
  pageNext: $("#page-next"),
  pageLast: $("#page-last"),
  pageSize: $("#page-size"),
  globalSearch: $("#global-search"),
  globalError: $("#global-error"),
  groupSearch: $("#group-search"),
  groupList: $("#group-list"),
  toolbar: $("#toolbar"),
  zoom: $("#zoom"),
  gridToggle: $("#grid-toggle"),
  selectAll: $("#select-all"),
  clearSelection: $("#clear-selection"),
  deleteSelection: $("#delete-selection"),
  undo: $("#undo"),
  redo: $("#redo"),
  toolStatus: $("#tool-status"),
  board: $("#board"),
  boardWrap: $("#board-wrap"),
  ownHidden: $("#own-hidden"),
  childrenHidden: $("#children-hidden"),
  selectionStatus: $("#selection-status"),
  contextLabel: $("#context-label"),
  context: $("#context"),
  layerList: $("#layer-list"),
  groupDetail: $("#group-detail"),
  groupIndexControls: $("#group-index-controls"),
  indexPrev: $("#index-prev"),
  indexInput: $("#index-input"),
  indexCount: $("#index-count"),
  indexNext: $("#index-next"),
  textureInfo: $("#texture-info"),
  childInfo: $("#child-info"),
  structuralUsage: $("#structural-usage"),
  possibleImpact: $("#possible-impact"),
  actualImpact: $("#actual-impact"),
  diffToggle: $("#diff-toggle"),
  diffBase: $("#diff-base"),
  diffCounts: $("#diff-counts"),
  onionToggle: $("#onion-toggle"),
  onionBase: $("#onion-base"),
  onionOpacity: $("#onion-opacity"),
  loadFont: $("#load-font"),
  shadowToggle: $("#shadow-toggle"),
  fontStatus: $("#font-status"),
  shadowControls: $("#shadow-controls"),
  shadowSize: $("#shadow-size"),
  shadowX: $("#shadow-x"),
  shadowY: $("#shadow-y"),
  shadowOpacity: $("#shadow-opacity"),
  textPreset: $("#text-preset"),
  textInput: $("#text-input"),
  textZoom: $("#text-zoom"),
  textStatus: $("#text-status"),
  textPreview: $("#text-preview"),
  historyInfo: $("#history-info"),
  historyList: $("#history-list"),
  historyActions: $("#history-actions"),
  restoreRevision: $("#restore-revision"),
  diffUseRevision: $("#diff-use-revision"),
  onionUseRevision: $("#onion-use-revision"),
  clearPreview: $("#clear-preview"),
  sourceDialog: $("#source-dialog"),
  sourceTable: $("#source-table"),
  importImages: $("#import-images"),
  importReport: $("#import-report"),
  worksDialog: $("#works-dialog"),
  worksList: $("#works-list"),
  worksClose: $("#works-close"),
  confirmDialog: $("#confirm-dialog"),
  confirmMessage: $("#confirm-message"),
  declarationFile: $("#declaration-file"),
  imageFile: $("#image-file"),
  fontFile: $("#font-file"),
};

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, "");
    else if (value !== false && value != null) node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function setStatus(text, kind = "") {
  els.saveStatus.textContent = text;
  els.saveStatus.className = `status ${kind}`;
}

function groupName(group) {
  return group.name;
}

function currentGroup() {
  if (!state.selected || !state.workspace) return null;
  return state.workspace.declaration.groups.get(state.selected.group) ?? null;
}

function currentGlyphTarget() {
  if (state.context?.group != null) return { group: state.context.group, index: state.context.index, codepoint: state.context.codepoint };
  return state.selected;
}

function currentCodepoint() {
  if (state.context?.codepoint != null) return state.context.codepoint;
  if (!state.selected) return null;
  const aliases = state.workspace.declaration.glyphAliases.get(`${state.selected.group}\u0000${state.selected.index}`) ?? [];
  return aliases[0] ?? null;
}

function ownInfo(group = currentGroup(), index = state.selected?.index) {
  if (!group || index == null) return null;
  if (!group.texture) return { ok: false, reason: "합성 전용 그룹입니다. 자식 그룹을 선택하세요" };
  const resolved = sourcePath(state.workspace.declaration, group.texture.set, group.texture.source);
  if (resolved.error) return { ok: false, reason: resolved.error };
  const asset = state.workspace.assets.get(resolved.path);
  if (!asset) return { ok: false, reason: `리소스 없음: ${resolved.path}`, path: resolved.path };
  const box = cropBox(group, index);
  if (box.x < 0 || box.y < 0 || box.x + box.width > asset.width || box.y + box.height > asset.height) {
    return { ok: false, reason: "추출 범위 오류", path: resolved.path, asset, box };
  }
  return { ok: true, asset, path: resolved.path, box };
}

function canEdit() {
  return state.workspace && !state.storage.readOnly && !state.storage.blocked;
}

function ensureEditable() {
  if (!state.workspace) return false;
  if (state.storage.readOnly) {
    els.toolStatus.textContent = "다른 탭에서 편집 중이라 읽기 전용입니다";
    return false;
  }
  if (state.storage.blocked) {
    els.toolStatus.textContent = "저장 실패 상태입니다. 다시 저장하거나 임시 작업을 선택하세요";
    return false;
  }
  return true;
}

// ---------- workspace ----------

function defaultView(declaration) {
  return {
    zoom: 16,
    grid: true,
    tool: "pencil",
    hidden: [],
    ownHidden: false,
    childrenHidden: false,
    diff: false,
    onion: false,
    diffBase: "r0",
    onionBase: "r0",
    onionOpacity: 0.25,
    text: DEFAULT_TEXT,
    textZoom: 1,
  };
}

function newWorkspace(declaration, text, fileName) {
  const id = globalThis.crypto?.randomUUID?.() ?? `w-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const assets = new AssetStore();
  const chosen = [...declaration.unicodeMap.entries()].sort((a, b) => a[0] - b[0])[0];
  const firstGroup = declaration.groups.keys().next().value ?? null;
  const name = declaration.metadata.get("name") || fileName.replace(/\.json$/i, "") || "새 작업";
  const workspace = {
    id,
    name,
    fileName,
    declaration,
    assets,
    history: new History(assets),
    view: defaultView(declaration),
    font: null,
    createdAt: Date.now(),
  };
  if (chosen) state.context = { codepoint: chosen[0], group: chosen[1].group, index: chosen[1].index };
  else state.context = null;
  state.selected = chosen ? { group: chosen[1].group, index: chosen[1].index } : firstGroup ? { group: firstGroup, index: 0 } : null;
  return workspace;
}

function adoptWorkspace(workspace, { restored = false } = {}) {
  state.workspace = workspace;
  state.renderer = new Renderer(workspace.declaration, workspace.assets);
  state.view = { ...defaultView(workspace.declaration), ...(workspace.view ?? {}) };
  state.view.hidden = new Set(state.view.hidden ?? []);
  state.selected = null;
  state.context = null;
  state.selection = null;
  state.draft = null;
  state.impact = null;
  state.historyPreview = null;
  state.baseCache.clear();
  state.font = null;
  state.shadow = { ...state.shadow, ...(workspace.font?.settings ?? {}) };
  if (state.view.selected) {
    state.selected = state.view.selected;
    if (state.view.selected.codepoint != null) state.context = { ...state.view.selected };
  }
  if (!state.selected) {
    const chosen = [...workspace.declaration.unicodeMap.entries()].sort((a, b) => a[0] - b[0])[0];
    if (chosen) {
      state.selected = { group: chosen[1].group, index: chosen[1].index };
      state.context = { codepoint: chosen[0], ...chosen[1] };
    } else {
      const firstGroup = workspace.declaration.groups.keys().next().value;
      state.selected = firstGroup ? { group: firstGroup, index: 0 } : null;
    }
  }
  state.set = { id: "current", mappedOnly: true, page: 0, pageSize: 128, search: "", ...(workspace.view?.set ?? {}) };
  state.storage.temp = false;
  state.storage.blocked = false;
  state.storage.readOnly = false;
  state.storage.lock = new WorkspaceLock(workspace.id, crypto.randomUUID());
  state.storage.readOnly = !state.storage.lock.acquire();
  if (restored && workspace.font?.bytes) {
    loadWorkspaceFont(workspace.font);
  }
  els.emptyState.hidden = true;
  els.editor.hidden = false;
  refreshAll();
  setStatus(state.storage.readOnly ? "읽기 전용" : restored ? "브라우저에 저장됨" : "변경 없음", restored ? "saved" : "");
  persist("open");
}

async function openDeclarationFile(file) {
  try {
    const text = await file.text();
    const declaration = parseDeclaration(text, { fileName: file.name });
    const workspace = newWorkspace(declaration, text, file.name);
    state.workspace = workspace;
    if (state.storage.lock) state.storage.lock.release();
    adoptWorkspace(workspace);
  } catch (error) {
    setStatus(`선언을 열지 못했습니다: ${error.message}`, "failed");
    els.globalError.textContent = error.message;
  }
}

async function persist(reason = "edit") {
  if (!state.workspace) return;
  if (state.storage.temp) {
    setStatus("임시 작업 (저장하지 않음)", "saving");
    return;
  }
  if (state.storage.readOnly) {
    setStatus("읽기 전용", "saved");
    return;
  }
  state.workspace.view = {
    ...state.view,
    hidden: [...state.view.hidden],
    set: { ...state.set },
    selected: state.selected ? { ...state.selected, codepoint: state.context?.codepoint ?? null } : null,
  };
  state.workspace.font = state.font
    ? { name: state.font.name, family: state.font.family, bytes: state.font.bytes, settings: { ...state.shadow } }
    : state.workspace.font ?? null;
  const token = ++state.saveToken;
  const workspace = state.workspace;
  setStatus("저장 중…", "saving");
  state.saveQueue = state.saveQueue
    .then(() => {
      if (workspace.deleted) return null;
      return saveWorkspace(workspace);
    })
    .then(() => {
      if (token !== state.saveToken) return;
      state.storage.blocked = false;
      setStatus("브라우저에 저장됨", "saved");
    })
    .catch((error) => {
      if (token !== state.saveToken) return;
      state.storage.blocked = true;
      setStatus(`저장 실패: ${error.message}`, "failed");
      showSaveFailure();
    });
  await state.saveQueue;
}

function showSaveFailure() {
  const status = els.saveStatus;
  status.title = "저장 실패. 다시 저장하거나 임시 작업으로 계속할 수 있습니다.";
  if ($("#retry-save")) return;
  const retry = el("button", { id: "retry-save", class: "small", text: "다시 저장", onclick: () => { $("#retry-save")?.remove(); persist("retry"); } });
  const temp = el("button", { id: "temp-save", class: "small", text: "임시 작업", onclick: () => {
    state.storage.temp = true;
    state.storage.blocked = false;
    $("#retry-save")?.remove();
    $("#temp-save")?.remove();
    setStatus("임시 작업 (저장하지 않음)", "saving");
  } });
  status.after(retry, temp);
}

function defaultShadowSize() {
  return Math.min(1024, Math.max(1, currentGroup()?.height ?? 16));
}

async function loadWorkspaceFont(fontData) {
  try {
    const font = await loadFont(null, new Uint8Array(fontData.bytes), fontData.name);
    font.settings = { ...font.settings, size: defaultShadowSize(), ...(fontData.settings ?? {}) };
    state.font = font;
    state.shadow = clampShadowSettings(font.settings);
    updateFontUi();
    drawContext();
  } catch (error) {
    els.fontStatus.textContent = error.message;
  }
}

// ---------- navigation ----------

function renderSetSelect() {
  els.setSelect.replaceChildren();
  if (!state.workspace) return;
  for (const set of discoverSets(state.workspace.declaration)) {
    els.setSelect.append(el("option", { value: set.id, text: `${set.name} (${set.mapped}/${set.all})` }));
  }
  els.setSelect.value = state.set.id;
}

function navigatorCharacters() {
  if (!state.workspace) return [];
  let items = charactersForSet(state.set.id, state.workspace.declaration);
  const builtIn = state.set.id !== "current";
  if (builtIn && state.set.mappedOnly) items = items.filter((cp) => state.workspace.declaration.unicodeMap.has(cp));
  items = filterCharacters(items, state.set.search);
  return items;
}

function renderNavigator() {
  if (!state.workspace) return;
  renderSetSelect();
  const items = navigatorCharacters();
  const page = paginate(items, state.set.page, state.set.pageSize);
  state.set.page = page.page;
  const all = discoverSets(state.workspace.declaration).find((set) => set.id === state.set.id);
  els.setSummary.textContent = all ? `매핑 ${all.mapped} / 셋 전체 ${all.all}` : "";
  els.pageInput.value = String(page.page + 1);
  els.pageCount.textContent = `/ ${page.pageCount}`;
  els.characterGrid.replaceChildren();
  for (const cp of page.items) {
    const slot = el("button", { class: "char-slot", type: "button", dataset: { codepoint: String(cp) } });
    const target = state.workspace.declaration.unicodeMap.get(cp);
    const thumb = el("canvas", { width: 26, height: 26 });
    const ctx = thumb.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    if (target) {
      const result = state.renderer.renderGlyph(target.group, target.index);
      drawImageToCanvas(thumb, result.image, 26 / Math.max(result.image.width, result.image.height), true);
      if (result.errors.length) {
        thumb.title = result.errors[0].message;
        slot.classList.add("has-error");
        slot.append(el("span", { class: "cp", text: "리소스 오류" }));
      }
      slot.append(thumb);
      if (state.selected && target.group === state.selected.group && target.index === state.selected.index) slot.classList.add("selected");
      slot.append(el("span", { class: "cp", text: codepointLabel(cp) }));
      if (!isBlankCharacter(cp)) slot.append(el("span", { class: "cp", text: characterDisplay(cp) }));
      slot.addEventListener("click", () => selectGlyph(target.group, target.index, { codepoint: cp }));
    } else {
      slot.classList.add("unmapped");
      slot.append(el("span", { text: "—" }));
      slot.append(el("span", { class: "cp", text: codepointLabel(cp) }));
      slot.append(el("span", { class: "cp", text: "매핑 없음" }));
      slot.addEventListener("click", () => {
        state.selected = null;
        state.context = null;
        state.selection = null;
        els.toolStatus.textContent = `${codepointLabel(cp)} · 선언에 매핑 없음`;
        drawBoard();
        drawContext();
        renderGroupInfo();
      });
    }
    els.characterGrid.append(slot);
  }
  if (page.items.length === 0) els.characterGrid.append(el("div", { class: "muted", text: "결과 0개" }));

  els.groupList.replaceChildren();
  const query = els.groupSearch.value.trim();
  for (const group of state.workspace.declaration.groups.values()) {
    if (query && !group.name.includes(query)) continue;
    const item = el("button", {
      class: `group-item${state.selected?.group === group.name ? " selected" : ""}`,
      type: "button",
      onclick: () => selectGlyph(group.name, Math.min(state.selected?.index ?? 0, group.count - 1), { keepContext: false }),
    }, el("strong", { text: group.name }), el("small", { text: ` · ${group.count}개 · ${group.width}×${group.height}` }));
    els.groupList.append(item);
  }
}

function selectGlyph(group, index, { codepoint = null, keepContext = false } = {}) {
  if (!state.workspace) return;
  cancelDraft();
  const model = state.workspace.declaration.groups.get(group);
  if (!model) return;
  const safeIndex = Math.max(0, Math.min(model.count - 1, Number(index) || 0));
  state.selected = { group, index: safeIndex };
  if (codepoint != null) state.context = { codepoint, group, index: safeIndex };
  else if (!keepContext) state.context = null;
  state.selection = null;
  state.historyPreview = null;
  refreshAll();
  scheduleViewSave("selection");
}

// ---------- board ----------

function imageCanvas(image) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, image.width);
  canvas.height = Math.max(1, image.height);
  const ctx = canvas.getContext("2d");
  const data = new Uint8ClampedArray(image.data);
  ctx.putImageData(new ImageData(data, image.width, image.height), 0, 0);
  return canvas;
}

function drawImageToCanvas(canvas, image, zoom, nearest = true) {
  const dpr = globalThis.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(image.width * zoom));
  const height = Math.max(1, Math.round(image.height * zoom));
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = !nearest;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (image.width === 0 || image.height === 0) return ctx;
  ctx.drawImage(imageCanvas(image), 0, 0, canvas.width, canvas.height);
  return ctx;
}

function drawGrid(ctx, image, zoom) {
  if (!state.view.grid || zoom < 8) return;
  const dpr = globalThis.devicePixelRatio || 1;
  ctx.save();
  ctx.strokeStyle = "rgba(40, 47, 58, 0.22)";
  ctx.lineWidth = 1;
  for (let x = 1; x < image.width; x += 1) {
    const px = Math.round(x * zoom * dpr) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, image.height * zoom * dpr);
    ctx.stroke();
  }
  for (let y = 1; y < image.height; y += 1) {
    const py = Math.round(y * zoom * dpr) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(image.width * zoom * dpr, py);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSelection(ctx, zoom) {
  if (!state.selection) return;
  const dpr = globalThis.devicePixelRatio || 1;
  const { x, y, width, height } = state.selection;
  ctx.save();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 2]);
  ctx.strokeRect(x * zoom * dpr + 0.5, y * zoom * dpr + 0.5, width * zoom * dpr - 1, height * zoom * dpr - 1);
  ctx.strokeStyle = "#1f5fbf";
  ctx.lineDashOffset = 4;
  ctx.strokeRect(x * zoom * dpr + 0.5, y * zoom * dpr + 0.5, width * zoom * dpr - 1, height * zoom * dpr - 1);
  ctx.restore();
}

function hiddenSet() {
  const hidden = new Set(state.view.hidden ?? []);
  if (state.view.childrenHidden && state.workspace && state.selected) {
    const tree = buildLayerTree(state.workspace.declaration, state.selected.group, state.selected.index);
    for (const layer of flattenLayers(tree.root)) hidden.add(layer.id);
  }
  return hidden;
}

function previewId() {
  if (!state.workspace || !state.historyPreview) return null;
  return state.historyPreview === state.workspace.history.headId ? null : state.historyPreview;
}

function activeRenderer() {
  const id = previewId();
  return id ? rendererForState(getBaseState(id)) : state.renderer;
}

function getBaseState(id) {
  const key = `${id}`;
  if (!state.baseCache.has(key)) state.baseCache.set(key, state.workspace.history.stateAt(id));
  return state.baseCache.get(key);
}

function cropFromState(stateMap, group, index) {
  if (!group.texture) return null;
  const resolved = sourcePath(state.workspace.declaration, group.texture.set, group.texture.source);
  if (resolved.error) return null;
  const data = stateMap.get(resolved.path);
  const asset = state.workspace.assets.get(resolved.path);
  if (!data || !asset) return null;
  const box = cropBox(group, index);
  if (box.x < 0 || box.y < 0 || box.x + box.width > asset.width || box.y + box.height > asset.height) return null;
  const out = new Uint8Array(box.width * box.height * 4);
  for (let row = 0; row < box.height; row += 1) {
    out.set(data.subarray(((box.y + row) * asset.width + box.x) * 4, ((box.y + row) * asset.width + box.x + box.width) * 4), row * box.width * 4);
  }
  return { width: box.width, height: box.height, data: out };
}

function rendererForState(stateMap) {
  const assets = state.workspace.assets.clone();
  assets.restore(stateMap);
  return new Renderer(state.workspace.declaration, assets);
}

function tintPixel(image, x, y, color) {
  const offset = (y * image.width + x) * 4;
  image.data[offset] = color[0];
  image.data[offset + 1] = color[1];
  image.data[offset + 2] = color[2];
  image.data[offset + 3] = 255;
}

function diffTintImage(after, before) {
  const image = { width: after.width, height: after.height, data: after.data.slice() };
  for (let y = 0; y < after.height; y += 1) {
    for (let x = 0; x < after.width; x += 1) {
      const i = (y * after.width + x) * 4;
      const beforeA = before.data[i + 3];
      const afterA = after.data[i + 3];
      if (beforeA === 0 && afterA !== 0) tintPixel(image, x, y, [40, 160, 80]);
      else if (beforeA !== 0 && afterA === 0) tintPixel(image, x, y, [200, 60, 60]);
      else if (beforeA !== 0 && afterA !== 0 && (before.data[i] !== after.data[i] || before.data[i + 1] !== after.data[i + 1] || before.data[i + 2] !== after.data[i + 2] || beforeA !== afterA)) tintPixel(image, x, y, [230, 150, 20]);
    }
  }
  return image;
}

function drawBoard() {
  const group = currentGroup();
  if (!group || !state.selected) {
    const ctx = els.board.getContext("2d");
    els.board.width = 1;
    els.board.height = 1;
    els.board.style.width = "1px";
    els.board.style.height = "1px";
    ctx.clearRect(0, 0, 1, 1);
    return;
  }
  const index = state.selected.index;
  const info = ownInfo(group, index);
  const previewing = previewId();
  let result;
  let renderer;
  if (state.draft && !previewing) {
    state.draft.previewAssets.get(state.draft.path).current = state.draft.draft.data;
    state.draft.previewRenderer.invalidate();
    renderer = state.draft.previewRenderer;
    result = renderer.board(group.name, index, { hidden: hiddenSet(), ownHidden: state.view.ownHidden });
  } else {
    renderer = activeRenderer();
    result = renderer.board(group.name, index, { hidden: hiddenSet(), ownHidden: state.view.ownHidden });
  }
  let display = result.image;
  let counts = null;
  state.currentOnion = null;
  if (!previewing && (state.view.diff || state.view.onion)) {
    const own = renderer.ownImage(group.name, index).image;
    if (state.view.diff) {
      const base = cropFromState(getBaseState(state.view.diffBase), group, index);
      if (base) {
        counts = diffImages(base, own).counts;
        display = diffTintImage(own, base);
      }
    }
    if (state.view.onion) state.currentOnion = cropFromState(getBaseState(state.view.onionBase), group, index);
  }

  const zoom = Number(state.view.zoom);
  const ctx = drawImageToCanvas(els.board, display, zoom);
  if (state.view.onion && state.currentOnion) {
    const dpr = globalThis.devicePixelRatio || 1;
    const tinted = state.currentOnion.data.slice();
    for (let i = 0; i < tinted.length; i += 4) {
      if (tinted[i + 3] !== 0) {
        tinted[i] = 40;
        tinted[i + 1] = 120;
        tinted[i + 2] = 255;
      }
    }
    ctx.save();
    ctx.globalAlpha = Number(state.view.onionOpacity);
    ctx.drawImage(imageCanvas({ width: state.currentOnion.width, height: state.currentOnion.height, data: tinted }), 0, 0, els.board.width, els.board.height);
    ctx.restore();
  }
  drawGrid(ctx, display, zoom);
  drawSelection(ctx, zoom);
  if (counts) {
    els.diffCounts.textContent = `추가 ${counts.added} · 삭제 ${counts.removed} · 변경 ${counts.changed}`;
  } else if (state.view.diff) els.diffCounts.textContent = "기준 픽셀 없음";

  const selection = state.selection;
  els.selectionStatus.textContent = selection ? `선택 ${selection.width}×${selection.height} @ (${selection.x},${selection.y})` : "선택 없음";
  const reason = info?.ok ? null : info?.reason;
  els.toolStatus.textContent = previewing ? `${previewing} 읽기 전용 미리보기` : reason ?? `${group.name}[${index}] · ${state.view.tool}`;
  els.board.classList.toggle("readonly", Boolean(reason) || Boolean(previewing) || !canEdit());
}

function drawContext() {
  const target = currentGlyphTarget();
  if (!target) {
    els.context.width = 1;
    els.context.height = 1;
    return;
  }
  const renderer = state.draft ? state.draft.previewRenderer : activeRenderer();
  const result = renderer.renderGlyph(target.group, target.index);
  let display = result.image;
  state.contextOnion = null;
  if (state.view.diff) {
    const baseResult = rendererForState(getBaseState(state.view.diffBase)).renderGlyph(target.group, target.index);
    const diff = diffImages(baseResult.image, result.image);
    display = diffTintImage(result.image, baseResult.image);
    els.diffCounts.textContent = `추가 ${diff.counts.added} · 삭제 ${diff.counts.removed} · 변경 ${diff.counts.changed}`;
    els.contextLabel.textContent = `${codepointLabel(currentCodepoint() ?? 0)} · 결과 비교`;
  }
  if (state.view.onion) {
    state.contextOnion = rendererForState(getBaseState(state.view.onionBase)).renderGlyph(target.group, target.index).image;
    if (!state.view.diff) els.contextLabel.textContent = `${codepointLabel(currentCodepoint() ?? 0)} · 결과`;
  }
  const zoom = Math.max(1, Math.round(Math.min(8, 220 / Math.max(1, display.width, display.height))));
  const ctx = drawImageToCanvas(els.context, display, zoom);
  if (state.view.onion && state.contextOnion) {
    const dpr = globalThis.devicePixelRatio || 1;
    const tinted = state.contextOnion.data.slice();
    for (let i = 0; i < tinted.length; i += 4) {
      if (tinted[i + 3] !== 0) {
        tinted[i] = 40;
        tinted[i + 1] = 120;
        tinted[i + 2] = 255;
      }
    }
    ctx.save();
    ctx.globalAlpha = Number(state.view.onionOpacity);
    ctx.drawImage(imageCanvas({ width: state.contextOnion.width, height: state.contextOnion.height, data: tinted }), 0, 0, els.context.width, els.context.height);
    ctx.restore();
  }
  drawGrid(ctx, display, zoom);
  drawShadow(ctx, zoom, target);
  if (!state.view.diff) {
    const cp = currentCodepoint();
    els.contextLabel.textContent = cp == null ? "결과 문맥 없음" : `${codepointLabel(cp)} → ${target.group}[${target.index}]`;
  }
  if (result.errors.length) els.contextLabel.textContent = `결과 오류: ${result.errors[0].message}`;
}

function drawShadow(ctx, zoom, target) {
  if (!state.font || !state.shadow.visible) return;
  const cp = currentCodepoint();
  if (cp == null) {
    els.fontStatus.textContent = "사용처 글자를 선택하세요";
    return;
  }
  if (!state.font.hasCodepoint(cp)) {
    els.fontStatus.textContent = "참고 폰트에 글자 없음";
    return;
  }
  const dpr = globalThis.devicePixelRatio || 1;
  const char = String.fromCodePoint(cp);
  ctx.save();
  ctx.globalAlpha = clampShadowSettings(state.shadow).opacity;
  ctx.fillStyle = "#000";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `${clampShadowSettings(state.shadow).size * zoom * dpr}px "${state.font.family}"`;
  ctx.fillText(char, clampShadowSettings(state.shadow).x * zoom * dpr, clampShadowSettings(state.shadow).y * zoom * dpr);
  ctx.restore();
}

// ---------- inspector ----------

function renderGroupInfo() {
  const group = currentGroup();
  els.groupDetail.replaceChildren();
  els.childInfo.replaceChildren();
  els.textureInfo.replaceChildren();
  els.layerList.replaceChildren();
  if (!group || !state.selected) {
    els.groupDetail.textContent = "선택 없음";
    els.groupIndexControls.hidden = true;
    return;
  }
  const index = state.selected.index;
  els.groupIndexControls.hidden = false;
  els.indexInput.value = String(index);
  els.indexInput.max = String(group.count - 1);
  els.indexCount.textContent = `/ ${group.count}개 · ${group.width}×${group.height}`;
  els.groupDetail.append(
    el("strong", { text: group.name }),
    el("div", { text: group.description ? group.description : "설명 없음", class: group.description ? "" : "muted" }),
    el("div", { class: "muted", text: `인덱스 ${index} / ${group.count}` }),
  );
  const info = ownInfo(group, index);
  if (group.texture) {
    const resolved = sourcePath(state.workspace.declaration, group.texture.set, group.texture.source);
    els.textureInfo.append(
      el("div", { text: `텍스처: ${group.texture.set}/${group.texture.source}` }),
      el("div", { class: "muted", text: resolved.path ?? resolved.error }),
      el("div", { class: info.ok ? "" : "error-text", text: info.ok ? `연결됨 · ${info.asset.width}×${info.asset.height} · 추출 (${info.box.x},${info.box.y})` : info.reason }),
      el("button", { class: "small", text: "소스 연결", onclick: openSources }),
    );
  } else {
    els.textureInfo.append(el("div", { class: "muted", text: "텍스처 없음 · 합성 전용 그룹" }));
  }

  const children = new Map();
  for (let importIndex = 0; importIndex < group.imports.length; importIndex += 1) {
    const imp = group.imports[importIndex];
    if (!children.has(imp.group)) children.set(imp.group, []);
    children.get(imp.group).push(importIndex);
  }
  if (children.size === 0) {
    els.childInfo.append(el("div", { class: "muted", text: "임포트한 자식 그룹 없음" }));
  }
  const placements = state.workspace.declaration.placement(group.name).get(index) ?? [];
  for (const [childName, imports] of children) {
    const child = state.workspace.declaration.groups.get(childName);
    const occurrences = placements.filter((item) => item.child === childName);
    const box = el("div", { class: "list-item" },
      el("strong", { text: childName }),
      el("div", { class: child.description ? "" : "muted", text: child.description || "설명 없음" }),
      el("div", { class: "muted", text: occurrences.length ? `현재 인덱스 배치 ${occurrences.length}건 · 임포트 ${imports.join(", ")}` : "현재 글리프에는 배치 없음" }),
    );
    if (occurrences.length) {
      for (const occurrence of occurrences) {
        box.append(el("button", { class: "small", text: `${childName}[${occurrence.childIndex}]`, onclick: () => selectGlyph(childName, occurrence.childIndex, { keepContext: true }) }));
      }
    } else {
      box.append(el("button", { class: "small", text: `${childName}[0] 열기`, onclick: () => selectGlyph(childName, 0, { keepContext: true }) }));
    }
    els.childInfo.append(box);
  }

  const tree = buildLayerTree(state.workspace.declaration, group.name, index);
  const layers = flattenLayers(tree.root);
  if (layers.length === 0) {
    els.layerList.append(el("div", { class: "muted", text: "자식 레이어 없음" }));
  }
  for (const layer of layers) {
    const checkbox = el("input", { type: "checkbox", checked: !state.view.hidden.has(layer.id) });
    checkbox.addEventListener("change", () => {
      const hidden = hiddenSet();
      if (checkbox.checked) hidden.delete(layer.id);
      else hidden.add(layer.id);
      state.view.hidden = [...hidden];
      drawBoard();
      drawContext();
      persist("view");
    });
    els.layerList.append(
      el("label", { title: layer.id },
        checkbox,
        el("span", { class: "depth", text: "  ".repeat(Math.min(6, layer.depth)) }),
        el("span", { text: `${layer.group}[${layer.index}]` }),
        el("span", { class: "muted", text: ` i${layer.importIndex + 1}` }),
      ),
    );
  }
}

function renderUsageList(element, codepoints, { unknown = false } = {}) {
  element.replaceChildren();
  if (!codepoints) {
    element.append(el("div", { class: "muted", text: "선택 없음" }));
    return;
  }
  const query = (state.usageQuery[element.id] ?? "").trim().toLowerCase();
  const visible = query
    ? codepoints.filter((item) => {
      const cp = typeof item === "number" ? item : item.codepoint;
      const target = state.workspace.declaration.unicodeMap.get(cp);
      return codepointLabel(cp).toLowerCase().includes(query) || String.fromCodePoint(cp).includes(query) || (target && `${target.group}[${target.index}]`.toLowerCase().includes(query));
    })
    : codepoints;
  if (visible.length === 0) {
    element.append(el("div", { class: "muted", text: codepoints.length ? "검색 결과 없음" : "없음" }));
    return;
  }
  const page = paginate(visible, state.impactPage?.[element.id] ?? 0, 64);
  state.impactPage = { ...(state.impactPage ?? {}), [element.id]: page.page };
  for (const item of page.items) {
    const cp = typeof item === "number" ? item : item.codepoint;
    const target = state.workspace.declaration.unicodeMap.get(cp);
    const label = target ? `${codepointLabel(cp)} ${characterDisplay(cp)} ${target.group}[${target.index}]` : `${codepointLabel(cp)} · 선언에 매핑 없음`;
    const button = el("button", { class: "list-item", text: label });
    if (target) button.addEventListener("click", () => selectGlyph(target.group, target.index, { codepoint: cp }));
    element.append(button);
  }
  if (page.pageCount > 1) {
    const row = el("div", { class: "row wrap" });
    row.append(
      el("button", { class: "small", text: "이전", disabled: page.page === 0, onclick: () => { state.impactPage[element.id] = page.page - 1; renderImpact(); } }),
      el("span", { class: "muted", text: `${page.page + 1}/${page.pageCount}` }),
      el("button", { class: "small", text: "다음", disabled: page.page >= page.pageCount - 1, onclick: () => { state.impactPage[element.id] = page.page + 1; renderImpact(); } }),
      el("span", { class: "muted", text: query ? `검색 ${visible.length} / 전체 ${codepoints.length}` : `전체 ${codepoints.length}` }),
    );
    element.append(row);
  } else {
    element.append(el("div", { class: "muted", text: query ? `검색 ${visible.length} / 전체 ${codepoints.length}` : `전체 ${codepoints.length}` }));
  }
}

function renderImpact() {
  if (!state.workspace || !state.selected) {
    renderUsageList(els.structuralUsage, null);
    renderUsageList(els.possibleImpact, null);
    renderUsageList(els.actualImpact, null);
    return;
  }
  const usages = state.workspace.declaration.usages(state.selected.group, state.selected.index);
  renderUsageList(els.structuralUsage, usages.map((item) => item.codepoint));
  if (!state.impact) {
    els.possibleImpact.replaceChildren(el("div", { class: "muted", text: "변경 명령 없음" }));
    els.actualImpact.replaceChildren(el("div", { class: "muted", text: "변경 명령 없음" }));
    return;
  }
  if (state.impact.pending) {
    els.possibleImpact.replaceChildren(el("div", { class: "muted", text: "계산 중…" }));
    els.actualImpact.replaceChildren(el("div", { class: "muted", text: "계산 중…" }));
    return;
  }
  renderUsageList(els.possibleImpact, state.impact.candidates);
  const actualNode = els.actualImpact;
  actualNode.replaceChildren();
  if (state.impact.unknown.length) actualNode.append(el("div", { class: "muted", text: `판정 불가 ${state.impact.unknown.length}개` }));
  renderUsageList(actualNode, state.impact.actual);
}

function computeImpact(revision) {
  const token = ++state.impactToken;
  if (!revision || revision.kind === "original") {
    state.impact = null;
    renderImpact();
    return;
  }
  state.impact = { pending: true };
  renderImpact();
  setTimeout(() => {
    if (token !== state.impactToken || !state.workspace) return;
    try {
      const diff = state.workspace.history.diffFor(revision.id);
      const rects = new Map();
      for (const [path, changes] of diff.changes) {
        const rect = boundsOf(changes);
        if (rect) rects.set(path, [rect]);
      }
      const candidates = affectedCharacters(state.workspace.declaration, state.workspace.assets, rects);
      const actual = actualChanges(state.workspace.declaration, state.workspace.assets, rects, candidates, diff.before, diff.after);
      if (token === state.impactToken) {
        state.impact = { revision: revision.id, candidates, actual: actual.changed, unknown: actual.unknown, pending: false };
        renderImpact();
      }
    } catch (error) {
      if (token === state.impactToken) {
        state.impact = { revision: revision.id, candidates: [], actual: [], unknown: [], pending: false, error: error.message };
        renderImpact();
      }
    }
  }, 0);
}

// ---------- history ----------

function historyOptions() {
  if (!state.workspace) return [];
  return [...state.workspace.history.revisions.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function renderHistory() {
  if (!state.workspace) return;
  const history = state.workspace.history;
  const head = history.head;
  const branchCount = history.pathTo(head.id).length - 1;
  els.historyInfo.textContent = `현재 ${head.id} · revision ${history.revisions.size - 1}개 · 경로 ${branchCount}단계`;
  els.historyList.replaceChildren();
  for (const revision of historyOptions()) {
    const current = revision.id === head.id;
    const ancestor = history.pathTo(head.id).some((item) => item.id === revision.id);
    const label = revision.kind === "original" ? "최초 원본" : revision.kind === "restore" ? "복원" : revision.start ? `${revision.start.group}[${revision.start.index}]` : revision.kind;
    const item = el("div", {
      class: `list-item history-item${current ? " current" : ""}`,
      role: "button",
      tabindex: "0",
      onclick: () => {
        state.historyPreview = revision.id;
        renderHistory();
        updateToolAvailability();
        computeImpact(revision);
        drawBoard();
        drawContext();
      },
    },
      el("strong", { text: revision.id }),
      el("span", { text: ` · ${label}` }),
      el("div", { class: "muted", text: new Date(revision.timestamp).toLocaleString() }),
      current ? el("div", { class: "muted", text: "현재 상태" }) : ancestor ? el("div", { class: "muted", text: "현재 경로" }) : el("div", { class: "branch", text: "다른 분기" }),
    );
    if (revision.start) {
      item.append(el("button", {
        class: "small",
        text: `${revision.start.group}[${revision.start.index}]로 이동`,
        onclick: (event) => {
          event.stopPropagation();
          selectGlyph(revision.start.group, revision.start.index, { keepContext: true });
        },
      }));
    } else if (revision.changes.size) {
      item.append(el("div", { class: "muted", text: `대상 ${[...revision.changes.keys()].join(", ")}` }));
    }
    els.historyList.append(item);
  }
  els.historyActions.hidden = !state.historyPreview;
  if (state.historyPreview) {
    els.historyInfo.textContent += ` · 선택 ${state.historyPreview} (읽기 전용 미리보기)`;
  }
  els.undo.disabled = !history.head.parent || !canEdit();
  els.redo.disabled = history.childrenOf(history.headId).length === 0 || !canEdit();
  els.exportChanged.disabled = !state.workspace || state.workspace.assets.changedPaths().length === 0;
}

function renderBaseSelects() {
  const revisions = historyOptions();
  for (const select of [els.diffBase, els.onionBase]) {
    const value = select === els.diffBase ? state.view.diffBase : state.view.onionBase;
    select.replaceChildren();
    for (const revision of revisions) {
      select.append(el("option", { value: revision.id, text: revision.id === "r0" ? "최초 원본" : `${revision.id} · ${new Date(revision.timestamp).toLocaleTimeString()}` }));
    }
    select.value = value;
  }
}

// ---------- text ----------

let textTimer = null;
let viewSaveTimer = null;
function scheduleViewSave(reason = "view") {
  clearTimeout(viewSaveTimer);
  viewSaveTimer = setTimeout(() => persist(reason), 300);
}

function drawTextPreview() {
  if (!state.workspace) return;
  try {
    const draftRenderer = state.draft?.previewRenderer;
    if (state.draft) state.draft.previewAssets.get(state.draft.path).current = state.draft.draft.data;
    const result = renderText(state.workspace.declaration, draftRenderer ?? state.renderer, els.textInput.value);
    const scaled = scaleImage(result.image, Number(state.view.textZoom));
    drawImageToCanvas(els.textPreview, scaled, 1, true);
    els.textStatus.textContent = result.hasMappings
      ? result.unmapped.length ? `미매핑/대체 ${result.unmapped.length}개` : ""
      : "유니코드 매핑 없음";
    if (result.errors.length) els.textStatus.textContent = result.errors[0].message;
  } catch (error) {
    els.textStatus.textContent = error.message;
  }
}

function scheduleTextPreview() {
  clearTimeout(textTimer);
  textTimer = setTimeout(drawTextPreview, 120);
}

// ---------- rendering ----------

function updateToolAvailability() {
  const textureEditable = Boolean(ownInfo()?.ok) && !previewId();
  for (const button of document.querySelectorAll("[data-tool]")) {
    button.disabled = textureEditable ? state.view.ownHidden && button.dataset.tool !== "select" : true;
  }
  els.selectAll.disabled = !textureEditable;
  els.deleteSelection.disabled = !textureEditable || state.view.ownHidden;
}

function refreshAll() {
  if (!state.workspace) return;
  els.workspaceName.textContent = `${state.workspace.name} · ${state.workspace.fileName}`;
  els.zoom.value = String(state.view.zoom);
  els.gridToggle.checked = state.view.grid;
  els.ownHidden.checked = state.view.ownHidden;
  els.childrenHidden.checked = state.view.childrenHidden;
  els.diffToggle.checked = state.view.diff;
  els.onionToggle.checked = state.view.onion;
  els.onionOpacity.value = String(state.view.onionOpacity);
  els.textInput.value = state.view.text ?? DEFAULT_TEXT;
  els.textZoom.value = String(state.view.textZoom ?? 1);
  els.setSelect.value = state.set.id;
  els.mappedOnly.checked = state.set.mappedOnly;
  els.characterSearch.value = state.set.search ?? "";
  els.pageSize.value = String(state.set.pageSize ?? 128);
  for (const button of document.querySelectorAll("[data-tool]")) button.classList.toggle("active", button.dataset.tool === state.view.tool);
  updateToolAvailability();
  els.exportSingle.disabled = !ownInfo()?.ok;
  els.openSources.disabled = !state.workspace;
  els.exportAll.disabled = !state.workspace || state.workspace.assets.paths().length === 0;
  renderSetSelect();
  renderNavigator();
  renderGroupInfo();
  renderImpact();
  renderBaseSelects();
  renderHistory();
  drawBoard();
  drawContext();
  drawTextPreview();
  updateFontUi();
}

function updateFontUi() {
  els.shadowControls.hidden = !state.font;
  els.shadowToggle.disabled = !state.font;
  els.shadowToggle.checked = Boolean(state.shadow.visible);
  els.fontStatus.textContent = state.font ? state.font.name : "폰트 없음";
  els.shadowSize.value = String(state.shadow.size);
  els.shadowX.value = String(state.shadow.x);
  els.shadowY.value = String(state.shadow.y);
  els.shadowOpacity.value = String(state.shadow.opacity);
}

// ---------- editing ----------

function boardPoint(event) {
  const rect = els.board.getBoundingClientRect();
  const zoom = Number(state.view.zoom);
  return {
    x: Math.floor((event.clientX - rect.left) / zoom),
    y: Math.floor((event.clientY - rect.top) / zoom),
  };
}

function assetRect(selection, box) {
  return { x: box.x + selection.x, y: box.y + selection.y, width: selection.width, height: selection.height };
}

function beginDraft(bounds = null) {
  const info = ownInfo();
  if (!info?.ok) return null;
  const previewAssets = state.workspace.assets.clone();
  const draft = new PixelDraft(info.asset, bounds ?? info.box);
  return {
    draft,
    path: info.path,
    asset: info.asset,
    box: info.box,
    previewAssets,
    previewRenderer: new Renderer(state.workspace.declaration, previewAssets),
  };
}

function ownLayerWritable() {
  if (!state.view.ownHidden) return true;
  els.toolStatus.textContent = "자기 레이어를 숨긴 동안에는 그리기/지우기/이동을 할 수 없습니다";
  return false;
}

function commitDraft() {
  const current = state.draft;
  state.draft = null;
  if (!current) return;
  const changes = current.draft.changes();
  if (changes.length === 0) {
    drawBoard();
    drawContext();
    return;
  }
  const before = new Map([[current.path, current.draft.before]]);
  let revision = null;
  try {
    revision = state.workspace.history.commit(new Map([[current.path, changes]]), {
      kind: "pixels",
      start: state.selected ? { ...state.selected } : null,
    });
  } catch (error) {
    setStatus(error.message, "failed");
    drawBoard();
    return;
  }
  if (revision) {
    state.renderer.invalidate();
    state.baseCache.clear();
    computeImpact(revision);
    persist("revision");
  }
  drawBoard();
  drawContext();
  renderNavigator();
  renderHistory();
  drawTextPreview();
}

function cancelDraft() {
  if (!state.draft) return;
  state.draft = null;
  state.drag = null;
  state.keyMove = null;
  drawBoard();
  drawContext();
}

function startPaint(event, eraser = false) {
  if (previewId()) {
    els.toolStatus.textContent = "과거 이력 미리보기 중입니다. 미리보기를 닫거나 복원하세요";
    return;
  }
  if (!ensureEditable() || !ownLayerWritable()) return;
  const info = ownInfo();
  if (!info?.ok) return;
  const bounds = state.selection ? assetRect(state.selection, info.box) : info.box;
  const draft = beginDraft(bounds);
  if (!draft) return;
  const point = boardPoint(event);
  if (point.x < 0 || point.y < 0 || point.x >= currentGroup().width || point.y >= currentGroup().height) return;
  state.draft = draft;
  const ax = info.box.x + point.x;
  const ay = info.box.y + point.y;
  draft.draft.set(ax, ay, eraser ? ERASER : PENCIL);
  state.drag = { kind: "paint", last: point, eraser };
  els.board.setPointerCapture?.(event.pointerId);
  drawBoard();
}

function startSelection(event) {
  const group = currentGroup();
  if (!group) return;
  const info = ownInfo();
  if (!info?.ok) {
    els.toolStatus.textContent = info?.reason ?? "이 그룹은 선택할 수 없습니다";
    return;
  }
  const point = boardPoint(event);
  const x = Math.max(0, Math.min(group.width - 1, point.x));
  const y = Math.max(0, Math.min(group.height - 1, point.y));
  state.selection = { x, y, width: 1, height: 1 };
  state.drag = { kind: "select", start: { x, y } };
  els.board.setPointerCapture?.(event.pointerId);
  drawBoard();
}

function startMove(event) {
  if (previewId()) {
    els.toolStatus.textContent = "과거 이력 미리보기 중입니다. 미리보기를 닫거나 복원하세요";
    return;
  }
  const info = ownInfo();
  const selection = state.selection;
  if (!info?.ok || !selection) {
    els.toolStatus.textContent = selection ? "편집할 수 없습니다" : "먼저 영역을 선택하세요";
    return;
  }
  if (!ensureEditable() || !ownLayerWritable()) return;
  const draft = beginDraft();
  if (!draft) return;
  const point = boardPoint(event);
  state.draft = draft;
  state.drag = { kind: "move", start: point, selection: { ...selection } };
  els.board.setPointerCapture?.(event.pointerId);
  drawBoard();
}

function pointerMove(event) {
  if (!state.drag) return;
  if (state.drag.kind === "pan") {
    els.boardWrap.scrollLeft = state.drag.scrollLeft - (event.clientX - state.drag.startX);
    els.boardWrap.scrollTop = state.drag.scrollTop - (event.clientY - state.drag.startY);
    return;
  }
  const point = boardPoint(event);
  if (state.drag.kind === "paint" && state.draft) {
    const info = ownInfo();
    if (!info?.ok) return;
    state.draft.draft.line(
      info.box.x + state.drag.last.x,
      info.box.y + state.drag.last.y,
      info.box.x + point.x,
      info.box.y + point.y,
      state.drag.eraser ? ERASER : PENCIL,
    );
    state.drag.last = point;
    drawBoard();
    drawContext();
    scheduleTextPreview();
  } else if (state.drag.kind === "select") {
    const group = currentGroup();
    const x0 = Math.max(0, Math.min(group.width - 1, state.drag.start.x));
    const y0 = Math.max(0, Math.min(group.height - 1, state.drag.start.y));
    const x1 = Math.max(0, Math.min(group.width - 1, point.x));
    const y1 = Math.max(0, Math.min(group.height - 1, point.y));
    state.selection = { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0) + 1, height: Math.abs(y1 - y0) + 1 };
    drawBoard();
  } else if (state.drag.kind === "move" && state.draft) {
    const info = ownInfo();
    if (!info?.ok) return;
    const dx = point.x - state.drag.start.x;
    const dy = point.y - state.drag.start.y;
    const draft = new PixelDraft(info.asset, info.box);
    const moved = draft.move(assetRect(state.drag.selection, info.box), dx, dy);
    state.draft.draft = draft;
    state.drag.dx = moved.dx;
    state.drag.dy = moved.dy;
    drawBoard();
    drawContext();
    scheduleTextPreview();
  }
}

function pointerUp(event) {
  if (!state.drag) return;
  const drag = state.drag;
  state.drag = null;
  if (drag.kind === "pan") {
    els.board.releasePointerCapture?.(event.pointerId);
    return;
  }
  if (drag.kind === "paint" || drag.kind === "move") {
    if (drag.kind === "move" && state.selection && (drag.dx || drag.dy)) {
      state.selection = { ...state.selection, x: state.selection.x + (drag.dx ?? 0), y: state.selection.y + (drag.dy ?? 0) };
    }
    commitDraft();
  }
  els.board.releasePointerCapture?.(event.pointerId);
}

function eraseSelection() {
  const selection = state.selection;
  if (!selection) {
    els.toolStatus.textContent = "먼저 영역을 선택하세요";
    return;
  }
  if (previewId()) {
    els.toolStatus.textContent = "과거 이력 미리보기 중입니다. 미리보기를 닫거나 복원하세요";
    return;
  }
  if (!ensureEditable() || !ownLayerWritable()) return;
  const info = ownInfo();
  if (!info?.ok) return;
  const draft = beginDraft();
  if (!draft) return;
  draft.draft.fillRect(assetRect(selection, info.box), ERASER);
  state.draft = draft;
  commitDraft();
}

function useHistory(direction) {
  if (!ensureEditable()) return;
  cancelDraft();
  const revision = direction === "undo" ? state.workspace.history.undo() : state.workspace.history.redo();
  if (!revision) return;
  state.renderer.invalidate();
  state.baseCache.clear();
  state.selection = null;
  state.historyPreview = null;
  computeImpact(state.workspace.history.head);
  drawBoard();
  drawContext();
  renderNavigator();
  renderHistory();
  drawTextPreview();
  persist("history");
}

// ---------- source dialog ----------

function openSources() {
  if (!state.workspace) return;
  renderSourceTable();
  els.sourceDialog.showModal();
}

function renderSourceTable() {
  const rows = sourceRows(state.workspace.declaration, state.workspace.assets);
  const table = el("table");
  const header = el("tr");
  for (const label of ["셋", "소스", "선언 경로", "연결", "파일", "크기", "상태"]) header.append(el("th", { text: label }));
  table.append(el("thead", {}, header));
  const body = el("tbody");
  for (const row of rows) {
    const pick = el("button", { class: "small", text: "파일 선택", onclick: () => openManualLink(row.path) });
    const tr = el("tr");
    tr.append(
      el("td", { text: row.set }),
      el("td", { text: row.source }),
      el("td", { text: row.declaredPath }),
      el("td", {}, pick),
      el("td", { text: row.asset?.path ?? "—" }),
      el("td", { text: row.asset ? `${row.asset.width}×${row.asset.height}` : "—" }),
      el("td", { class: row.error ? "error" : "", text: row.error ?? row.status }),
    );
    body.append(tr);
  }
  table.append(body);
  els.sourceTable.replaceChildren(table);
}

function openManualLink(path) {
  if (!path) return;
  state.linkTarget = path;
  els.imageFile.click();
}

async function handleImages(files) {
  if (!state.workspace) return;
  cancelDraft();
  try {
    const result = await importImages(state.workspace.declaration, state.workspace.assets, files);
    let replaced = 0;
    if (result.replacements?.size) {
      const failed = [...result.replacements.entries()].filter(([, candidate]) => candidate.error);
      if (failed.length) {
        result.errors.push(...failed.map(([path, candidate]) => `${path}: ${candidate.error}`));
      } else {
        const ok = await confirmAction(`연결된 ${result.replacements.size}개 이미지를 현재 이미지로 교체할까요? 전체 차이가 하나의 되돌릴 수 있는 명령으로 기록됩니다.`);
        if (ok) {
          const before = state.workspace.assets.snapshot();
          const pairs = [...result.replacements.entries()].map(([path, candidate]) => ({ path, bytes: candidate.bytes }));
          await replaceAssets(state.workspace.declaration, state.workspace.assets, pairs);
          const changes = diffSnapshotToAssets(before, state.workspace.assets);
          if (changes.size) {
            const revision = state.workspace.history.commit(changes, { kind: "replace" }, { applied: true });
            state.renderer.invalidate();
            state.baseCache.clear();
            computeImpact(revision);
            persist("replace");
            replaced = result.replacements.size;
          }
        }
      }
    }
    if (result.linked.length) {
      state.renderer.invalidate();
      state.baseCache.clear();
      persist("link");
    }
    renderSourceTable();
    renderNavigator();
    drawBoard();
    drawContext();
    els.importReport.textContent = [
      result.linked.length ? `${result.linked.length}개 연결` : "",
      replaced ? `${replaced}개 교체` : "",
      result.unreferenced.length ? `미참조 ${result.unreferenced.length}개 제외` : "",
      result.skipped.length ? `건너뜀 ${result.skipped.length}개` : "",
      result.errors.length ? `오류 ${result.errors.length}개: ${result.errors.join(" / ")}` : "",
    ].filter(Boolean).join(" · ");
  } catch (error) {
    els.importReport.textContent = error.message;
  }
}

async function handleManualFile(file) {
  if (!state.linkTarget) return;
  cancelDraft();
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const existing = state.workspace.assets.get(state.linkTarget);
    if (existing) {
      const ok = await confirmAction("현재 이미지를 교체할까요? 차이는 하나의 되돌릴 수 있는 명령으로 기록됩니다.");
      if (!ok) return;
      const before = state.workspace.assets.snapshot();
      await replaceAssets(state.workspace.declaration, state.workspace.assets, [{ path: state.linkTarget, bytes }]);
      const changes = diffSnapshotToAssets(before, state.workspace.assets);
      if (changes.size) {
        const revision = state.workspace.history.commit(changes, { kind: "replace" }, { applied: true });
        computeImpact(revision);
        persist("replace");
      }
    } else {
      await manualLink(state.workspace.declaration, state.workspace.assets, state.linkTarget, bytes);
      persist("link");
    }
    state.renderer.invalidate();
    state.baseCache.clear();
    renderSourceTable();
    renderNavigator();
    drawBoard();
    drawContext();
  } catch (error) {
    els.importReport.textContent = error.message;
  }
  state.linkTarget = null;
}

// ---------- works ----------

async function openWorksList() {
  els.worksDialog.showModal();
  els.worksList.replaceChildren(el("div", { class: "muted", text: "불러오는 중…" }));
  try {
    const rows = await listWorkspaces();
    els.worksList.replaceChildren();
    if (rows.length === 0) {
      els.worksList.append(el("div", { class: "muted", text: "저장된 작업 없음" }));
      return;
    }
    for (const row of rows) {
      const item = el("div", { class: "list-item" },
        el("strong", { text: row.name }),
        el("div", { class: "muted", text: `${row.fileName} · ${row.images}개 이미지 · ${row.revisions} revisions` }),
        el("div", { class: "muted", text: new Date(row.updatedAt).toLocaleString() }),
      );
      const rowButtons = el("div", { class: "row wrap" });
      rowButtons.append(
        el("button", { class: "small", text: "열기", onclick: async () => {
          try {
            const workspace = await loadWorkspace(row.id);
            if (!workspace) throw new Error("작업을 찾지 못했습니다");
            if (state.storage.lock) state.storage.lock.release();
            els.worksDialog.close();
            adoptWorkspace(workspace, { restored: true });
          } catch (error) {
            setStatus(`작업을 열지 못했습니다: ${error.message}`, "failed");
          }
        } }),
        el("button", { class: "small", text: "이름 변경", onclick: async () => {
          const name = prompt("새 작업 이름", row.name);
          if (!name) return;
          try {
            await renameWorkspace(row.id, name);
            openWorksList();
          } catch (error) {
            setStatus(error.message, "failed");
          }
        } }),
        el("button", { class: "small danger", text: "삭제", onclick: async () => {
          const ok = await confirmAction(`"${row.name}" 작업을 삭제할까요? 이 작업의 선언/PNG/이력만 삭제됩니다.`);
          if (!ok) return;
          const deleting = state.workspace?.id === row.id ? state.workspace : null;
          if (deleting) deleting.deleted = true;
          try {
            await deleteWorkspace(row.id);
            if (deleting) {
              state.workspace = null;
              els.editor.hidden = true;
              els.emptyState.hidden = false;
            }
            openWorksList();
          } catch (error) {
            if (deleting) deleting.deleted = false;
            setStatus(error.message, "failed");
          }
        } }),
      );
      item.append(rowButtons);
      els.worksList.append(item);
    }
  } catch (error) {
    els.worksList.replaceChildren(el("div", { class: "error-text", text: error.message }));
  }
}

function confirmAction(message) {
  els.confirmMessage.textContent = message;
  return new Promise((resolve) => {
    const handler = () => {
      const ok = els.confirmDialog.returnValue === "ok";
      els.confirmDialog.removeEventListener("close", handler);
      resolve(ok);
    };
    els.confirmDialog.addEventListener("close", handler);
    els.confirmDialog.showModal();
  });
}

// ---------- export ----------

function download(name, bytes) {
  const blob = new Blob([bytes], { type: name.endsWith(".png") ? "image/png" : "application/zip" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function doExportSingle() {
  const info = ownInfo();
  if (!info?.ok) return;
  try {
    const result = await exportSingle(state.workspace.assets, info.path);
    download(result.name, result.bytes);
  } catch (error) {
    setStatus(error.message, "failed");
  }
}

async function doExportZip(kind) {
  try {
    const result = kind === "changed"
      ? await exportChanged(state.workspace.assets, state.workspace.name)
      : await exportAll(state.workspace.assets, state.workspace.name);
    download(result.name, result.bytes);
  } catch (error) {
    setStatus(error.message, "failed");
  }
}

// ---------- events ----------

function bindEvents() {
  els.openDeclaration.addEventListener("click", () => els.declarationFile.click());
  els.emptyOpenDeclaration.addEventListener("click", () => els.declarationFile.click());
  els.declarationFile.addEventListener("change", async () => {
    const file = els.declarationFile.files?.[0];
    els.declarationFile.value = "";
    if (file) await openDeclarationFile(file);
  });
  els.openWorks.addEventListener("click", openWorksList);
  els.emptyOpenWorks.addEventListener("click", openWorksList);
  els.worksClose.addEventListener("click", () => els.worksDialog.close());
  els.openSources.addEventListener("click", openSources);
  els.importImages.addEventListener("click", () => els.imageFile.click());
  els.imageFile.addEventListener("change", async () => {
    const files = [...(els.imageFile.files ?? [])];
    els.imageFile.value = "";
    if (state.linkTarget) await handleManualFile(files[0]);
    else await handleImages(files);
  });

  els.setSelect.addEventListener("change", () => {
    state.set.id = els.setSelect.value;
    state.set.page = 0;
    state.set.search = "";
    els.characterSearch.value = "";
    renderNavigator();
    scheduleViewSave();
  });
  els.mappedOnly.addEventListener("change", () => {
    state.set.mappedOnly = els.mappedOnly.checked;
    state.set.page = 0;
    renderNavigator();
    scheduleViewSave();
  });
  els.characterSearch.addEventListener("input", () => {
    state.set.search = els.characterSearch.value;
    state.set.page = 0;
    renderNavigator();
    scheduleViewSave();
  });
  els.pageSize.addEventListener("change", () => {
    state.set.pageSize = Number(els.pageSize.value);
    state.set.page = 0;
    renderNavigator();
    scheduleViewSave();
  });
  els.pageFirst.addEventListener("click", () => { state.set.page = 0; renderNavigator(); scheduleViewSave(); });
  els.pagePrev.addEventListener("click", () => { state.set.page = Math.max(0, state.set.page - 1); renderNavigator(); scheduleViewSave(); });
  els.pageNext.addEventListener("click", () => { state.set.page += 1; renderNavigator(); scheduleViewSave(); });
  els.pageLast.addEventListener("click", () => { state.set.page = 1e9; renderNavigator(); scheduleViewSave(); });
  els.pageInput.addEventListener("change", () => { state.set.page = Math.max(0, Number(els.pageInput.value) - 1); renderNavigator(); scheduleViewSave(); });
  els.groupSearch.addEventListener("input", renderNavigator);
  for (const input of document.querySelectorAll("[data-usage-search]")) {
    input.addEventListener("input", () => {
      state.usageQuery[input.dataset.usageSearch] = input.value;
      state.impactPage = { ...(state.impactPage ?? {}), [input.dataset.usageSearch]: 0 };
      renderImpact();
    });
  }
  els.globalSearch.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !state.workspace) return;
    const found = findGroupGlyphByText(state.workspace.declaration, els.globalSearch.value);
    if (found?.error) {
      els.globalError.textContent = found.error;
      return;
    }
    if (found?.group) {
      els.globalError.textContent = "";
      selectGlyph(found.group, found.index, { codepoint: found.codepoint ?? null, keepContext: found.codepoint == null });
      return;
    }
    const scalars = [...els.globalSearch.value];
    if (scalars.length > 0) {
      els.globalError.textContent = "";
      els.characterSearch.value = els.globalSearch.value;
      state.set.search = els.globalSearch.value;
      state.set.page = 0;
      renderNavigator();
    } else els.globalError.textContent = "이동할 대상을 찾지 못했습니다";
  });

  els.toolbar.addEventListener("click", (event) => {
    const tool = event.target.closest("[data-tool]")?.dataset.tool;
    if (!tool) return;
    cancelDraft();
    state.view.tool = tool;
    for (const button of document.querySelectorAll("[data-tool]")) button.classList.toggle("active", button.dataset.tool === tool);
    drawBoard();
    persist("view");
  });
  els.zoom.addEventListener("change", () => { state.view.zoom = Number(els.zoom.value); persist("view"); drawBoard(); });
  els.gridToggle.addEventListener("change", () => { state.view.grid = els.gridToggle.checked; persist("view"); drawBoard(); });
  els.ownHidden.addEventListener("change", () => { state.view.ownHidden = els.ownHidden.checked; updateToolAvailability(); persist("view"); drawBoard(); });
  els.childrenHidden.addEventListener("change", () => { state.view.childrenHidden = els.childrenHidden.checked; persist("view"); drawBoard(); });
  els.selectAll.addEventListener("click", () => {
    const group = currentGroup();
    if (!group || !ownInfo()?.ok) return;
    state.selection = { x: 0, y: 0, width: group.width, height: group.height };
    drawBoard();
  });
  els.clearSelection.addEventListener("click", () => { state.selection = null; drawBoard(); });
  els.deleteSelection.addEventListener("click", eraseSelection);
  els.undo.addEventListener("click", () => useHistory("undo"));
  els.redo.addEventListener("click", () => useHistory("redo"));
  els.indexPrev.addEventListener("click", () => selectGlyph(state.selected.group, state.selected.index - 1, { keepContext: true }));
  els.indexNext.addEventListener("click", () => selectGlyph(state.selected.group, state.selected.index + 1, { keepContext: true }));
  els.indexInput.addEventListener("change", () => selectGlyph(state.selected.group, Number(els.indexInput.value), { keepContext: true }));

  els.diffToggle.addEventListener("change", () => { state.view.diff = els.diffToggle.checked; drawBoard(); drawContext(); persist("view"); });
  els.onionToggle.addEventListener("change", () => { state.view.onion = els.onionToggle.checked; drawBoard(); drawContext(); persist("view"); });
  els.diffBase.addEventListener("change", () => { state.view.diffBase = els.diffBase.value; drawBoard(); drawContext(); persist("view"); });
  els.onionBase.addEventListener("change", () => { state.view.onionBase = els.onionBase.value; drawBoard(); drawContext(); persist("view"); });
  els.onionOpacity.addEventListener("input", () => { state.view.onionOpacity = Number(els.onionOpacity.value); drawBoard(); drawContext(); persist("view"); });
  els.textInput.addEventListener("input", () => { state.view.text = els.textInput.value; scheduleTextPreview(); });
  els.textPreset.addEventListener("change", () => {
    if (!els.textPreset.value) return;
    els.textInput.value = els.textPreset.value;
    state.view.text = els.textInput.value;
    scheduleTextPreview();
  });
  els.textZoom.addEventListener("change", () => { state.view.textZoom = Number(els.textZoom.value); drawTextPreview(); });

  els.loadFont.addEventListener("click", () => els.fontFile.click());
  els.fontFile.addEventListener("change", async () => {
    const file = els.fontFile.files?.[0];
    els.fontFile.value = "";
    if (!file || !state.workspace) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const font = await loadFont(state.workspace, bytes, file.name);
      if (!state.font) state.shadow.size = defaultShadowSize();
      font.settings = { ...font.settings, ...state.shadow };
      state.font = font;
      state.shadow = clampShadowSettings(font.settings);
      updateFontUi();
      drawContext();
      persist("font");
    } catch (error) {
      els.fontStatus.textContent = error.message;
    }
  });
  for (const [input, key] of [[els.shadowSize, "size"], [els.shadowX, "x"], [els.shadowY, "y"], [els.shadowOpacity, "opacity"]]) {
    input.addEventListener("change", () => {
      state.shadow = clampShadowSettings({ ...state.shadow, [key]: Number(input.value), visible: state.shadow.visible });
      state.font.settings = { ...state.shadow };
      updateFontUi();
      drawContext();
      persist("font");
    });
  }
  els.shadowToggle.addEventListener("change", () => {
    state.shadow.visible = els.shadowToggle.checked;
    if (state.font) state.font.settings = { ...state.shadow };
    drawContext();
    persist("font");
  });

  els.exportSingle.addEventListener("click", doExportSingle);
  els.exportChanged.addEventListener("click", () => doExportZip("changed"));
  els.exportAll.addEventListener("click", () => doExportZip("all"));

  els.restoreRevision.addEventListener("click", async () => {
    if (!state.historyPreview || !ensureEditable()) return;
    const ok = await confirmAction("모든 PNG 자산을 선택한 revision 상태로 복원할까요? 현재 이력 뒤에 새 복원 명령이 추가됩니다.");
    if (!ok) return;
    cancelDraft();
    const revision = state.workspace.history.restore(state.historyPreview);
    if (revision) {
      state.renderer.invalidate();
      state.baseCache.clear();
      state.historyPreview = null;
      state.selection = null;
      computeImpact(revision);
      persist("restore");
      refreshAll();
    }
  });
  els.diffUseRevision.addEventListener("click", () => {
    if (!state.historyPreview) return;
    state.view.diff = true;
    state.view.diffBase = state.historyPreview;
    refreshAll();
    persist("view");
  });
  els.onionUseRevision.addEventListener("click", () => {
    if (!state.historyPreview) return;
    state.view.onion = true;
    state.view.onionBase = state.historyPreview;
    refreshAll();
    persist("view");
  });

  els.clearPreview.addEventListener("click", () => {
    state.historyPreview = null;
    renderHistory();
    updateToolAvailability();
    computeImpact(state.workspace.history.head);
    drawBoard();
    drawContext();
  });

  els.board.addEventListener("pointerdown", (event) => {
    els.board.focus();
    if (state.space && event.button === 0) {
      state.drag = {
        kind: "pan",
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: els.boardWrap.scrollLeft,
        scrollTop: els.boardWrap.scrollTop,
      };
      els.board.setPointerCapture?.(event.pointerId);
      return;
    }
    if (event.button === 2) {
      startPaint(event, true);
      return;
    }
    if (event.button !== 0) return;
    if (state.view.tool === "select") startSelection(event);
    else if (state.view.tool === "move") startMove(event);
    else startPaint(event, state.view.tool === "eraser");
  });
  els.board.addEventListener("pointermove", pointerMove);
  els.board.addEventListener("pointerup", pointerUp);
  els.board.addEventListener("pointercancel", () => { state.drag = null; cancelDraft(); drawBoard(); });
  els.board.addEventListener("contextmenu", (event) => event.preventDefault());
  els.board.addEventListener("keydown", boardKeydown);
  els.board.addEventListener("keyup", boardKeyup);
  els.board.addEventListener("blur", () => { if (state.keyMove) commitKeyMove(); });

  window.addEventListener("keydown", (event) => {
    if (!state.workspace) return;
    const inField = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
    if (inField) return;
    if (event.code === "Space") {
      state.space = true;
      if (document.activeElement === els.board) event.preventDefault();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      persist("manual");
    }
  });
  window.addEventListener("keyup", (event) => {
    if (event.code === "Space") state.space = false;
  });
  window.addEventListener("blur", () => { state.space = false; });
  window.addEventListener("pagehide", () => state.storage.lock?.release());
}

function boardKeydown(event) {
  if (!state.workspace) return;
  const key = event.key;
  const ctrl = event.ctrlKey || event.metaKey;
  if (ctrl && key.toLowerCase() === "z") {
    event.preventDefault();
    useHistory(event.shiftKey ? "redo" : "undo");
    return;
  }
  if (ctrl && key.toLowerCase() === "a") {
    event.preventDefault();
    const group = currentGroup();
    if (group) state.selection = { x: 0, y: 0, width: group.width, height: group.height };
    drawBoard();
    return;
  }
  if (ctrl && key.toLowerCase() === "s") {
    event.preventDefault();
    persist("manual");
    return;
  }
  if (key === "Escape") {
    event.preventDefault();
    if (state.draft) cancelDraft();
    else { state.selection = null; drawBoard(); }
    return;
  }
  if (key === "Delete" || key === "Backspace") {
    event.preventDefault();
    eraseSelection();
    return;
  }
  if (["b", "e", "s", "v"].includes(key.toLowerCase()) && !ctrl) {
    cancelDraft();
    state.view.tool = { b: "pencil", e: "eraser", s: "select", v: "move" }[key.toLowerCase()];
    for (const button of document.querySelectorAll("[data-tool]")) button.classList.toggle("active", button.dataset.tool === state.view.tool);
    drawBoard();
    return;
  }
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key) && state.view.tool === "move" && state.selection) {
    event.preventDefault();
    if (previewId()) return;
    const info = ownInfo();
    if (!info?.ok || !ensureEditable() || !ownLayerWritable()) return;
    if (!state.keyMove) state.keyMove = { dx: 0, dy: 0, selection: { ...state.selection } };
    if (key === "ArrowLeft") state.keyMove.dx -= 1;
    if (key === "ArrowRight") state.keyMove.dx += 1;
    if (key === "ArrowUp") state.keyMove.dy -= 1;
    if (key === "ArrowDown") state.keyMove.dy += 1;
    const draft = new PixelDraft(info.asset, info.box);
    const moved = draft.move(assetRect(state.keyMove.selection, info.box), state.keyMove.dx, state.keyMove.dy);
    state.keyMove.dx = moved.dx;
    state.keyMove.dy = moved.dy;
    state.draft = {
      draft,
      path: info.path,
      asset: info.asset,
      box: info.box,
      previewAssets: state.workspace.assets.clone(),
      previewRenderer: null,
    };
    state.draft.previewRenderer = new Renderer(state.workspace.declaration, state.draft.previewAssets);
    drawBoard();
  }
}

function boardKeyup(event) {
  if (state.keyMove && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) commitKeyMove();
}

function commitKeyMove() {
  const move = state.keyMove;
  state.keyMove = null;
  if (!move || !state.draft) return;
  if (move.dx || move.dy) state.selection = { ...move.selection, x: move.selection.x + move.dx, y: move.selection.y + move.dy };
  commitDraft();
}

refreshAllInitial();

function refreshAllInitial() {
  renderSetSelect();
  els.characterGrid.replaceChildren(el("div", { class: "muted", text: "선언을 여세요" }));
  els.undo.disabled = true;
  els.redo.disabled = true;
  bindEvents();
  setInterval(() => {
    if (!state.workspace || !state.storage.readOnly || !state.storage.lock?.tryAcquire()) return;
    state.storage.readOnly = false;
    setStatus("브라우저에 저장됨", "saved");
    refreshAll();
  }, 5000);
}

// Expose a tiny deterministic hook for browser integration tests without
// making the modules depend on the test harness.
globalThis.__editor = {
  state,
  selectGlyph,
  refreshAll,
  openDeclarationText: async (text, fileName = "test.json") => {
    const declaration = parseDeclaration(text, { fileName });
    const workspace = newWorkspace(declaration, text, fileName);
    state.workspace = workspace;
    if (state.storage.lock) state.storage.lock.release();
    adoptWorkspace(workspace);
  },
  commitDraft,
  startPaint,
  drawBoard,
};
