import {
  DIRECTIONS,
  affectedParentGlyphs,
  changedOwnIndices,
  children,
  formatCodepoint,
  glyphFieldsChanged,
  groupNames,
  parents,
  parseDocument,
  searchDocument,
  serializeDocument,
  unicodeMap,
  validateDocument,
} from "./model.js";
import {
  drawGlyph,
  prepareCanvas,
  renderGlyphCanvas,
  textureMapKey,
} from "./render.js";

const PAGE_SIZE = 64;
const GRID_COLUMNS = 8;
const GRID_SCALE = 2;
const MAX_PARENT_OPTIONS = 200;
const MAX_CHANGED_PREVIEWS = 8;

const statusElement = document.querySelector("#status");
const emptyState = document.querySelector("#empty-state");
const editor = document.querySelector("#editor");
const detail = document.querySelector("#detail");
const preview = document.querySelector("#preview");
const grid = document.querySelector("#grid");
const groupList = document.querySelector("#group-list");
const searchInput = document.querySelector("#search");
const searchResults = document.querySelector("#search-results");
const textureStatus = document.querySelector("#texture-status");
const undoButton = document.querySelector("#undo");
const redoButton = document.querySelector("#redo");

const state = {
  doc: null,
  sourceName: "",
  baseUrl: null,
  selected: null,
  glyph: 0,
  page: 0,
  undo: [],
  redo: [],
  previewBefore: null,
  editKey: null,
  images: new Map(),
  textureFiles: new Map(),
  fileUrls: new Map(),
  parentPreview: null,
  statusTimer: null,
};

const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );

const clone = (value) => structuredClone(value);
const descriptionText = (value) =>
  typeof value === "string" && value.trim() ? value : "(no description)";

function setStatus(message, kind = "info", sticky = false) {
  window.clearTimeout(state.statusTimer);
  statusElement.hidden = false;
  statusElement.dataset.kind = kind;
  statusElement.textContent = message;
  if (!sticky) {
    state.statusTimer = window.setTimeout(() => {
      statusElement.hidden = true;
    }, 6000);
  }
}

function setErrors(title, errors) {
  window.clearTimeout(state.statusTimer);
  statusElement.hidden = false;
  statusElement.dataset.kind = "error";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const list = document.createElement("ul");
  for (const error of errors.slice(0, 8)) {
    const item = document.createElement("li");
    item.textContent = error;
    list.append(item);
  }
  if (errors.length > 8) {
    const item = document.createElement("li");
    item.textContent = `외 ${errors.length - 8}개 오류`;
    list.append(item);
  }
  statusElement.replaceChildren(heading, list);
}

function clearErrorStatus() {
  if (statusElement.dataset.kind === "error") statusElement.hidden = true;
}

function currentGroup() {
  return state.doc && state.selected ? state.doc.groups[state.selected] : null;
}

function mappedCount(group) {
  return (group?.unicode ?? []).reduce(
    (total, range) => total + range.from[1] - range.from[0],
    0,
  );
}

function groupKind(group) {
  const kinds = [];
  if (group.texture) kinds.push("텍스처");
  if ((group.imports ?? []).length) kinds.push(`임포트 ${group.imports.length}`);
  if ((group.unicode ?? []).length) kinds.push(`유니코드 ${mappedCount(group)}자`);
  return kinds.length ? kinds.join(" · ") : "빈 그룹";
}

function groupUnicodeByIndex(doc, name) {
  const result = new Map();
  for (const range of doc.groups[name]?.unicode ?? []) {
    const [a, b] = range.from;
    const start = Number.parseInt(range.to.slice(2), 16);
    for (let index = a; index < b; index += 1) {
      result.set(index, start + index - a);
    }
  }
  return result;
}

function glyphLabel(doc, groupName, index) {
  const codepoint = groupUnicodeByIndex(doc, groupName).get(index);
  const suffix = codepoint === undefined ? "" : ` · ${formatCodepoint(codepoint)} ${String.fromCodePoint(codepoint)}`;
  return `${groupName}[${index}]${suffix}`;
}

// -- textures ---------------------------------------------------------------

function textureReferences(doc) {
  const references = [];
  for (const group of Object.values(doc?.groups ?? {})) {
    const texture = group.texture;
    if (!texture) continue;
    const path = doc.texture_sets?.[texture.set]?.[texture.source];
    references.push({ set: texture.set, source: texture.source, path });
  }
  return references;
}

function resolveTextureUrl(path) {
  if (!path) return null;
  const basename = path.split("/").pop();
  if (state.textureFiles.has(basename)) {
    if (!state.fileUrls.has(basename)) {
      state.fileUrls.set(basename, URL.createObjectURL(state.textureFiles.get(basename)));
    }
    return state.fileUrls.get(basename);
  }
  if (/^(data:|blob:|https?:|file:)/i.test(path)) {
    return new URL(path, document.baseURI).href;
  }
  if (state.baseUrl) return new URL(path, state.baseUrl).href;
  return null;
}

