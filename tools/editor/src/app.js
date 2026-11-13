import { parseDeclaration, findGroupGlyphByText, cropBox } from "./declaration.js";
import { AssetStore, blankTexture, sourcePath, sourceRows } from "./assets.js";
import {
  Renderer,
  buildLayerTree,
  flattenLayers,
  diffImages,
} from "./compose.js";
import { History } from "./history.js";
import { PixelDraft, ERASER, PENCIL, diffSnapshotToAssets } from "./pixels.js";
import { importImages, manualLink, replaceAssets } from "./importer.js";
import { exportAll, exportChanged, exportSingle } from "./exporter.js";
import { exportProject, importProject } from "./project.js";
import {
  BUILT_IN_SETS,
  characterDisplay,
  charactersForSet,
  codepointLabel,
  discoverSets,
  filterCharacters,
  isBlankCharacter,
  paginate,
} from "./unicode-sets.js";
import { renderText } from "./text.js";
import { loadFont, clampShadowSettings, normalizeShadowPresets } from "./font.js";
import { applyStatic, getLanguage, initLanguage, setLanguage, t } from "./i18n.js";
import {
  WorkspaceLock,
  deleteWorkspace,
  listWorkspaces,
  loadWorkspace,
  renameWorkspace,
  saveWorkspace,
} from "./persistence.js";

const $ = (selector) => document.querySelector(selector);
const DEFAULT_TEXT = "다람쥐 헌 쳇바퀴에 타고파.";
const SET_KEYS = {
  current: "sets.current",
  ascii: "sets.ascii",
  latin1: "sets.latin1",
  "hangul-compat": "sets.hangulCompat",
  "hangul-syllables": "sets.hangulSyllables",
  ksx1001: "sets.ksx1001",
  arrows: "sets.arrows",
  currency: "sets.currency",
};

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
    childFilter: true,
    navHidden: false,
    inspectorHidden: false,
    characterGridCollapsed: false,
    groupGridCollapsed: false,
    diff: false,
    onion: false,
    diffBase: "r0",
    onionBase: "r0",
    onionOpacity: 0.25,
    text: DEFAULT_TEXT,
    textZoom: 4,
  },
  selection: null,
  groupGlyphPage: 0,
  groupGlyphAnchor: null,
  clipboard: null,
  draft: null,
  drag: null,
  keyMove: null,
  space: false,
  antialias: true,
  storage: { reading: false, blocked: false, temp: false, readOnly: false, lock: null },
  saveQueue: Promise.resolve(),
  saveToken: 0,
  historyPreview: null,
  usageQuery: {},
  font: null,
  shadow: { visible: false, size: 16, x: 0, y: 0, opacity: 0.25 },
  linkTarget: null,
  baseCache: new Map(),
  lastFocused: null,
};

