# Declarative Texture Font Editor (v0.1)

- Status: v0.1 implemented in this directory. Later changes should update this design first.
- Audience: a coding agent with no prior context. It may implement this editor from this file plus `../../SPEC.md` and `../../examples/`.
- Goal: edit glyphs by arranging source groups as children, not by painting.
- Input model: the project is a directory of group definitions. Editing one group may change many glyphs that import it.

## 0. Handoff summary (read first)

1. Implement as a static web page with no server. Editing happens in the browser; data may be exported as files.
2. A group definition contains `description`. Show each group's description together with its direct child groups' descriptions.
3. Glyph picking follows `../../SPEC.md`'s conceptual model: group, local index, optional Unicode mapping.
4. If a group has no description, display it as empty; do not invent one.

---

## 1. Background: why this exists

Most pixel-font tools edit characters directly. This repository defines glyphs by groups, offsets, clipping, and repetition. Therefore the editor must expose relationships, not only final characters.

---

## 2. Terms

| Term | Definition |
|---|---|
| definition set | the full directory of group definitions loaded for editing |
| parent group | a group that imports another group |
| child group | a group being imported by a parent |
| description | a group's short human explanation, stored as text and shown by the editor |
| source region | a rectangle of glyph cells in a child group used by one import rule |
| live preview | a rendering of all affected glyphs after an edit, before export |

---

## 3. Confirmed facts and constraints

| # | Fact | Evidence | Design effect |
|---|---|---|---|
| C-1 | The editor must read and write descriptions for groups. | user request | Description is a first-class field. |
| C-2 | A group's description must be visible while editing that group. | user request | A visible description panel, not a hidden property only. |
| C-3 | Child groups' descriptions must also be shown with their names. | user request | The hierarchy view must be description-aware. |
| C-4 | Editing may change many glyphs at once. | shared group structure | Editing must show affected glyphs immediately. |
| C-5 | There is no server. | user decision | All parsing, editing, undo, and export are local. |
| C-6 | Definitions and example data already exist. | current repository | The editor must not require a new project format to start working. |

---

## 4. Non-goals (do not build)

- A font rasterizer or final TTF renderer inside this editor.
- A generic vector-drawing program.
- Full project management, version control, or cloud sync.
- A plugin system.

---

## 5. Product shape

Single static page.

Main areas:

1. Project/group browser
2. Hierarchy view for the selected group
3. Detail panel for the selected group and each direct child
4. Glyph-grid editor for the selected group
5. Preview of affected glyphs
6. Undo/redo and export controls

---

## 6. Data display requirements

### 6.1 Group detail panel

When a group is selected, show:

- group name
- `size`
- `count`
- its own `description`
- whether it has texture data, imports, Unicode mappings, or none of these

### 6.2 Child list

For every direct child of the selected group, show:

- child group name
- that child group's `description`, or an explicit empty state
- number of import rules from the parent into that child
- total number of source glyph placements contributed by that child

### 6.3 Hierarchy navigation

The hierarchy view must let the user:

- open a parent
- open a child
- jump directly to a child group for editing
- see, at a glance, which children lack descriptions

### 6.4 Empty description rule

If a group's description is absent or empty, display `(no description)` or equivalent empty-state text. Do not hide the field.

---

## 7. Editing model

### 7.1 What is edited

The user edits a selected group's local definition. This may include:

- texture-backed glyph source regions
- import rules into this group
- local offsets and repetition parameters
- the group's own description text

### 7.2 What is not edited here

The editor does not directly edit the final flattened font. If a change to a child affects many parents, that is expected and must be visible in preview.

### 7.3 Edit scope

A change made on a parent group's screen may modify only:

- that parent group, or
- the import entries belonging to that parent.

It must not silently rewrite unrelated children unless the user explicitly opens and edits that child.

---

## 8. Preview requirements

When the user changes a group, the editor must immediately show:

- the affected glyphs in the current group
- all directly affected parent glyphs
- a count of changed glyphs

Preview must preserve enough context to compare before and after. A simple previous/current view is sufficient for v0.1.

---

## 9. Search and navigation

The editor must provide a way to find:

- a group by name
- a glyph by local index
- a glyph by Unicode code point when a mapping exists

Search results must open the relevant group and, when possible, highlight the affected cell range.

---

## 10. State, undo, and export

### 10.1 In-memory state

The working state lives in browser memory while the page is open.

### 10.2 Undo / redo

The editor must provide undo and redo for at least the current editing session.

Minimum undoable actions:

- description text edits
- import-rule edits
- offset or repetition edits

### 10.3 Persistence

The editor must support exporting the edited definition set to files. The exact project file format is intentionally not specified in this version.

### 10.4 Recovery rule

If parsing or export fails, the editor must keep the last known good in-memory state available for inspection.

---

## 11. Interaction requirements

The editor should make the following possible in one continuous flow:

1. Select a group.
2. Read its description.
3. See its children and their descriptions.
4. Edit the selected group.
5. Inspect the resulting affected glyphs.
6. Undo if the result is wrong.
7. Export the updated definition set.

---

## 12. Acceptance criteria

The first version is acceptable when all of the following are true:

1. A user can open the existing example definition set.
2. Selecting a group shows its own description and all direct child descriptions.
3. Child descriptions are visible next to child names without opening another screen first.
4. Editing a group updates affected-glyph preview immediately.
5. Undo restores the previous state for the supported edit types.
6. Export produces updated files without requiring a server.
7. The editor works from the repository's current sample data without renaming or restructuring it.

---

## 13. Out-of-scope questions to resolve later

- Final on-disk project file format
- Exact diff presentation for before/after comparison
- Whether description editing supports multi-line text in v1.0
- Whether search will also index glyph metadata beyond name, index, and Unicode mapping

---

## 14. Open design decisions

- Should child descriptions also appear inside the preview pane, or only in the hierarchy/detail panes?
- Should empty descriptions be styled as warnings, or simply as blank states?
- Should undo history persist across page reloads, or remain session-only?

---

## 15. Appendix: UI copy requirement

Any empty description must be shown explicitly. Suggested label: `(no description)`.