function ensureTextures() {
  if (!state.doc) return;
  for (const reference of textureReferences(state.doc)) {
    const url = resolveTextureUrl(reference.path);
    if (!url || state.images.has(url)) continue;
    const entry = { status: "loading", image: null };
    state.images.set(url, entry);
    const image = new Image();
    image.onload = () => {
      entry.status = "ok";
      entry.image = image;
      onTexturesChanged();
    };
    image.onerror = () => {
      entry.status = "error";
      onTexturesChanged();
    };
    image.src = url;
  }
}

function reloadTextures() {
  state.images.clear();
  ensureTextures();
  onTexturesChanged();
}

function onTexturesChanged() {
  renderTextureStatus();
  if (state.doc) {
    renderPreview();
    renderGrid();
  }
}

function imagesForDoc(doc) {
  const images = new Map();
  for (const reference of textureReferences(doc)) {
    const url = resolveTextureUrl(reference.path);
    const entry = url ? state.images.get(url) : null;
    if (entry?.image) {
      images.set(textureMapKey(reference.set, reference.source), entry.image);
    }
  }
  return images;
}

function renderTextureStatus() {
  if (!state.doc) {
    textureStatus.textContent = "";
    return;
  }
  const references = textureReferences(state.doc);
  if (!references.length) {
    textureStatus.textContent = "텍스처 없음";
    return;
  }
  let loaded = 0;
  let failed = 0;
  const missing = [];
  for (const reference of references) {
    const url = resolveTextureUrl(reference.path);
    const entry = url ? state.images.get(url) : null;
    if (entry?.status === "ok") loaded += 1;
    else {
      if (entry?.status === "error") failed += 1;
      missing.push(reference.path ?? `${reference.set}/${reference.source}`);
    }
  }
  const suffix = failed ? ` · 실패 ${failed}` : "";
  textureStatus.textContent = `텍스처 ${loaded}/${references.length}${suffix}`;
  textureStatus.title = missing.length
    ? `불러오지 못한 텍스처: ${[...new Set(missing)].join(", ")}`
    : "";
}

// -- document loading --------------------------------------------------------

function ensureSelection() {
  if (!state.doc) {
    state.selected = null;
    return;
  }
  const names = groupNames(state.doc);
  if (!names.length) {
    state.selected = null;
    return;
  }
  if (!state.doc.groups[state.selected]) state.selected = names[0];
  const group = state.doc.groups[state.selected];
  state.glyph = Math.max(0, Math.min(state.glyph, group.count - 1));
  state.page = Math.max(0, Math.min(state.page, Math.ceil(group.count / PAGE_SIZE) - 1));
}

function loadDocumentText(text, { sourceName = "", baseUrl = null } = {}) {
  const { doc, errors } = parseDocument(text);
  if (errors.length) {
    setErrors("정의를 불러오지 못했습니다.", errors);
    return false;
  }
  state.doc = doc;
  state.sourceName = sourceName;
  state.baseUrl = baseUrl;
  state.selected = groupNames(doc)[0] ?? null;
  state.glyph = 0;
  state.page = 0;
  state.undo = [];
  state.redo = [];
  state.previewBefore = null;
  state.editKey = null;
  state.parentPreview = null;
  ensureTextures();
  renderAll();
  setStatus(
    `${sourceName || "정의"} · 그룹 ${Object.keys(doc.groups).length}개를 불러왔습니다.`,
    "ok",
  );
  return true;
}

async function loadExample() {
  setStatus("예제 정의를 불러오는 중…", "info", true);
  try {
    const url = new URL("../../examples/hangul.json", document.baseURI);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    loadDocumentText(text, {
      sourceName: "hangul.json",
      baseUrl: new URL(".", url).href,
    });
  } catch (error) {
    setStatus(
      `예제를 불러오지 못했습니다 (${error.message}). JSON 열기로 examples/hangul.json을 선택하세요.`,
      "error",
      true,
    );
  }
}

// -- editing -----------------------------------------------------------------

function pushUndo(snapshot) {
  state.undo.push(snapshot);
  if (state.undo.length > 100) state.undo.shift();
  state.redo = [];
}

function updateUndoButtons() {
  undoButton.disabled = state.undo.length === 0;
  redoButton.disabled = state.redo.length === 0;
}