const els = {
  topbar: $("#topbar"),
  layout: $("#layout"),
  toggleNav: $("#toggle-nav"),
  toggleInspector: $("#toggle-inspector"),
  openSettings: $("#open-settings"),
  settingsDialog: $("#settings-dialog"),
  settingsClose: $("#settings-close"),
  settingsLanguage: $("#settings-language"),
  settingsAntialias: $("#settings-antialias"),
  themeToggle: $("#theme-toggle"),
  fileMenuButton: $("#file-menu-button"),
  fileMenu: $("#file-menu"),
  openDeclaration: $("#open-declaration"),
  emptyOpenDeclaration: $("#empty-open-declaration"),
  emptyOpenPresets: $("#empty-open-presets"),
  openPresets: $("#open-presets"),
  presetDialog: $("#preset-dialog"),
  presetClose: $("#preset-close"),
  presetReport: $("#preset-report"),
  openProject: $("#open-project"),
  projectFile: $("#project-file"),
  exportProject: $("#export-project"),
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
  toggleCharacterGrid: $("#toggle-character-grid"),
  pageControls: $("#page-controls"),
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
  toggleGroupGrid: $("#toggle-group-grid"),
  groupGlyphSection: $("#group-glyph-section"),
  groupGlyphGrid: $("#group-glyph-grid"),
  groupGlyphPager: $("#group-glyph-pager"),
  groupGlyphPage: $("#group-glyph-page"),
  groupGlyphPrev: $("#group-glyph-prev"),
  groupGlyphNext: $("#group-glyph-next"),
  toolbar: $("#toolbar"),
  zoom: $("#zoom"),
  gridToggle: $("#grid-toggle"),
  selectAll: $("#select-all"),
  clearSelection: $("#clear-selection"),
  deleteSelection: $("#delete-selection"),
  copySelection: $("#copy-selection"),
  pasteSelection: $("#paste-selection"),
  undo: $("#undo"),
  redo: $("#redo"),
  toolStatus: $("#tool-status"),
  editingBadge: $("#editing-badge"),
  board: $("#board"),
  boardWrap: $("#board-wrap"),
  ownHidden: $("#own-hidden"),
  childrenHidden: $("#children-hidden"),
  selectionStatus: $("#selection-status"),
  contextLabel: $("#context-label"),
  context: $("#context"),
  childStrip: $("#child-strip"),
  groupDetail: $("#group-detail"),
  groupIndexControls: $("#group-index-controls"),
  indexPrev: $("#index-prev"),
  indexInput: $("#index-input"),
  indexCount: $("#index-count"),
  indexNext: $("#index-next"),
  textureInfo: $("#texture-info"),
  childFilter: $("#child-filter"),
  childInfo: $("#child-info"),
  structuralUsage: $("#structural-usage"),
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
  shadowSizeValue: $("#shadow-size-value"),
  shadowX: $("#shadow-x"),
  shadowXValue: $("#shadow-x-value"),
  shadowY: $("#shadow-y"),
  shadowYValue: $("#shadow-y-value"),
  shadowOpacity: $("#shadow-opacity"),
  shadowOpacityValue: $("#shadow-opacity-value"),
  shadowPresetName: $("#shadow-preset-name"),
  saveShadowPreset: $("#save-shadow-preset"),
  shadowPresetList: $("#shadow-preset-list"),
  textPreset: $("#text-preset"),
  textInput: $("#text-input"),
  textZoom: $("#text-zoom"),
  textStatus: $("#text-status"),
  textPreview: $("#text-preview"),
  textPreviewOpen: $("#text-preview-open"),
  textPreviewDialog: $("#text-preview-dialog"),
  textPreviewLarge: $("#text-preview-large"),
  textPreviewClose: $("#text-preview-close"),
  textPreviewSize: $("#text-preview-size"),
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
  recordsDialog: $("#records-dialog"),
  recordsTabs: $("#records-tabs"),
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

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

const STATUS_ICONS = { saving: "status-saving", saved: "status-saved", failed: "status-failed", temp: "status-temp", "": "status-idle" };
const ANTIALIAS_KEY = "declarative-font-editor-antialias";

function applyAntialiasSetting(persist = true) {
  document.documentElement.dataset.antialias = state.antialias ? "on" : "off";
  if (els.settingsAntialias) els.settingsAntialias.checked = state.antialias;
  if (!persist) return;
  try {
    localStorage.setItem(ANTIALIAS_KEY, String(state.antialias));
  } catch {
    // Preview preference is optional.
  }
}

function setAntialias(enabled) {
  state.antialias = Boolean(enabled);
  applyAntialiasSetting();
  if (state.workspace) refreshAll();
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString(getLanguage() === "ko" ? "ko-KR" : "en-US");
}

function setStatus(text, kind = "") {
  els.saveStatus.replaceChildren(icon(STATUS_ICONS[kind] ?? "status-idle"));
  els.saveStatus.className = `status-icon ${kind}`;
  els.saveStatus.title = text;
  els.saveStatus.setAttribute("aria-label", text);
}

function applyLanguage() {
  applyStatic();
  els.settingsLanguage.value = getLanguage();
  if (!state.workspace) {
    renderSetSelect();
    els.characterGrid.replaceChildren(el("div", { class: "muted", text: t("nav.emptySet") }));
    return;
  }
  refreshAll();
  renderHistory();
  if (els.sourceDialog.open) renderSourceTable();
  if (els.recordsDialog.open) {
    const worksTab = els.recordsTabs.querySelector('[data-records-tab="works"]');
    if (worksTab?.classList.contains("active")) loadWorksList();
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  els.themeToggle.replaceChildren(icon(theme === "dark" ? "sun" : "moon"));
  try {
    localStorage.setItem("declarative-font-editor-theme", theme);
  } catch {
    // Theme preference is optional.
  }
  if (state.workspace) {
    renderNavigator();
    if (state.selected) {
      renderGroupInfo();
      renderChildStrip(currentGroup(), state.selected.index);
    }
    renderHistory();
    drawBoard();
    drawContext();
    drawTextPreview();
  }
}

function applyLayout() {
  els.layout.classList.toggle("hide-left", Boolean(state.view.navHidden));
  els.layout.classList.toggle("hide-right", Boolean(state.view.inspectorHidden));
  els.toggleNav.classList.toggle("active", Boolean(state.view.navHidden));
  els.toggleInspector.classList.toggle("active", Boolean(state.view.inspectorHidden));
}

function setRecordsTab(tab) {
  for (const button of els.recordsTabs.querySelectorAll("[data-records-tab]")) {
    button.classList.toggle("active", button.dataset.recordsTab === tab);
  }
  for (const panel of els.recordsDialog.querySelectorAll("[data-records-panel]")) {
    panel.hidden = panel.dataset.recordsPanel !== tab;
  }
  if (tab === "history") renderHistory();
}

function openRecords(tab = "works") {
  if (!els.recordsDialog.open) els.recordsDialog.showModal();
  setRecordsTab(tab);
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
  if (!group.texture) return { ok: false, reason: t("status.noTexture") };
  const resolved = sourcePath(state.workspace.declaration, group.texture.set, group.texture.source);
  if (resolved.error) return { ok: false, reason: resolved.error };
  const asset = state.workspace.assets.get(resolved.path);
  if (!asset) return { ok: false, reason: t("status.resourceMissing", { path: resolved.path }), path: resolved.path };
  const box = cropBox(group, index);
  if (box.x < 0 || box.y < 0 || box.x + box.width > asset.width || box.y + box.height > asset.height) {
    return { ok: false, reason: t("status.cropError"), path: resolved.path, asset, box };
  }
  return { ok: true, asset, path: resolved.path, box };
}

function canEdit() {
  return state.workspace && !state.storage.readOnly && !state.storage.blocked;
}

function ensureEditable() {
  if (!state.workspace) return false;
  if (state.storage.readOnly) {
    els.toolStatus.textContent = t("status.lockReadOnly");
    return false;
  }
  if (state.storage.blocked) {
    els.toolStatus.textContent = t("status.blocked");
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
    childFilter: true,
    navHidden: false,
    inspectorHidden: false,
    characterGridCollapsed: false,
    groupGridCollapsed: false,
    diff: false,
    onion: false,
    diffBase: "r0",
    onionBase: "r0",
    onionOpacity: 0.25,
    text: DEFAULT_TEXT,
    textZoom: 4,
  };
}

function newWorkspace(declaration, text, fileName) {
  const id = globalThis.crypto?.randomUUID?.() ?? `w-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const assets = new AssetStore();
  const chosen = [...declaration.unicodeMap.entries()].sort((a, b) => a[0] - b[0])[0];
  const firstGroup = declaration.groups.keys().next().value ?? null;
  const name = declaration.metadata.get("name") || fileName.replace(/\.json$/i, "") || t("works.new");
  const workspace = {
    id,
    name,
    fileName,
    declaration,
    assets,
    history: new History(assets),
    view: defaultView(declaration),
    font: null,
    shadowPresets: [],
    createdAt: Date.now(),
  };
  if (chosen) state.context = { codepoint: chosen[0], group: chosen[1].group, index: chosen[1].index };
  else state.context = null;
  state.selected = chosen ? { group: chosen[1].group, index: chosen[1].index } : firstGroup ? { group: firstGroup, index: 0 } : null;
  return workspace;
}

function adoptWorkspace(workspace, { restored = false } = {}) {
  workspace.shadowPresets = normalizeShadowPresets(workspace.shadowPresets);
  state.workspace = workspace;
  state.renderer = new Renderer(workspace.declaration, workspace.assets);
  state.view = { ...defaultView(workspace.declaration), ...(workspace.view ?? {}) };
  state.view.hidden = new Set(state.view.hidden ?? []);
  state.selected = null;
  state.context = null;
  state.selection = null;
  state.draft = null;
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
  setStatus(state.storage.readOnly ? t("status.readOnly") : restored ? t("status.saved") : t("status.unchanged"), restored ? "saved" : "");
  persist("open");
}

async function restoreLastWorkspace() {
  if (state.workspace) return;
  try {
    const [latest] = await listWorkspaces();
    if (!latest || state.workspace) return;
    const workspace = await loadWorkspace(latest.id);
    if (!workspace || state.workspace) return;
    adoptWorkspace(workspace, { restored: true });
  } catch (error) {
    setStatus(t("status.openFailed", { message: error.message }), "failed");
  }
}

async function openProjectFile(file) {
  try {
    const project = await importProject(new Uint8Array(await file.arrayBuffer()));
    const workspace = newWorkspace(project.declaration, project.declarationText, project.fileName);
    workspace.name = project.name;
    workspace.assets = project.assets;
    workspace.history = project.history;
    workspace.view = project.view;
    workspace.shadowPresets = project.shadowPresets;
    state.workspace = workspace;
    if (state.storage.lock) state.storage.lock.release();
    adoptWorkspace(workspace, { restored: true });
  } catch (error) {
    setStatus(t("status.projectFailed", { message: error.message }), "failed");
    els.globalError.textContent = error.message;
  }
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
    setStatus(t("status.openFailed", { message: error.message }), "failed");
    els.globalError.textContent = error.message;
  }
}

const PRESETS = {
  ascii: {
    fileName: "ascii.json",
    declaration: "presets/ascii.json",
    textures: ["presets/ascii.png"],
  },
  hangul: {
    fileName: "hangul.json",
    declaration: "presets/hangul.json",
    textures: ["presets/ascii.png", "presets/hangul.png"],
  },
};

async function fetchPresetFile(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response;
}

function showPresetDialog() {
  els.presetReport.className = "muted";
  els.presetReport.textContent = "";
  els.presetDialog.showModal();
}

async function openPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  const cards = [...document.querySelectorAll("[data-preset]")];
  cards.forEach((card) => { card.disabled = true; });
  els.presetReport.className = "muted";
  els.presetReport.textContent = t("presets.loading");
  const previous = { selected: state.selected, context: state.context };
  try {
    const text = await (await fetchPresetFile(preset.declaration)).text();
    const declaration = parseDeclaration(text, { fileName: preset.fileName });
    const workspace = newWorkspace(declaration, text, preset.fileName);
    const files = [];
    for (const path of preset.textures) {
      const buffer = await (await fetchPresetFile(path)).arrayBuffer();
      files.push(new File([buffer], path.slice(path.lastIndexOf("/") + 1), { type: "image/png" }));
    }
    const result = await importImages(declaration, workspace.assets, files);
    if (result.errors.length) throw new Error(result.errors.join(" / "));
    if (result.linked.length !== files.length) throw new Error(t("presets.incomplete"));
    if (state.storage.lock) state.storage.lock.release();
    state.workspace = workspace;
    els.presetDialog.close();
    adoptWorkspace(workspace);
  } catch (error) {
    state.selected = previous.selected;
    state.context = previous.context;
    els.presetReport.className = "muted error";
    els.presetReport.textContent = t("presets.failed", { message: error.message });
  } finally {
    cards.forEach((card) => { card.disabled = false; });
  }
}

async function persist(reason = "edit") {
  if (!state.workspace) return;
  if (state.storage.temp) {
    setStatus(t("status.temp"), "temp");
    return;
  }
  if (state.storage.readOnly) {
    setStatus(t("status.readOnly"), "saved");
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
  setStatus(t("status.saving"), "saving");
  state.saveQueue = state.saveQueue
    .then(() => {
      if (workspace.deleted) return null;
      return saveWorkspace(workspace);
    })
    .then(() => {
      if (token !== state.saveToken) return;
      state.storage.blocked = false;
      setStatus(t("status.saved"), "saved");
      updateToolAvailability();
    })
    .catch((error) => {
      if (token !== state.saveToken) return;
      state.storage.blocked = true;
      setStatus(t("status.failed", { message: error.message }), "failed");
      updateToolAvailability();
      showSaveFailure();
    });
  await state.saveQueue;
}

function showSaveFailure() {
  const status = els.saveStatus;
  status.title = t("status.blocked");
  if ($("#retry-save")) return;
  const retry = el("button", { id: "retry-save", class: "small", text: t("status.retry"), onclick: () => { $("#retry-save")?.remove(); persist("retry"); } });
  const temp = el("button", { id: "temp-save", class: "small", text: t("status.tempAction"), onclick: () => {
    state.storage.temp = true;
    state.storage.blocked = false;
    $("#retry-save")?.remove();
    $("#temp-save")?.remove();
    updateToolAvailability();
    setStatus(t("status.temp"), "temp");
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
    drawBoard();
    drawContext();
  } catch (error) {
    els.fontStatus.textContent = error.message;
  }
}

// ---------- navigation ----------

const GROUP_GLYPH_PAGE_SIZE = 32;

function renderSetSelect() {
  els.setSelect.replaceChildren();
  if (!state.workspace) return;
  for (const set of discoverSets(state.workspace.declaration)) {
    const name = t(SET_KEYS[set.id] ?? set.id);
    els.setSelect.append(el("option", { value: set.id, text: `${name} (${set.mapped}/${set.all})` }));
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

function applyGridVisibility() {
  const characterCollapsed = Boolean(state.view.characterGridCollapsed);
  const groupCollapsed = Boolean(state.view.groupGridCollapsed);
  els.characterGrid.hidden = characterCollapsed;
  els.pageControls.hidden = characterCollapsed;
  els.toggleCharacterGrid.setAttribute("aria-expanded", String(!characterCollapsed));
  els.toggleCharacterGrid.querySelector(".collapse-label").textContent = t(characterCollapsed ? "nav.expand" : "nav.collapse");
  els.groupGlyphGrid.hidden = groupCollapsed;
  if (groupCollapsed) els.groupGlyphPager.hidden = true;
  els.toggleGroupGrid.setAttribute("aria-expanded", String(!groupCollapsed));
  els.toggleGroupGrid.querySelector(".collapse-label").textContent = t(groupCollapsed ? "nav.expand" : "nav.collapse");
}

function renderNavigator() {
  if (!state.workspace) return;
  applyGridVisibility();
  renderSetSelect();
  const items = navigatorCharacters();
  const page = paginate(items, state.set.page, state.set.pageSize);
  state.set.page = page.page;
  const all = discoverSets(state.workspace.declaration).find((set) => set.id === state.set.id);
  els.setSummary.textContent = all ? t("nav.mappedSummary", { mapped: all.mapped, all: all.all }) : "";
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
      fitImageToCanvas(thumb, result.image, 26);
      if (result.errors.length) {
        thumb.title = result.errors[0].message;
        slot.classList.add("has-error");
        slot.append(el("span", { class: "cp", text: t("nav.resourceError") }));
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
      slot.append(el("span", { class: "cp", text: t("nav.unmapped") }));
      slot.addEventListener("click", () => {
        state.selected = null;
        state.context = null;
        state.selection = null;
        els.toolStatus.textContent = t("nav.unmappedStatus", { cp: codepointLabel(cp) });
        drawBoard();
        drawContext();
        renderGroupInfo();
      });
    }
    els.characterGrid.append(slot);
  }
  if (page.items.length === 0) els.characterGrid.append(el("div", { class: "muted", text: t("nav.noResults") }));

  els.groupList.replaceChildren();
  const query = els.groupSearch.value.trim();
  for (const group of state.workspace.declaration.groups.values()) {
    if (query && !group.name.includes(query)) continue;
    const item = el("button", {
      class: `group-item${state.selected?.group === group.name ? " selected" : ""}`,
      type: "button",
      onclick: () => selectGlyph(group.name, Math.min(state.selected?.index ?? 0, group.count - 1), { keepContext: false }),
    }, el("strong", { text: group.name }), el("small", { text: ` · ${group.count} · ${group.width}×${group.height}` }));
    els.groupList.append(item);
  }
}

function selectGlyph(group, index, { codepoint = null } = {}) {
  if (!state.workspace) return;
  cancelDraft();
  const model = state.workspace.declaration.groups.get(group);
  if (!model) return;
  const safeIndex = Math.max(0, Math.min(model.count - 1, Number(index) || 0));
  state.selected = { group, index: safeIndex };
  state.context = codepoint != null ? { codepoint, group, index: safeIndex } : null;
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

function themeImage(image) {
  if (document.documentElement.dataset.theme !== "dark") return image;
  const data = image.data.slice();
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
  }
  return { width: image.width, height: image.height, data };
}

function drawImageToCanvas(canvas, image, zoom, nearest = true, recolor = true) {
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
  ctx.drawImage(imageCanvas(recolor ? themeImage(image) : image), 0, 0, canvas.width, canvas.height);
  return ctx;
}

function fitImageToCanvas(canvas, image, box, recolor = true, smooth = state.antialias) {
  const dpr = globalThis.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(box * dpr));
  canvas.height = Math.max(1, Math.round(box * dpr));
  canvas.style.width = `${box}px`;
  canvas.style.height = `${box}px`;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = smooth;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (image.width === 0 || image.height === 0) return ctx;
  const scale = Math.min(box / image.width, box / image.height);
  const width = image.width * scale * dpr;
  const height = image.height * scale * dpr;
  ctx.drawImage(imageCanvas(recolor ? themeImage(image) : image), (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  return ctx;
}

function glyphThumb(image, size = 28, smooth = state.antialias) {
  const canvas = document.createElement("canvas");
  fitImageToCanvas(canvas, image, size, true, smooth);
  return canvas;
}

function drawGrid(ctx, image, zoom) {
  if (!state.view.grid || zoom < 8) return;
  const dpr = globalThis.devicePixelRatio || 1;
  ctx.save();
  ctx.strokeStyle = document.documentElement.dataset.theme === "dark" ? "rgba(230, 232, 236, 0.32)" : "rgba(40, 47, 58, 0.22)";
  ctx.lineWidth = Math.max(2, Math.round(2 * dpr));
  for (let x = 1; x < image.width; x += 1) {
    const px = Math.round(x * zoom * dpr);
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, image.height * zoom * dpr);
    ctx.stroke();
  }
  for (let y = 1; y < image.height; y += 1) {
    const py = Math.round(y * zoom * dpr);
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
  const border = Math.max(2, Math.round(2 * dpr));
  const inset = border / 2;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = border;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(x * zoom * dpr + inset, y * zoom * dpr + inset, width * zoom * dpr - border, height * zoom * dpr - border);
  ctx.strokeStyle = "#1f5fbf";
  ctx.lineDashOffset = 5;
  ctx.strokeRect(x * zoom * dpr + inset, y * zoom * dpr + inset, width * zoom * dpr - border, height * zoom * dpr - border);
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

function setEditingMode(mode) {
  els.editor.dataset.mode = mode;
  els.editingBadge.dataset.state = mode;
  els.editingBadge.textContent = t(`edit.${mode}`);
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
    setEditingMode("none");
    els.contextLabel.textContent = t("context.none");
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
  const ctx = drawImageToCanvas(els.board, display, zoom, true, !state.view.diff);
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
  drawShadow(ctx, zoom, currentGlyphTarget());
  drawGrid(ctx, display, zoom);
  drawSelection(ctx, zoom);
  if (counts) {
    els.diffCounts.textContent = t("history.diffCounts", counts);
  } else if (state.view.diff) els.diffCounts.textContent = t("compare.noBase");

  const selection = state.selection;
  els.selectionStatus.textContent = selection
    ? t("status.selection", selection)
    : t("status.selectionNone");
  const reason = info?.ok ? null : info?.reason;
  els.toolStatus.textContent = previewing
    ? t("history.preview", { id: previewing })
    : reason ?? t("status.editing", { group: group.name, index, tool: t(`tool.${state.view.tool}`) });
  const mode = previewing ? "preview" : !group.texture ? "composite" : reason ? "error" : !canEdit() ? "readonly" : "source";
  setEditingMode(mode);
  els.toolStatus.title = els.toolStatus.textContent;
  els.board.classList.toggle("readonly", Boolean(reason) || Boolean(previewing) || !canEdit());
}

function drawContext() {
  const target = currentGlyphTarget();
  if (!target) {
    els.context.width = 1;
    els.context.height = 1;
    els.contextLabel.textContent = t("context.none");
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
    els.diffCounts.textContent = t("history.diffCounts", diff.counts);
    els.contextLabel.textContent = t("context.compare", { cp: codepointLabel(currentCodepoint() ?? 0) });
  }
  if (state.view.onion) {
    state.contextOnion = rendererForState(getBaseState(state.view.onionBase)).renderGlyph(target.group, target.index).image;
    if (!state.view.diff) els.contextLabel.textContent = t("context.result", { cp: codepointLabel(currentCodepoint() ?? 0) });
  }
  const zoom = Math.max(1, Math.round(Math.min(10, 220 / Math.max(1, display.width, display.height))));
  const ctx = drawImageToCanvas(els.context, display, zoom, true, !state.view.diff);
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
    els.contextLabel.textContent = cp == null
      ? t("context.component", { group: target.group, index: target.index })
      : t("context.glyph", { cp: codepointLabel(cp), group: target.group, index: target.index });
  }
  if (result.errors.length) els.contextLabel.textContent = t("status.contextError", { message: result.errors[0].message });
}

function drawShadow(ctx, zoom, target) {
  if (!state.font || !state.shadow.visible) return;
  const cp = currentCodepoint();
  if (cp == null) {
    els.fontStatus.textContent = t("status.fontNoContext");
    return;
  }
  if (!state.font.hasCodepoint(cp)) {
    els.fontStatus.textContent = t("status.fontNoChar");
    return;
  }
  const dpr = globalThis.devicePixelRatio || 1;
  const char = String.fromCodePoint(cp);
  ctx.save();
  ctx.globalAlpha = clampShadowSettings(state.shadow).opacity;
  ctx.fillStyle = document.documentElement.dataset.theme === "dark" ? "#fff" : "#000";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `${clampShadowSettings(state.shadow).size * zoom * dpr}px "${state.font.family}"`;
  ctx.fillText(char, clampShadowSettings(state.shadow).x * zoom * dpr, clampShadowSettings(state.shadow).y * zoom * dpr);
  ctx.restore();
}

// ---------- inspector ----------

function renderChildStrip(group, index) {
  els.childStrip.replaceChildren();
  if (!group || index == null) return;
  const tree = buildLayerTree(state.workspace.declaration, group.name, index);
  const renderer = state.draft ? state.draft.previewRenderer : state.renderer;
  const contextWidth = els.context.clientWidth || 0;
  const contextHeight = els.context.clientHeight || 0;
  const box = Math.max(96, Math.min(220, Math.max(contextWidth, contextHeight)));
  if (tree.root.children.length === 0) {
    els.childStrip.append(el("div", { class: "child-empty muted", text: t("layers.none") }));
    return;
  }
  for (const placement of tree.root.children) {
    const hidden = state.view.hidden.has ? state.view.hidden.has(placement.id) : state.view.hidden.includes(placement.id);
    const tile = el("div", {
      class: `child-chip${hidden ? " hidden" : ""}`,
      role: "button",
      tabindex: "0",
      "aria-pressed": String(!hidden),
      title: t("children.toggle", { group: placement.group, index: placement.index }),
      onclick: () => {
        const set = new Set(state.view.hidden);
        if (set.has(placement.id)) set.delete(placement.id);
        else set.add(placement.id);
        state.view.hidden = set;
        drawBoard();
        drawContext();
        renderChildStrip(group, index);
        persist("view");
      },
      onkeydown: (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.currentTarget.click();
      },
    },
      el("button", {
        class: "child-nav",
        type: "button",
        title: t("children.go"),
        "aria-label": t("children.go"),
        onclick: (event) => {
          event.stopPropagation();
          selectGlyph(placement.group, placement.index);
        },
      }, icon("arrow-up-right")),
      glyphThumb(renderer.renderGlyph(placement.group, placement.index).image, box, false),
      `${placement.group}[${placement.index}]`,
    );
    els.childStrip.append(tile);
  }
}

function renderGroupGlyphGrid(group) {
  if (!group || !state.selected || state.selected.group !== group.name) {
    els.groupGlyphSection.hidden = true;
    els.groupGlyphGrid.replaceChildren();
    els.groupGlyphPager.hidden = true;
    return;
  }
  els.groupGlyphSection.hidden = false;
  const pageCount = Math.max(1, Math.ceil(group.count / GROUP_GLYPH_PAGE_SIZE));
  const anchor = `${group.name}\u0000${state.selected.index}`;
  if (state.groupGlyphAnchor !== anchor) {
    state.groupGlyphAnchor = anchor;
    state.groupGlyphPage = Math.floor(state.selected.index / GROUP_GLYPH_PAGE_SIZE);
  }
  state.groupGlyphPage = Math.max(0, Math.min(pageCount - 1, state.groupGlyphPage));
  const page = state.groupGlyphPage;
  const start = page * GROUP_GLYPH_PAGE_SIZE;
  const end = Math.min(group.count, start + GROUP_GLYPH_PAGE_SIZE);
  els.groupGlyphGrid.replaceChildren();
  if (!state.view.groupGridCollapsed) {
    for (let index = start; index < end; index += 1) {
      const result = state.renderer.renderGlyph(group.name, index);
      const thumb = el("canvas");
      fitImageToCanvas(thumb, result.image, 28);
      const tile = el("button", {
        class: `group-glyph-tile${state.selected.index === index ? " selected" : ""}`,
        type: "button",
        title: `${group.name}[${index}]`,
        onclick: () => selectGlyph(group.name, index, { keepContext: true }),
      }, thumb, el("span", { class: "group-glyph-index", text: String(index) }));
      if (result.errors.length) {
        tile.classList.add("has-error");
        tile.title = result.errors[0].message;
      }
      els.groupGlyphGrid.append(tile);
    }
  }
  els.groupGlyphPager.hidden = state.view.groupGridCollapsed || pageCount <= 1;
  els.groupGlyphPrev.disabled = page <= 0;
  els.groupGlyphNext.disabled = page >= pageCount - 1;
  els.groupGlyphPage.textContent = `${page + 1} / ${pageCount}`;
}

function renderGroupInfo() {
  const group = currentGroup();
  els.groupDetail.replaceChildren();
  els.childInfo.replaceChildren();
  els.textureInfo.replaceChildren();
  if (!group || !state.selected) {
    els.groupDetail.textContent = t("group.none");
    els.groupIndexControls.hidden = true;
    els.groupGlyphSection.hidden = true;
    els.groupGlyphGrid.replaceChildren();
    els.groupGlyphPager.hidden = true;
    els.childStrip.replaceChildren();
    return;
  }
  const index = state.selected.index;
  els.groupIndexControls.hidden = false;
  els.indexInput.value = String(index);
  els.indexInput.max = String(group.count - 1);
  els.indexCount.textContent = `/ ${group.count} · ${group.width}×${group.height}`;
  els.groupDetail.append(
    el("strong", { text: group.name }),
    el("div", { text: group.description ? group.description : t("group.noDescription"), class: group.description ? "" : "muted" }),
    el("div", { class: "muted mono", text: t("group.index", { index, count: group.count }) }),
  );
  const info = ownInfo(group, index);
  if (group.texture) {
    const resolved = sourcePath(state.workspace.declaration, group.texture.set, group.texture.source);
    els.textureInfo.append(
      el("div", { text: t("group.texture", { set: group.texture.set, source: group.texture.source }) }),
      el("div", { class: "muted mono", text: resolved.path ?? resolved.error }),
      el("div", {
        class: `texture-state ${info.ok ? "ok" : "error"}`,
        text: info.ok ? t("group.connected", { width: info.asset.width, height: info.asset.height, x: info.box.x, y: info.box.y }) : info.reason,
      }),
      el("button", { class: "small", text: t("group.sourceConnect"), onclick: openSources }),
    );
  } else {
    els.textureInfo.append(el("div", { class: "texture-state composite", text: t("group.noTexture") }));
  }
  renderGroupGlyphGrid(group);

  const children = new Map();
  for (let importIndex = 0; importIndex < group.imports.length; importIndex += 1) {
    const imp = group.imports[importIndex];
    if (!children.has(imp.group)) children.set(imp.group, []);
    children.get(imp.group).push(importIndex);
  }
  const placements = state.workspace.declaration.placement(group.name).get(index) ?? [];
  let shownChildren = 0;
  for (const [childName, imports] of children) {
    const child = state.workspace.declaration.groups.get(childName);
    const occurrences = placements.filter((item) => item.child === childName);
    if (state.view.childFilter && occurrences.length === 0) continue;
    shownChildren += 1;
    const box = el("div", { class: "list-item" },
      el("strong", { text: childName }),
      el("div", { class: child.description ? "" : "muted", text: child.description || t("group.noDescription") }),
      el("div", { class: "muted", text: occurrences.length ? t("children.occurrences", { count: occurrences.length, imports: imports.join(", ") }) : t("children.notPlaced") }),
    );
    if (occurrences.length) {
      for (const occurrence of occurrences) {
        const preview = state.renderer.renderGlyph(childName, occurrence.childIndex).image;
        box.append(el("button", {
          class: "small child-glyph",
          onclick: () => selectGlyph(childName, occurrence.childIndex, { keepContext: true }),
        }, glyphThumb(preview, 20), `${childName}[${occurrence.childIndex}]`));
      }
    } else {
      box.append(el("button", { class: "small", text: t("children.open", { group: childName }), onclick: () => selectGlyph(childName, 0, { keepContext: true }) }));
    }
    els.childInfo.append(box);
  }
  if (shownChildren === 0) {
    els.childInfo.append(el("div", { class: "muted", text: children.size === 0 ? t("children.none") : t("children.noCurrent") }));
  }

}

function renderUsageList(element, codepoints, { unknown = false } = {}) {
  element.replaceChildren();
  if (!codepoints) {
    element.append(el("div", { class: "muted", text: t("group.none") }));
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
    element.append(el("div", { class: "muted", text: codepoints.length ? t("usage.noResults") : t("usage.none") }));
    return;
  }
  const page = paginate(visible, state.impactPage?.[element.id] ?? 0, 64);
  state.impactPage = { ...(state.impactPage ?? {}), [element.id]: page.page };
  for (const item of page.items) {
    const cp = typeof item === "number" ? item : item.codepoint;
    const target = state.workspace.declaration.unicodeMap.get(cp);
    const label = target ? `${codepointLabel(cp)} ${characterDisplay(cp)} ${target.group}[${target.index}]` : `${codepointLabel(cp)} · ${t("nav.unmapped")}`;
    const button = el("button", { class: "list-item", text: label, title: target ? t("usage.go") : undefined });
    if (target) button.addEventListener("click", () => selectGlyph(target.group, target.index, { codepoint: cp }));
    element.append(button);
  }
  if (page.pageCount > 1) {
    const row = el("div", { class: "row wrap" });
    row.append(
      el("button", { class: "icon-btn", type: "button", title: t("nav.prev"), "aria-label": t("nav.prev"), disabled: page.page === 0, onclick: () => { state.impactPage[element.id] = page.page - 1; renderUsageList(element, codepoints); } }, icon("chevron-left")),
      el("span", { class: "muted", text: `${page.page + 1}/${page.pageCount}` }),
      el("button", { class: "icon-btn", type: "button", title: t("nav.next"), "aria-label": t("nav.next"), disabled: page.page >= page.pageCount - 1, onclick: () => { state.impactPage[element.id] = page.page + 1; renderUsageList(element, codepoints); } }, icon("chevron-right")),
      el("span", { class: "muted", text: query ? t("usage.filtered", { visible: visible.length, total: codepoints.length }) : t("usage.total", { count: codepoints.length }) }),
    );
    element.append(row);
  } else {
    element.append(el("div", { class: "muted", text: query ? t("usage.filtered", { visible: visible.length, total: codepoints.length }) : t("usage.total", { count: codepoints.length }) }));
  }
}

function renderStructuralUsages() {
  if (!state.workspace || !state.selected) {
    renderUsageList(els.structuralUsage, null);
    return;
  }
  const usages = state.workspace.declaration.usages(state.selected.group, state.selected.index);
  renderUsageList(els.structuralUsage, usages.map((item) => item.codepoint));
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
  els.historyInfo.textContent = t("history.info", { head: head.id, count: history.revisions.size - 1, depth: branchCount });
  els.historyList.replaceChildren();
  for (const revision of historyOptions()) {
    const current = revision.id === head.id;
    const ancestor = history.pathTo(head.id).some((item) => item.id === revision.id);
    const label = revision.kind === "original" ? t("history.original") : revision.kind === "restore" ? t("history.restoreKind") : revision.start ? `${revision.start.group}[${revision.start.index}]` : revision.kind;
    const item = el("div", {
      class: `list-item history-item${current ? " current" : ""}`,
      role: "button",
      tabindex: "0",
      onclick: () => {
        state.historyPreview = revision.id;
        renderHistory();
        updateToolAvailability();
            drawBoard();
        drawContext();
      },
    },
      el("strong", { text: revision.id }),
      el("span", { text: ` · ${label}` }),
      el("div", { class: "muted", text: formatDate(revision.timestamp) }),
      current ? el("div", { class: "muted", text: t("history.current") }) : ancestor ? el("div", { class: "muted", text: t("history.onPath") }) : el("div", { class: "branch", text: t("history.otherBranch") }),
    );
    if (revision.start) {
      item.append(el("button", {
        class: "small",
        text: t("history.moveTo", { group: revision.start.group, index: revision.start.index }),
        onclick: (event) => {
          event.stopPropagation();
          selectGlyph(revision.start.group, revision.start.index, { keepContext: true });
        },
      }));
    } else if (revision.changes.size) {
      item.append(el("div", { class: "muted", text: t("history.targets", { paths: [...revision.changes.keys()].join(", ") }) }));
    }
    els.historyList.append(item);
  }
  els.historyActions.hidden = !state.historyPreview;
  if (state.historyPreview) {
    els.historyInfo.textContent += ` · ${t("history.selected", { id: state.historyPreview })}`;
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
      select.append(el("option", { value: revision.id, text: revision.id === "r0" ? t("history.original") : `${revision.id} · ${new Date(revision.timestamp).toLocaleTimeString()}` }));
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

function drawTextCanvas(canvas, image, { width, smooth }) {
  canvas.width = Math.max(1, image.width);
  canvas.height = Math.max(1, image.height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = smooth;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(imageCanvas(themeImage(image)), 0, 0);
  canvas.style.width = width;
  canvas.style.height = "auto";
  canvas.style.imageRendering = smooth ? "auto" : "pixelated";
}

function drawTextPreview() {
  if (!state.workspace) return;
  try {
    const draftRenderer = state.draft?.previewRenderer;
    if (state.draft) state.draft.previewAssets.get(state.draft.path).current = state.draft.draft.data;
    const result = renderText(state.workspace.declaration, draftRenderer ?? state.renderer, els.textInput.value);
    drawTextCanvas(els.textPreview, result.image, { width: "100%", smooth: state.antialias });
    if (els.textPreviewDialog.open) {
      const zoom = Math.max(1, Math.trunc(Number(state.view.textZoom) || 1));
      drawTextCanvas(els.textPreviewLarge, result.image, { width: `${result.image.width * zoom}px`, smooth: state.antialias });
      els.textPreviewSize.textContent = `${result.image.width}×${result.image.height} · ${zoom}×`;
    }
    els.textStatus.textContent = result.hasMappings
      ? result.unmapped.length ? t("text.unmapped", { count: result.unmapped.length }) : ""
      : t("text.noMappings");
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

function setTool(tool) {
  state.view.tool = tool;
  for (const button of document.querySelectorAll("[data-tool]")) button.classList.toggle("active", button.dataset.tool === tool);
  drawBoard();
  persist("view");
}

function updateToolAvailability() {
  const textureEditable = Boolean(ownInfo()?.ok) && !previewId() && !state.storage.readOnly && !state.storage.blocked;
  for (const button of document.querySelectorAll("[data-tool]")) {
    button.disabled = textureEditable ? state.view.ownHidden && button.dataset.tool !== "select" : true;
  }
  els.selectAll.disabled = !textureEditable;
  els.deleteSelection.disabled = !textureEditable || state.view.ownHidden;
  const copyable = Boolean(ownInfo()?.ok) && !previewId() && !state.view.ownHidden;
  els.copySelection.disabled = !copyable;
  els.pasteSelection.disabled = !textureEditable || !state.clipboard || state.view.ownHidden;
}

function refreshAll() {
  if (!state.workspace) return;
  els.workspaceName.textContent = `${state.workspace.name} · ${state.workspace.fileName}`;
  els.zoom.value = String(state.view.zoom);
  els.gridToggle.checked = state.view.grid;
  els.ownHidden.checked = state.view.ownHidden;
  els.childrenHidden.checked = state.view.childrenHidden;
  els.childFilter.checked = state.view.childFilter !== false;
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
  applyLayout();
  els.exportSingle.disabled = !ownInfo()?.ok;
  els.openSources.disabled = !state.workspace;
  els.exportAll.disabled = !state.workspace || state.workspace.assets.paths().length === 0;
  els.exportProject.disabled = !state.workspace;
  els.textPreviewOpen.disabled = !state.workspace;
  renderSetSelect();
  renderNavigator();
  renderGroupInfo();
  renderStructuralUsages();
  renderBaseSelects();
  renderHistory();
  updateFontUi();
  drawBoard();
  drawContext();
  if (state.selected) renderChildStrip(currentGroup(), state.selected.index);
  drawTextPreview();
}

function shadowSliderRange() {
  const group = currentGroup();
  const width = group?.width ?? 16;
  const height = group?.height ?? 16;
  const size = Math.min(256, Math.max(0.25, Number(state.shadow.size) || 16));
  let fontWidth = size;
  const cp = currentCodepoint();
  if (state.font && cp != null && state.font.hasCodepoint(cp)) {
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `${size}px "${state.font.family}"`;
    const measured = ctx.measureText(String.fromCodePoint(cp)).width;
    if (Number.isFinite(measured) && measured > 0) fontWidth = measured;
  }
  return {
    xMin: -Math.ceil(fontWidth * 4) / 4,
    xMax: width,
    yMin: -Math.ceil(size * 4) / 4,
    yMax: height,
  };
}

function formatSliderValue(value, unit = "px") {
  return `${Math.round(value * 100) / 100}${unit}`;
}

function currentShadowPreset(name) {
  const settings = clampShadowSettings(state.shadow);
  return {
    name,
    size: Math.min(256, settings.size),
    x: settings.x,
    y: settings.y,
    opacity: settings.opacity,
  };
}

function applyShadowPreset(preset) {
  state.shadow = clampShadowSettings({
    ...state.shadow,
    size: preset.size,
    x: preset.x,
    y: preset.y,
    opacity: preset.opacity,
  });
  if (state.font) state.font.settings = { ...state.shadow };
  updateFontUi();
  drawBoard();
  drawContext();
  scheduleViewSave("font");
}

function saveShadowPreset() {
  if (!state.workspace) return;
  const name = els.shadowPresetName.value.trim() || t("compare.untitledPreset");
  const presets = state.workspace.shadowPresets ?? [];
  const existing = presets.findIndex((preset) => preset.name === name);
  if (existing < 0 && presets.length >= 32) {
    els.toolStatus.textContent = t("compare.presetLimit");
    return;
  }
  const preset = currentShadowPreset(name);
  if (existing >= 0) presets[existing] = preset;
  else presets.push(preset);
  state.workspace.shadowPresets = normalizeShadowPresets(presets);
  els.shadowPresetName.value = "";
  renderShadowPresets();
  persist("font");
}

function renameShadowPreset(preset) {
  const raw = prompt(t("compare.renamePreset"), preset.name);
  if (raw == null) return;
  const name = raw.trim().slice(0, 80);
  if (!name) return;
  const presets = state.workspace.shadowPresets ?? [];
  if (presets.some((item) => item !== preset && item.name === name)) {
    els.toolStatus.textContent = t("compare.presetNameExists");
    return;
  }
  preset.name = name;
  state.workspace.shadowPresets = normalizeShadowPresets(presets);
  renderShadowPresets();
  persist("font");
}

async function deleteShadowPreset(preset) {
  const ok = await confirmAction(t("compare.deletePreset", { name: preset.name }));
  if (!ok) return;
  state.workspace.shadowPresets = (state.workspace.shadowPresets ?? []).filter((item) => item !== preset);
  renderShadowPresets();
  persist("font");
}

function renderShadowPresets() {
  const presets = state.workspace?.shadowPresets ?? [];
  els.shadowPresetList.replaceChildren();
  if (presets.length === 0) {
    els.shadowPresetList.append(el("div", { class: "muted", text: t("compare.noPresets") }));
    return;
  }
  for (const preset of presets) {
    const apply = el("button", {
      class: "shadow-preset-apply",
      type: "button",
      title: t("compare.applyPreset"),
      onclick: () => applyShadowPreset(preset),
    },
      el("strong", { text: preset.name }),
      el("small", { text: `${formatSliderValue(preset.size)} · x ${formatSliderValue(preset.x)} · y ${formatSliderValue(preset.y)} · ${formatSliderValue(preset.opacity * 100, "%")}` }),
    );
    const rename = el("button", {
      class: "icon-btn",
      type: "button",
      title: t("compare.renamePreset"),
      "aria-label": t("compare.renamePreset"),
      "data-shadow-action": "rename",
      onclick: () => renameShadowPreset(preset),
    }, icon("pencil"));
    const remove = el("button", {
      class: "icon-btn",
      type: "button",
      title: t("common.delete"),
      "aria-label": t("common.delete"),
      "data-shadow-action": "delete",
      onclick: () => deleteShadowPreset(preset),
    }, icon("trash"));
    els.shadowPresetList.append(el("div", { class: "shadow-preset-item" }, apply, rename, remove));
  }
}

function updateFontUi() {
  const range = shadowSliderRange();
  state.shadow.size = Math.min(256, Math.max(0.25, state.shadow.size));
  state.shadow.x = Math.min(range.xMax, Math.max(range.xMin, state.shadow.x));
  state.shadow.y = Math.min(range.yMax, Math.max(range.yMin, state.shadow.y));
  els.shadowControls.hidden = !state.font;
  els.shadowToggle.disabled = !state.font;
  els.shadowToggle.checked = Boolean(state.shadow.visible);
  els.fontStatus.textContent = state.font ? state.font.name : t("compare.noFont");
  els.shadowSize.value = String(state.shadow.size);
  els.shadowX.min = String(range.xMin);
  els.shadowX.max = String(range.xMax);
  els.shadowX.value = String(state.shadow.x);
  els.shadowY.min = String(range.yMin);
  els.shadowY.max = String(range.yMax);
  els.shadowY.value = String(state.shadow.y);
  els.shadowOpacity.value = String(state.shadow.opacity);
  els.shadowSizeValue.textContent = formatSliderValue(state.shadow.size);
  els.shadowXValue.textContent = formatSliderValue(state.shadow.x);
  els.shadowYValue.textContent = formatSliderValue(state.shadow.y);
  els.shadowOpacityValue.textContent = formatSliderValue(state.shadow.opacity * 100, "%");
  renderShadowPresets();
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

function intersectRect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
}

function beginDraft(bounds = null) {
  const info = ownInfo();
  if (!info?.ok) return null;
  const previewAssets = state.workspace.assets.clone();
  const draft = new PixelDraft(info.asset, bounds ? intersectRect(bounds, info.box) : info.box);
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
  els.toolStatus.textContent = t("status.ownHidden");
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
  if (state.drag?.kind === "move") state.selection = { ...state.drag.selection };
  if (state.keyMove) state.selection = { ...state.keyMove.selection };
  state.draft = null;
  state.drag = null;
  state.keyMove = null;
  drawBoard();
  drawContext();
}

function startPaint(event, eraser = false) {
  if (previewId()) {
    els.toolStatus.textContent = t("status.previewBlocked");
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
    els.toolStatus.textContent = info?.reason ?? t("status.noEdit");
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
    els.toolStatus.textContent = t("status.previewBlocked");
    return;
  }
  const info = ownInfo();
  const selection = state.selection;
  if (!info?.ok || !selection) {
    els.toolStatus.textContent = selection ? t("status.noEdit") : t("status.selectFirst");
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
    state.selection = { ...state.drag.selection, x: state.drag.selection.x + moved.dx, y: state.drag.selection.y + moved.dy };
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
    commitDraft();
  } else if (drag.kind === "select" && state.selection) {
    setTool("move");
  }
  els.board.releasePointerCapture?.(event.pointerId);
}

function eraseSelection() {
  const selection = state.selection;
  if (!selection) {
    els.toolStatus.textContent = t("status.selectFirst");
    return;
  }
  if (previewId()) {
    els.toolStatus.textContent = t("status.previewBlocked");
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

function copySelection() {
  const group = currentGroup();
  const info = ownInfo();
  if (!group || !info?.ok || previewId() || state.view.ownHidden) {
    els.toolStatus.textContent = t("status.copyUnavailable");
    return;
  }
  const rect = state.selection
    ? { ...state.selection }
    : { x: 0, y: 0, width: info.box.width, height: info.box.height };
  const data = new Uint8Array(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const sx = rect.x + x;
      const sy = rect.y + y;
      if (sx < 0 || sy < 0 || sx >= info.box.width || sy >= info.box.height) continue;
      const source = ((info.box.y + sy) * info.asset.width + info.box.x + sx) * 4;
      data.set(info.asset.current.subarray(source, source + 4), (y * rect.width + x) * 4);
    }
  }
  state.clipboard = { ...rect, data };
  els.toolStatus.textContent = t("status.copied", { width: rect.width, height: rect.height });
  updateToolAvailability();
}

function pasteClipboard() {
  const clipboard = state.clipboard;
  if (!clipboard) {
    els.toolStatus.textContent = t("status.noClipboard");
    return;
  }
  if (previewId()) {
    els.toolStatus.textContent = t("status.previewBlocked");
    return;
  }
  if (!ensureEditable() || !ownLayerWritable()) return;
  const info = ownInfo();
  if (!info?.ok) return;
  const draft = beginDraft();
  if (!draft) return;
  draft.draft.paste({ x: info.box.x + clipboard.x, y: info.box.y + clipboard.y, width: clipboard.width, height: clipboard.height }, clipboard.data);
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
  for (const label of ["sources.set", "sources.source", "sources.path", "sources.required", "sources.link", "sources.file", "sources.size", "sources.status"]) {
    header.append(el("th", { text: t(label) }));
  }
  table.append(el("thead", {}, header));
  const body = el("tbody");
  for (const row of rows) {
    const pick = el("button", { class: "small", type: "button", text: t("sources.pick"), onclick: () => openManualLink(row.path) });
    const blank = row.path && row.required && !row.required.error && !row.asset
      ? el("button", {
          class: "small",
          type: "button",
          text: t("sources.blank"),
          "data-blank-source": row.path,
          onclick: () => createBlankTexture(row.path, row.required),
        })
      : null;
    const status = row.error
      ? el("span", { class: "state error", text: row.error })
      : el("span", { class: `state ${row.asset ? "ok" : "pending"}`, text: t(row.asset ? "sources.linked" : "sources.unlinked") });
    const tr = el("tr");
    tr.append(
      el("td", { class: "mono", text: row.set }),
      el("td", { class: "mono", text: row.source }),
      el("td", { class: "mono", text: row.declaredPath }),
      el("td", { class: "mono", text: row.required ? `${row.required.width}×${row.required.height}` : "—" }),
      el("td", {}, pick, blank ? " " : null, blank),
      el("td", { class: "mono", text: row.asset?.path ?? "—" }),
      el("td", { class: "mono", text: row.asset ? `${row.asset.width}×${row.asset.height}` : "—" }),
      el("td", {}, status),
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

function createBlankTexture(path, required) {
  try {
    const image = blankTexture(required);
    state.workspace.assets.bind(path, image, { minimum: required });
    state.renderer.invalidate();
    state.baseCache.clear();
    renderSourceTable();
    renderNavigator();
    renderGroupInfo();
    drawBoard();
    drawContext();
    drawTextPreview();
    els.importReport.textContent = t("sources.blankCreated", { path, width: image.width, height: image.height });
    persist("link");
  } catch (error) {
    els.importReport.textContent = error.message;
  }
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
        const ok = await confirmAction(t("sources.confirmReplace", { count: result.replacements.size }));
        if (ok) {
          const before = state.workspace.assets.snapshot();
          const pairs = [...result.replacements.entries()].map(([path, candidate]) => ({ path, bytes: candidate.bytes }));
          await replaceAssets(state.workspace.declaration, state.workspace.assets, pairs);
          const changes = diffSnapshotToAssets(before, state.workspace.assets);
          if (changes.size) {
            const revision = state.workspace.history.commit(changes, { kind: "replace" }, { applied: true });
            state.renderer.invalidate();
            state.baseCache.clear();
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
    renderGroupInfo();
    drawBoard();
    drawContext();
    drawTextPreview();
    els.importReport.textContent = [
      result.linked.length ? t("sources.linkedCount", { count: result.linked.length }) : "",
      replaced ? t("sources.replacedCount", { count: replaced }) : "",
      result.unreferenced.length ? t("sources.unreferenced", { count: result.unreferenced.length }) : "",
      result.skipped.length ? t("sources.skipped", { count: result.skipped.length }) : "",
      result.errors.length ? t("sources.errors", { count: result.errors.length, errors: result.errors.join(" / ") }) : "",
    ].filter(Boolean).join(" · ");
  } catch (error) {
    els.importReport.textContent = error.message;
  }
}

async function handleManualFile(file) {
  const target = state.linkTarget;
  state.linkTarget = null;
  if (!target || !file) return;
  cancelDraft();
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const existing = state.workspace.assets.get(target);
    if (existing) {
      const ok = await confirmAction(t("sources.confirmManual"));
      if (!ok) return;
      const before = state.workspace.assets.snapshot();
      await replaceAssets(state.workspace.declaration, state.workspace.assets, [{ path: target, bytes }]);
      const changes = diffSnapshotToAssets(before, state.workspace.assets);
      if (changes.size) {
        const revision = state.workspace.history.commit(changes, { kind: "replace" }, { applied: true });
            persist("replace");
      }
    } else {
      await manualLink(state.workspace.declaration, state.workspace.assets, target, bytes);
      persist("link");
    }
    state.renderer.invalidate();
    state.baseCache.clear();
    renderSourceTable();
    renderNavigator();
    renderGroupInfo();
    drawBoard();
    drawContext();
    drawTextPreview();
  } catch (error) {
    els.importReport.textContent = error.message;
  }
}

// ---------- works ----------

async function loadWorksList() {
  els.worksList.replaceChildren(el("div", { class: "muted", text: t("works.loading") }));
  try {
    const rows = await listWorkspaces();
    els.worksList.replaceChildren();
    if (rows.length === 0) {
      els.worksList.append(el("div", { class: "muted", text: t("works.none") }));
      return;
    }
    for (const row of rows) {
      const item = el("div", { class: "list-item" },
        el("strong", { text: row.name }),
        el("div", { class: "muted", text: t("works.info", { file: row.fileName, images: row.images, revisions: row.revisions }) }),
        el("div", { class: "muted", text: formatDate(row.updatedAt) }),
      );
      const rowButtons = el("div", { class: "row wrap" });
      rowButtons.append(
        el("button", { class: "small", text: t("works.openAction"), onclick: async () => {
          try {
            const workspace = await loadWorkspace(row.id);
            if (!workspace) throw new Error("Workspace not found");
            if (state.storage.lock) state.storage.lock.release();
            els.recordsDialog.close();
            adoptWorkspace(workspace, { restored: true });
          } catch (error) {
            setStatus(t("works.loadFailed", { message: error.message }), "failed");
          }
        } }),
        el("button", { class: "small", text: t("works.rename"), onclick: async () => {
          const name = prompt(t("sources.renamePrompt"), row.name);
          if (!name) return;
          try {
            await renameWorkspace(row.id, name);
            loadWorksList();
          } catch (error) {
            setStatus(error.message, "failed");
          }
        } }),
        el("button", { class: "small danger", text: t("works.delete"), onclick: async () => {
          const ok = await confirmAction(t("sources.confirmDelete", { name: row.name }));
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
            loadWorksList();
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

async function openWorksList() {
  openRecords("works");
  await loadWorksList();
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

async function doExportProject() {
  try {
    await persist("project");
    const result = await exportProject(state.workspace);
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
  els.toggleNav.addEventListener("click", () => {
    state.view.navHidden = !state.view.navHidden;
    applyLayout();
    persist("view");
  });
  els.toggleInspector.addEventListener("click", () => {
    state.view.inspectorHidden = !state.view.inspectorHidden;
    applyLayout();
    persist("view");
  });
  els.themeToggle.addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });
  els.openSettings.addEventListener("click", () => {
    els.settingsLanguage.value = getLanguage();
    els.settingsAntialias.checked = state.antialias;
    els.settingsDialog.showModal();
  });
  els.settingsClose.addEventListener("click", () => els.settingsDialog.close());
  els.settingsLanguage.addEventListener("change", () => {
    setLanguage(els.settingsLanguage.value);
    applyLanguage();
  });
  els.settingsAntialias.addEventListener("change", () => setAntialias(els.settingsAntialias.checked));
  els.fileMenuButton.addEventListener("click", (event) => {
    event.stopPropagation();
    els.fileMenu.hidden = !els.fileMenu.hidden;
  });
  document.addEventListener("click", (event) => {
    if (!els.fileMenu.hidden && !event.target.closest(".menu-wrap")) els.fileMenu.hidden = true;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.fileMenu.hidden) els.fileMenu.hidden = true;
  });
  for (const button of els.recordsTabs.querySelectorAll("[data-records-tab]")) {
    button.addEventListener("click", () => {
      setRecordsTab(button.dataset.recordsTab);
      if (button.dataset.recordsTab === "works") loadWorksList();
    });
  }
  els.openWorks.addEventListener("click", openWorksList);
  els.emptyOpenWorks.addEventListener("click", openWorksList);
  els.worksClose.addEventListener("click", () => els.recordsDialog.close());
  els.childFilter.addEventListener("change", () => {
    state.view.childFilter = els.childFilter.checked;
    renderGroupInfo();
    persist("view");
  });
  els.openDeclaration.addEventListener("click", () => {
    els.fileMenu.hidden = true;
    els.declarationFile.click();
  });
  els.openPresets.addEventListener("click", () => {
    els.fileMenu.hidden = true;
    showPresetDialog();
  });
  els.emptyOpenPresets.addEventListener("click", showPresetDialog);
  els.presetClose.addEventListener("click", () => els.presetDialog.close());
  for (const card of document.querySelectorAll("[data-preset]")) {
    card.addEventListener("click", () => openPreset(card.dataset.preset));
  }
  els.emptyOpenDeclaration.addEventListener("click", () => els.declarationFile.click());
  els.declarationFile.addEventListener("change", async () => {
    const file = els.declarationFile.files?.[0];
    els.declarationFile.value = "";
    if (file) await openDeclarationFile(file);
  });
  els.openProject.addEventListener("click", () => {
    els.fileMenu.hidden = true;
    els.projectFile.click();
  });
  els.projectFile.addEventListener("change", async () => {
    const file = els.projectFile.files?.[0];
    els.projectFile.value = "";
    if (file) await openProjectFile(file);
  });
  els.openSources.addEventListener("click", () => {
    els.fileMenu.hidden = true;
    openSources();
  });
  els.importImages.addEventListener("click", () => {
    state.linkTarget = null;
    els.imageFile.click();
  });
  els.sourceDialog.addEventListener("close", () => { state.linkTarget = null; });
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
  els.toggleCharacterGrid.addEventListener("click", () => {
    state.view.characterGridCollapsed = !state.view.characterGridCollapsed;
    applyGridVisibility();
    scheduleViewSave();
  });
  els.toggleGroupGrid.addEventListener("click", () => {
    state.view.groupGridCollapsed = !state.view.groupGridCollapsed;
    applyGridVisibility();
    if (!state.view.groupGridCollapsed) renderGroupGlyphGrid(currentGroup());
    scheduleViewSave();
  });
  els.groupGlyphPrev.addEventListener("click", () => {
    state.groupGlyphPage = Math.max(0, state.groupGlyphPage - 1);
    renderGroupGlyphGrid(currentGroup());
  });
  els.groupGlyphNext.addEventListener("click", () => {
    state.groupGlyphPage += 1;
    renderGroupGlyphGrid(currentGroup());
  });
  els.groupSearch.addEventListener("input", renderNavigator);
  for (const input of document.querySelectorAll("[data-usage-search]")) {
    input.addEventListener("input", () => {
      state.usageQuery[input.dataset.usageSearch] = input.value;
      state.impactPage = { ...(state.impactPage ?? {}), [input.dataset.usageSearch]: 0 };
      renderStructuralUsages();
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
    } else els.globalError.textContent = t("nav.jumpFailed");
  });

  els.toolbar.addEventListener("click", (event) => {
    const tool = event.target.closest("[data-tool]")?.dataset.tool;
    if (!tool) return;
    cancelDraft();
    setTool(tool);
  });
  els.zoom.addEventListener("change", () => { state.view.zoom = Number(els.zoom.value); persist("view"); drawBoard(); });
  els.gridToggle.addEventListener("change", () => { state.view.grid = els.gridToggle.checked; persist("view"); drawBoard(); });
  els.ownHidden.addEventListener("change", () => { state.view.ownHidden = els.ownHidden.checked; updateToolAvailability(); persist("view"); drawBoard(); });
  els.childrenHidden.addEventListener("change", () => { state.view.childrenHidden = els.childrenHidden.checked; persist("view"); drawBoard(); });
  els.selectAll.addEventListener("click", () => {
    const group = currentGroup();
    if (!group || !ownInfo()?.ok) return;
    state.selection = { x: 0, y: 0, width: group.width, height: group.height };
    setTool("move");
  });
  els.clearSelection.addEventListener("click", () => { state.selection = null; drawBoard(); });
  els.deleteSelection.addEventListener("click", eraseSelection);
  els.copySelection.addEventListener("click", copySelection);
  els.pasteSelection.addEventListener("click", pasteClipboard);
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
  els.textPreviewOpen.addEventListener("click", () => {
    if (!state.workspace) return;
    els.textPreviewDialog.showModal();
    drawTextPreview();
  });
  els.textPreviewClose.addEventListener("click", () => els.textPreviewDialog.close());

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
      drawBoard();
      drawContext();
      persist("font");
    } catch (error) {
      els.fontStatus.textContent = error.message;
    }
  });
  for (const [input, key] of [[els.shadowSize, "size"], [els.shadowX, "x"], [els.shadowY, "y"], [els.shadowOpacity, "opacity"]]) {
    input.addEventListener("input", () => {
      state.shadow = clampShadowSettings({ ...state.shadow, [key]: Number(input.value), visible: state.shadow.visible });
      updateFontUi();
      state.font.settings = { ...state.shadow };
      drawBoard();
      drawContext();
      scheduleViewSave("font");
    });
  }
  els.saveShadowPreset.addEventListener("click", saveShadowPreset);
  els.shadowPresetName.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    saveShadowPreset();
  });
  els.shadowToggle.addEventListener("change", () => {
    state.shadow.visible = els.shadowToggle.checked;
    if (state.font) state.font.settings = { ...state.shadow };
    drawBoard();
    drawContext();
    persist("font");
  });

  els.exportSingle.addEventListener("click", () => { els.fileMenu.hidden = true; doExportSingle(); });
  els.exportChanged.addEventListener("click", () => { els.fileMenu.hidden = true; doExportZip("changed"); });
  els.exportAll.addEventListener("click", () => { els.fileMenu.hidden = true; doExportZip("all"); });
  els.exportProject.addEventListener("click", () => { els.fileMenu.hidden = true; doExportProject(); });

  els.restoreRevision.addEventListener("click", async () => {
    if (!state.historyPreview || !ensureEditable()) return;
    const ok = await confirmAction(t("sources.confirmRestore"));
    if (!ok) return;
    cancelDraft();
    const revision = state.workspace.history.restore(state.historyPreview);
    if (revision) {
      state.renderer.invalidate();
      state.baseCache.clear();
      state.historyPreview = null;
      state.selection = null;
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
  els.board.addEventListener("pointercancel", () => { cancelDraft(); state.drag = null; state.keyMove = null; drawBoard(); });
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
  if (ctrl && key.toLowerCase() === "c") {
    event.preventDefault();
    copySelection();
    return;
  }
  if (ctrl && key.toLowerCase() === "v") {
    event.preventDefault();
    pasteClipboard();
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
    setTool({ b: "pencil", e: "eraser", s: "select", v: "move" }[key.toLowerCase()]);
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
    state.selection = { ...state.keyMove.selection, x: state.keyMove.selection.x + moved.dx, y: state.keyMove.selection.y + moved.dy };
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
  commitDraft();
}

initLanguage();
els.settingsLanguage.value = getLanguage();
let initialTheme = "light";
try {
  initialTheme = localStorage.getItem("declarative-font-editor-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
} catch {
  initialTheme = "light";
}
applyTheme(initialTheme);
applyLayout();
let initialAntialias = true;
try {
  initialAntialias = localStorage.getItem(ANTIALIAS_KEY) !== "false";
} catch {
  initialAntialias = true;
}
state.antialias = initialAntialias;
applyAntialiasSetting(false);

refreshAllInitial();

function refreshAllInitial() {
  renderSetSelect();
  els.characterGrid.replaceChildren(el("div", { class: "muted", text: t("nav.emptySet") }));
  els.undo.disabled = true;
  els.redo.disabled = true;
  bindEvents();
  restoreLastWorkspace();
  setInterval(() => {
    if (!state.workspace || !state.storage.readOnly || !state.storage.lock?.tryAcquire()) return;
    state.storage.readOnly = false;
    setStatus(t("status.saved"), "saved");
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