function applyField(draft, data, value) {
  const group = draft.groups[state.selected];
  if (!group) return;
  const field = data.field;

  if (field === "description") {
    group.description = value;
    return;
  }

  if (field === "textureStartX" || field === "textureStartY") {
    if (!group.texture) return;
    group.texture.start[field === "textureStartX" ? 0 : 1] = value;
    return;
  }
  if (field === "textureDirection") {
    if (group.texture) group.texture.direction = value;
    return;
  }
  if (field === "textureSet") {
    if (!group.texture) return;
    group.texture.set = value;
    const sources = draft.texture_sets?.[value] ?? {};
    if (!(group.texture.source in sources)) {
      group.texture.source = Object.keys(sources)[0] ?? "";
    }
    return;
  }
  if (field === "textureSource") {
    if (group.texture) group.texture.source = value;
    return;
  }

  const imp = group.imports?.[Number(data.import)];
  if (!imp) return;
  if (field === "importGroup") {
    imp.group = value;
    return;
  }
  if (field === "offsetX" || field === "offsetY") {
    imp.offset[field === "offsetX" ? 0 : 1] = value;
    return;
  }

  const at = imp.at?.[Number(data.at)];
  if (!at) return;
  if (field === "fromA" || field === "fromB") {
    at.from[field === "fromA" ? 0 : 1] = value;
    return;
  }
  if (field === "to") {
    at.to = value;
    return;
  }

  const axis = at.repeat?.[Number(data.axis)];
  if (!axis) return;
  if (field === "count") axis.count = value;
  if (field === "fromStride") {
    if (value === undefined) delete axis.from_stride;
    else axis.from_stride = value;
  }
  if (field === "toStride") {
    if (value === undefined) delete axis.to_stride;
    else axis.to_stride = value;
  }
}

function editDoc(mutator, options = {}) {
  if (!state.doc) return false;
  const {
    key = null,
    structural = false,
    sidebar = false,
    rerenderOnError = structural,
  } = options;

  const previous = clone(state.doc);
  const draft = clone(state.doc);
  try {
    mutator(draft);
  } catch (error) {
    setErrors("편집을 적용하지 못했습니다.", [error.message]);
    return false;
  }
  const errors = validateDocument(draft);
  if (errors.length) {
    setErrors("편집이 유효하지 않아 마지막 정상 상태를 유지합니다.", errors);
    if (rerenderOnError) renderDetail();
    return false;
  }

  const newTransaction = !key || state.editKey !== key;
  if (newTransaction) {
    pushUndo(previous);
    state.previewBefore = previous;
  }
  state.editKey = key;
  state.doc = draft;

  if (structural) {
    renderAll();
  } else {
    if (sidebar) renderSidebar();
    const before = state.previewBefore ?? previous;
    const changed = changedOwnIndices(before, state.doc, state.selected);
    if (changed.size) {
      const start = state.page * PAGE_SIZE;
      const onPage = [...changed].some(
        (index) => index >= start && index < start + PAGE_SIZE,
      );
      if (!onPage) state.page = Math.floor(Math.min(...changed) / PAGE_SIZE);
    }
    renderPreview();
    renderGrid();
    updateUndoButtons();
    renderTextureStatus();
  }
  clearErrorStatus();
  return true;
}

function undo() {
  if (!state.undo.length) return;
  const current = clone(state.doc);
  state.redo.push(current);
  state.previewBefore = current;
  state.doc = state.undo.pop();
  state.editKey = null;
  ensureSelection();
  renderAll();
  setStatus("실행 취소했습니다.", "info");
}

function redo() {
  if (!state.redo.length) return;
  const current = clone(state.doc);
  state.undo.push(current);
  state.previewBefore = current;
  state.doc = state.redo.pop();
  state.editKey = null;
  ensureSelection();
  renderAll();
  setStatus("다시 실행했습니다.", "info");
}

// -- selection and sidebar ---------------------------------------------------

function selectGroup(name, index = 0) {
  if (!state.doc?.groups[name]) return;
  const group = state.doc.groups[name];
  state.selected = name;
  state.glyph = Math.max(0, Math.min(index, group.count - 1));
  state.page = Math.floor(state.glyph / PAGE_SIZE);
  state.parentPreview = null;
  state.editKey = null;
  renderAll();
}

function renderSidebar() {
  if (!state.doc) {
    groupList.innerHTML = "";
    searchResults.hidden = true;
    return;
  }
  const query = searchInput.value.trim();
  if (!query) {
    searchResults.hidden = true;
    groupList.hidden = false;
    renderGroupList();
    renderTextureStatus();
    return;
  }

  groupList.hidden = true;
  searchResults.hidden = false;
  const results = searchDocument(state.doc, query, state.selected);
  if (!results.length) {
    searchResults.innerHTML = '<div class="search-empty">검색 결과 없음</div>';
  } else {
    searchResults.innerHTML = results
      .map(
        (result) => `
          <button type="button" class="search-result" data-action="select-group"
            data-group="${esc(result.group)}"
            ${result.index === undefined ? "" : `data-index="${result.index}"`}>
            <span class="search-label">${esc(result.label)}</span>
            <span class="search-detail">${esc(result.detail)}</span>
          </button>`,
      )
      .join("");
  }
  renderTextureStatus();
}

function renderGroupList() {
  if (!state.doc) {
    groupList.innerHTML = "";
    return;
  }
  const rows = Object.entries(state.doc.groups).map(([name, group]) => {
    const empty = descriptionText(group.description);
    const missing = empty === "(no description)";
    return `
      <button type="button" class="group-row ${name === state.selected ? "selected" : ""}"
        data-action="select-group" data-group="${esc(name)}"
        title="${esc(empty)}">
        <span class="group-name">${esc(name)}</span>
        <span class="group-meta ${missing ? "missing" : ""}">${esc(empty)}</span>
      </button>`;
  });
  groupList.innerHTML = rows.join("");
}

// -- detail panel ------------------------------------------------------------

function textureEditor(group) {
  if (!group.texture) {
    return `
      <div class="field-group">
        <h3>텍스처</h3>
        <p class="muted">텍스처 없음 · 임포트나 빈 글리프로 구성됩니다.</p>
      </div>`;
  }
  const sets = Object.keys(state.doc.texture_sets ?? {});
  const sources = Object.keys(state.doc.texture_sets?.[group.texture.set] ?? {});
  return `
    <div class="field-group">
      <h3>텍스처 소스 영역</h3>
      <div class="field-grid">
        <label class="field">
          <span>세트</span>
          <select data-field="textureSet" data-edit-key="textureSet">
            ${sets.map((name) => `<option ${name === group.texture.set ? "selected" : ""}>${esc(name)}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>소스</span>
          <select data-field="textureSource" data-edit-key="textureSource">
            ${sources.map((name) => `<option ${name === group.texture.source ? "selected" : ""}>${esc(name)}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>시작 X</span>
          <input type="number" step="1" value="${group.texture.start[0]}"
            data-field="textureStartX" data-edit-key="textureStartX" />
        </label>
        <label class="field">
          <span>시작 Y</span>
          <input type="number" step="1" value="${group.texture.start[1]}"
            data-field="textureStartY" data-edit-key="textureStartY" />
        </label>
        <label class="field">
          <span>방향</span>
          <select data-field="textureDirection" data-edit-key="textureDirection">
            ${DIRECTIONS.map((direction) => `<option ${direction === group.texture.direction ? "selected" : ""}>${direction}</option>`).join("")}
          </select>
        </label>
      </div>
      <p class="field-hint">${esc(state.doc.texture_sets?.[group.texture.set]?.[group.texture.source] ?? "")}</p>
    </div>`;
}

function relationRow(entry, icon) {
  const empty = descriptionText(entry.description);
  const missing = empty === "(no description)";
  return `
    <li class="relation">
      <button type="button" class="relation-open" data-action="select-group" data-group="${esc(entry.name)}">
        <span class="relation-name">${icon} ${esc(entry.name)}</span>
        <span class="relation-desc ${missing ? "missing" : ""}">${esc(empty)}</span>
      </button>
      <span class="relation-stats">임포트 ${entry.importCount} · 배치 ${entry.placementCount.toLocaleString()}</span>
    </li>`;
}

function importEditor(imp, importIndex) {
  const groupOptions = groupNames(state.doc)
    .map((name) => `<option ${name === imp.group ? "selected" : ""}>${esc(name)}</option>`)
    .join("");
  const ats = (imp.at ?? [])
    .map((at, atIndex) => {
      const span = at.from[1] - at.from[0];
      const axes = (at.repeat ?? [])
        .map(
          (axis, axisIndex) => `
            <div class="axis-row">
              <span class="axis-title">repeat[${axisIndex}]</span>
              <label class="field-inline">count
                <input type="number" min="1" step="1" value="${axis.count}"
                  data-field="count" data-import="${importIndex}" data-at="${atIndex}"
                  data-axis="${axisIndex}" data-edit-key="imports.${importIndex}.at.${atIndex}.axis.${axisIndex}.count" />
              </label>
              <label class="field-inline">from_stride
                <input type="number" step="1" value="${axis.from_stride ?? ""}" placeholder="0"
                  data-field="fromStride" data-import="${importIndex}" data-at="${atIndex}"
                  data-axis="${axisIndex}" data-edit-key="imports.${importIndex}.at.${atIndex}.axis.${axisIndex}.fromStride" />
              </label>
              <label class="field-inline">to_stride
                <input type="number" step="1" value="${axis.to_stride ?? ""}" placeholder="${span}"
                  data-field="toStride" data-import="${importIndex}" data-at="${atIndex}"
                  data-axis="${axisIndex}" data-edit-key="imports.${importIndex}.at.${atIndex}.axis.${axisIndex}.toStride" />
              </label>
              <button type="button" class="icon-button" data-action="remove-axis"
                data-import="${importIndex}" data-at="${atIndex}" data-axis="${axisIndex}"
                title="반복 축 삭제">✕</button>
            </div>`,
        )
        .join("");
      return `
        <div class="at-card">
          <div class="at-head">
            <span class="at-title">at[${atIndex}]</span>
            <label class="field-inline">from
              <input type="number" step="1" value="${at.from[0]}"
                data-field="fromA" data-import="${importIndex}" data-at="${atIndex}"
                data-edit-key="imports.${importIndex}.at.${atIndex}.fromA" />
              <span class="range-dash">–</span>
              <input type="number" step="1" value="${at.from[1]}"
                data-field="fromB" data-import="${importIndex}" data-at="${atIndex}"
                data-edit-key="imports.${importIndex}.at.${atIndex}.fromB" />
            </label>
            <label class="field-inline">to
              <input type="number" min="0" step="1" value="${at.to}"
                data-field="to" data-import="${importIndex}" data-at="${atIndex}"
                data-edit-key="imports.${importIndex}.at.${atIndex}.to" />
            </label>
            <button type="button" class="icon-button" data-action="remove-at"
              data-import="${importIndex}" data-at="${atIndex}" title="at 규칙 삭제">✕</button>
          </div>
          <div class="axis-list">${axes}</div>
          <button type="button" class="small-button" data-action="add-axis"
            data-import="${importIndex}" data-at="${atIndex}">+ 반복 축</button>
        </div>`;
    })
    .join("");

  return `
    <article class="import-card">
      <div class="import-head">
        <label class="field">
          <span>소스 그룹</span>
          <select data-field="importGroup" data-import="${importIndex}"
            data-edit-key="imports.${importIndex}.group">${groupOptions}</select>
        </label>
        <label class="field">
          <span>오프셋 X</span>
          <input type="number" step="1" value="${imp.offset[0]}"
            data-field="offsetX" data-import="${importIndex}"
            data-edit-key="imports.${importIndex}.offsetX" />
        </label>
        <label class="field">
          <span>오프셋 Y</span>
          <input type="number" step="1" value="${imp.offset[1]}"
            data-field="offsetY" data-import="${importIndex}"
            data-edit-key="imports.${importIndex}.offsetY" />
        </label>
        <button type="button" class="icon-button" data-action="remove-import"
          data-import="${importIndex}" title="임포트 삭제">✕</button>
      </div>
      <div class="at-list">${ats}</div>
      <button type="button" class="small-button" data-action="add-at"
        data-import="${importIndex}">+ at 규칙</button>
    </article>`;
}

function renderDetail() {
  const group = currentGroup();
  if (!group) {
    detail.innerHTML = "";
    return;
  }
  const childEntries = children(state.doc, state.selected);
  const parentEntries = parents(state.doc, state.selected);
  const imports = group.imports ?? [];

  detail.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>${esc(state.selected)}</h2>
        <p class="group-facts">${group.size[0]}×${group.size[1]} · 글리프 ${group.count.toLocaleString()} · ${esc(groupKind(group))}</p>
      </div>
      <span class="badge">${group.texture ? "텍스처" : imports.length ? "임포트" : "빈 그룹"}</span>
    </div>

    <div class="detail-columns">
      <div class="stack">
        <label class="field-label" for="description-input">설명 (description)</label>
        <textarea id="description-input" class="description-input" rows="3"
          data-field="description" data-edit-key="description"
          placeholder="이 그룹의 사람이 읽는 설명">${esc(group.description ?? "")}</textarea>
        <p class="field-hint">비어 있으면 목록과 자식 패널에 ${esc("(no description)")}으로 표시됩니다.</p>
        ${textureEditor(group)}
      </div>

      <div class="stack">
        <h3>직계 자식 <span class="count">${childEntries.length}</span></h3>
        <ul class="relation-list">
          ${childEntries.length ? childEntries.map((entry) => relationRow(entry, "↳")).join("") : '<li class="muted">없음</li>'}
        </ul>
        <h3>직계 부모 <span class="count">${parentEntries.length}</span></h3>
        <ul class="relation-list">
          ${parentEntries.length ? parentEntries.map((entry) => relationRow(entry, "↰")).join("") : '<li class="muted">없음</li>'}
        </ul>
      </div>
    </div>

    <div class="imports-section">
      <div class="section-head">
        <h3>임포트 규칙 <span class="count">${imports.length}</span></h3>
        <button type="button" class="small-button" data-action="add-import">+ 임포트 추가</button>
      </div>
      <p class="field-hint">at은 자식 그룹의 인덱스 범위를 대상 인덱스에 순서대로 배치합니다. 반복 축의 기본 to_stride는 from 범위 길이입니다.</p>
      <div class="import-list">
        ${imports.length ? imports.map((imp, index) => importEditor(imp, index)).join("") : '<p class="muted">임포트 없음</p>'}
      </div>
    </div>`;
}

// -- preview -----------------------------------------------------------------

function appendGlyphPair(container, groupName, index, beforeDoc, afterDoc, scale, showLabels) {
  const imagesBefore = imagesForDoc(beforeDoc);
  const imagesAfter = imagesForDoc(afterDoc);
  for (const [label, doc, images] of [
    ["이전", beforeDoc, imagesBefore],
    ["이후", afterDoc, imagesAfter],
  ]) {
    const figure = document.createElement("figure");
    const caption = document.createElement("figcaption");
    caption.textContent = label;
    const canvas = document.createElement("canvas");
    canvas.className = "glyph-canvas";
    if (doc.groups[groupName] && index >= 0 && index < doc.groups[groupName].count) {
      renderGlyphCanvas(canvas, doc, images, groupName, index, scale);
    }
    figure.append(caption, canvas);
    container.append(figure);
  }
  if (showLabels) {
    const label = document.createElement("div");
    label.className = "pair-label";
    label.textContent = glyphLabel(afterDoc, groupName, index);
    container.append(label);
  }
}

function renderPreview() {
  const group = currentGroup();
  if (!group) {
    preview.innerHTML = "";
    return;
  }
  const before = state.previewBefore ?? state.doc;
  const changed = [...changedOwnIndices(before, state.doc, state.selected)].sort(
    (a, b) => a - b,
  );
  const glyphImpact = glyphFieldsChanged(
    before.groups?.[state.selected],
    state.doc.groups[state.selected],
  );
  const parentGlyphs = glyphImpact
    ? affectedParentGlyphs(state.doc, state.selected)
    : [];
  const parentTotal = parentGlyphs.reduce((total, entry) => total + entry.indices.length, 0);
  const selectedLabel = glyphLabel(state.doc, state.selected, state.glyph);

  const changedHtml = changed.length
    ? changed
        .slice(0, MAX_CHANGED_PREVIEWS)
        .map(
          (index) => `
            <div class="changed-row">
              <div class="changed-label">${esc(glyphLabel(state.doc, state.selected, index))}</div>
              <div class="glyph-pair" data-changed-index="${index}"></div>
            </div>`,
        )
        .join("")
    : '<p class="muted">변경된 글리프가 없습니다. 설명 편집은 글리프에 영향을 주지 않습니다.</p>';

  const optionEntries = [];
  for (const entry of parentGlyphs) {
    for (const index of entry.indices) {
      if (optionEntries.length >= MAX_PARENT_OPTIONS) break;
      optionEntries.push({ group: entry.name, index });
    }
    if (optionEntries.length >= MAX_PARENT_OPTIONS) break;
  }
  if (
    !state.parentPreview ||
    !optionEntries.some(
      (entry) =>
        entry.group === state.parentPreview.group &&
        entry.index === state.parentPreview.index,
    )
  ) {
    state.parentPreview = optionEntries[0] ?? null;
  }

  const parentOptions = optionEntries
    .map(
      (entry, position) => `
        <option value="${position}" ${state.parentPreview?.group === entry.group && state.parentPreview?.index === entry.index ? "selected" : ""}
          data-group="${esc(entry.group)}" data-index="${entry.index}">${esc(entry.group)}[${entry.index}]</option>`,
    )
    .join("");

  preview.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>영향 미리보기</h2>
        <p class="group-facts">${state.previewBefore ? "마지막 변경의 이전/이후" : "현재 상태"} · ${esc(selectedLabel)}</p>
      </div>
      <div class="impact-counts">
        <span>이 그룹 <strong>${changed.length.toLocaleString()}</strong></span>
        <span>직접 부모 <strong>${parentTotal.toLocaleString()}</strong></span>
      </div>
    </div>

    <div class="preview-block">
      <h3>선택한 글리프</h3>
      <div class="glyph-pair selected-pair" data-selected-pair></div>
    </div>

    <div class="preview-block">
      <h3>변경된 글리프 <span class="count">${changed.length.toLocaleString()}</span></h3>
      <div class="changed-list">${changedHtml}</div>
      ${changed.length > MAX_CHANGED_PREVIEWS ? `<p class="field-hint">처음 ${MAX_CHANGED_PREVIEWS}개만 표시합니다. 나머지 ${(changed.length - MAX_CHANGED_PREVIEWS).toLocaleString()}개도 그리드에 표시됩니다.</p>` : ""}
    </div>

    <div class="preview-block">
      <h3>직접 부모 글리프 <span class="count">${parentTotal.toLocaleString()}</span></h3>
      ${
        parentGlyphs.length
          ? `<div class="parent-summary">${parentGlyphs
              .map(
                (entry) =>
                  `<span>${esc(entry.name)} <strong>${entry.indices.length.toLocaleString()}</strong></span>`,
              )
              .join("")}</div>
             <label class="field parent-select">미리볼 부모 글리프
               <select data-select="parent-preview">${parentOptions}</select>
             </label>
             <div class="glyph-pair parent-pair" data-parent-pair></div>
             ${parentTotal > MAX_PARENT_OPTIONS ? `<p class="field-hint">목록에는 처음 ${MAX_PARENT_OPTIONS}개만 표시합니다. 총 ${parentTotal.toLocaleString()}개가 영향을 받습니다.</p>` : ""}`
          : '<p class="muted">이 그룹을 임포트하는 직접 부모가 없습니다.</p>'
      }
    </div>`;

  const selectedPair = preview.querySelector("[data-selected-pair]");
  if (selectedPair) {
    appendGlyphPair(
      selectedPair,
      state.selected,
      state.glyph,
      before,
      state.doc,
      3,
      false,
    );
  }
  for (const holder of preview.querySelectorAll("[data-changed-index]")) {
    const index = Number(holder.dataset.changedIndex);
    appendGlyphPair(holder, state.selected, index, before, state.doc, 3, false);
  }
  if (state.parentPreview) {
    const holder = preview.querySelector("[data-parent-pair]");
    if (holder) {
      appendGlyphPair(
        holder,
        state.parentPreview.group,
        state.parentPreview.index,
        before,
        state.doc,
        3,
        true,
      );
    }
  }
}

// -- grid --------------------------------------------------------------------

function renderGrid() {
  const group = currentGroup();
  if (!group) {
    grid.innerHTML = "";
    return;
  }
  const pageCount = Math.max(1, Math.ceil(group.count / PAGE_SIZE));
  state.page = Math.max(0, Math.min(state.page, pageCount - 1));
  const start = state.page * PAGE_SIZE;
  const count = Math.min(PAGE_SIZE, group.count - start);
  const columns = Math.min(GRID_COLUMNS, count);
  const rows = Math.ceil(count / columns);
  const slotWidth = Math.max(36, group.size[0] * GRID_SCALE) + 12;
  const slotHeight = Math.max(40, group.size[1] * GRID_SCALE) + 24;
  const unicodeByIndex = groupUnicodeByIndex(state.doc, state.selected);
  const before = state.previewBefore ?? state.doc;
  const changed = changedOwnIndices(before, state.doc, state.selected);

  grid.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>글리프 그리드</h2>
        <p class="group-facts">${start + 1}–${start + count} / ${group.count.toLocaleString()} · 클릭해서 글리프 선택</p>
      </div>
      <div class="grid-nav">
        <button type="button" class="small-button" data-action="page-prev" ${state.page === 0 ? "disabled" : ""}>←</button>
        <span>${state.page + 1} / ${pageCount}</span>
        <button type="button" class="small-button" data-action="page-next" ${state.page >= pageCount - 1 ? "disabled" : ""}>→</button>
      </div>
    </div>
    <div class="grid-scroll">
      <canvas id="grid-canvas" class="grid-canvas" aria-label="${esc(state.selected)} 글리프 그리드"></canvas>
    </div>`;

  const canvas = grid.querySelector("#grid-canvas");
  const width = slotWidth * columns;
  const height = slotHeight * rows;
  const ctx = prepareCanvas(canvas, width, height);
  const images = imagesForDoc(state.doc);

  ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textBaseline = "top";
  for (let offset = 0; offset < count; offset += 1) {
    const index = start + offset;
    const column = offset % columns;
    const row = Math.floor(offset / columns);
    const x = column * slotWidth;
    const y = row * slotHeight;
    const selected = index === state.glyph;

    if (selected) {
      ctx.fillStyle = "rgba(45, 108, 223, 0.10)";
      ctx.fillRect(x, y, slotWidth, slotHeight);
    }
    ctx.strokeStyle = selected ? "#2d6cdf" : "rgba(100, 116, 139, 0.25)";
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeRect(x + 0.5, y + 0.5, slotWidth - 1, slotHeight - 1);

    const glyphX = x + Math.floor((slotWidth - group.size[0] * GRID_SCALE) / 2);
    const glyphY = y + 4;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 1, y + 1, slotWidth - 2, group.size[1] * GRID_SCALE + 2);
    ctx.clip();
    drawGlyph(ctx, state.doc, images, state.selected, index, glyphX, glyphY, GRID_SCALE);
    ctx.restore();

    ctx.fillStyle = selected ? "#1d4ed8" : "#475569";
    ctx.fillText(String(index), x + 5, y + slotHeight - 22);
    const codepoint = unicodeByIndex.get(index);
    if (codepoint !== undefined) {
      ctx.fillStyle = "#64748b";
      ctx.fillText(formatCodepoint(codepoint), x + 5, y + slotHeight - 12);
    }
    if (changed.has(index)) {
      ctx.fillStyle = "#ea580c";
      ctx.beginPath();
      ctx.arc(x + slotWidth - 7, y + 7, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  canvas.addEventListener("click", (event) => {
    const x = event.offsetX;
    const y = event.offsetY;
    const column = Math.floor(x / slotWidth);
    const row = Math.floor(y / slotHeight);
    const index = start + row * columns + column;
    if (column < 0 || column >= columns || row < 0 || row >= rows) return;
    if (index < start || index >= start + count) return;
    state.glyph = index;
    state.editKey = null;
    renderGrid();
    renderPreview();
  });
}

// -- render all --------------------------------------------------------------

function renderAll() {
  if (!state.doc) {
    emptyState.hidden = false;
    editor.hidden = true;
    undoButton.disabled = true;
    redoButton.disabled = true;
    return;
  }
  ensureSelection();
  emptyState.hidden = true;
  editor.hidden = false;
  renderSidebar();
  renderDetail();
  renderPreview();
  renderGrid();
  updateUndoButtons();
  renderTextureStatus();
}

// -- export ------------------------------------------------------------------

function exportDocument() {
  if (!state.doc) return;
  try {
    const text = serializeDocument(state.doc);
    const base = state.sourceName
      ? state.sourceName.replace(/\.json$/i, "")
      : "definition";
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${base}-edited.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`${anchor.download} 파일을 내보냈습니다.`, "ok");
  } catch (error) {
    setErrors(
      "내보내기 전에 정의가 유효하지 않습니다. 마지막 정상 상태는 유지됩니다.",
      error.validationErrors ?? [error.message],
    );
  }
}

// -- events ------------------------------------------------------------------

detail.addEventListener("input", (event) => {
  const target = event.target.closest("[data-field]");
  if (!target || target.tagName === "SELECT") return;
  if (target.dataset.field === "parentPreview") return;
  let value;
  if (target.type === "number") {
    if (target.value.trim() === "") {
      if (target.dataset.field === "fromStride" || target.dataset.field === "toStride") {
        value = undefined;
      } else {
        return;
      }
    } else {
      value = Number(target.value);
      if (!Number.isInteger(value)) {
        setStatus("정수만 입력할 수 있습니다.", "error");
        return;
      }
    }
  } else {
    value = target.value;
  }
  editDoc((draft) => applyField(draft, target.dataset, value), {
    key: target.dataset.editKey,
    sidebar: target.dataset.field === "description",
  });
});

detail.addEventListener("change", (event) => {
  const target = event.target.closest("select[data-field]");
  if (!target) return;
  const field = target.dataset.field;
  editDoc((draft) => applyField(draft, target.dataset, target.value), {
    key: target.dataset.editKey,
    structural: field === "textureSet" || field === "importGroup",
    rerenderOnError: true,
  });
});

detail.addEventListener("focusout", () => {
  state.editKey = null;
});

detail.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button || !state.doc) return;
  const action = button.dataset.action;
  if (action === "select-group") {
    selectGroup(button.dataset.group);
    return;
  }
  const importIndex = Number(button.dataset.import);
  const atIndex = Number(button.dataset.at);
  const axisIndex = Number(button.dataset.axis);

  if (action === "add-import") {
    const other = groupNames(state.doc).find((name) => name !== state.selected) ?? state.selected;
    editDoc(
      (draft) => {
        const group = draft.groups[state.selected];
        group.imports ??= [];
        group.imports.push({
          group: other,
          offset: [0, 0],
          at: [{ from: [0, 1], to: 0 }],
        });
      },
      { structural: true },
    );
  } else if (action === "remove-import") {
    editDoc(
      (draft) => {
        draft.groups[state.selected].imports.splice(importIndex, 1);
      },
      { structural: true },
    );
  } else if (action === "add-at") {
    editDoc(
      (draft) => {
        draft.groups[state.selected].imports[importIndex].at.push({
          from: [0, 1],
          to: 0,
        });
      },
      { structural: true },
    );
  } else if (action === "remove-at") {
    editDoc(
      (draft) => {
        draft.groups[state.selected].imports[importIndex].at.splice(atIndex, 1);
      },
      { structural: true },
    );
  } else if (action === "add-axis") {
    editDoc(
      (draft) => {
        const at = draft.groups[state.selected].imports[importIndex].at[atIndex];
        at.repeat ??= [];
        at.repeat.push({ count: 1 });
      },
      { structural: true },
    );
  } else if (action === "remove-axis") {
    editDoc(
      (draft) => {
        const at = draft.groups[state.selected].imports[importIndex].at[atIndex];
        at.repeat.splice(axisIndex, 1);
      },
      { structural: true },
    );
  }
});

preview.addEventListener("change", (event) => {
  const target = event.target.closest('select[data-select="parent-preview"]');
  if (!target) return;
  const option = target.selectedOptions[0];
  if (!option) return;
  state.parentPreview = {
    group: option.dataset.group,
    index: Number(option.dataset.index),
  };
  renderPreview();
});

grid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  if (button.dataset.action === "page-prev") {
    state.page = Math.max(0, state.page - 1);
    renderGrid();
  } else if (button.dataset.action === "page-next") {
    state.page += 1;
    renderGrid();
  }
});

groupList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='select-group']");
  if (button) selectGroup(button.dataset.group);
});

searchResults.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='select-group']");
  if (!button) return;
  const index = button.dataset.index === undefined ? 0 : Number(button.dataset.index);
  searchInput.value = "";
  selectGroup(button.dataset.group, index);
});

searchInput.addEventListener("input", renderSidebar);
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    const first = searchResults.querySelector("[data-action='select-group']");
    if (first) first.click();
  } else if (event.key === "Escape") {
    searchInput.value = "";
    renderSidebar();
  }
});

undoButton.addEventListener("click", undo);
redoButton.addEventListener("click", redo);

document.querySelector("#load-example").addEventListener("click", loadExample);
document.querySelector("#export-json").addEventListener("click", exportDocument);

document.querySelector("#open-json").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    loadDocumentText(await file.text(), { sourceName: file.name, baseUrl: null });
  } catch (error) {
    setErrors("JSON 파일을 읽지 못했습니다.", [error.message]);
  }
  event.target.value = "";
});

document.querySelector("#open-textures").addEventListener("change", (event) => {
  for (const file of event.target.files ?? []) {
    state.textureFiles.set(file.name, file);
    if (state.fileUrls.has(file.name)) {
      URL.revokeObjectURL(state.fileUrls.get(file.name));
      state.fileUrls.delete(file.name);
    }
  }
  event.target.value = "";
  reloadTextures();
  setStatus("텍스처를 다시 불러왔습니다.", "info");
});

document.addEventListener("keydown", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
  }
});

window.addEventListener("resize", () => {
  if (state.doc) {
    renderGrid();
  }
});

renderAll();
loadExample();
