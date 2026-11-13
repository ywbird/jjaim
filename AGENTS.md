# AGENTS.md

Repository for a Declarative Glyph Composition spec plus tools. Root [`SPEC.md`](SPEC.md) (Draft v0.3) is the canonical semantic definition; tool-specific specs only refine their own program. No TTF generator exists yet.

## Layout

- `SPEC.md` — canonical glyph/group/import/texture/Unicode rules. Do not extend the declaration format in a tool spec.
- `examples/` — shared fixtures: `hangul.json` (11,172 syllables + 95 ASCII mappings, 23 groups) and `ascii.json` (95 mappings, 6 groups), with PNG/BIN. Treat as read-only input.
- `tools/inspector/` — Python `glyph-inspect` CLI that validates declarations and renders PNG previews.
- `tools/declaration-editor/` — implemented static browser editor for group declarations. Moved from `tools/editor`; its README and the root readme still use the old path.
- `tools/editor/` — **new pixel-texture editor, spec only right now**. Read `tools/editor/SPEC.md` before implementing. It is a different program from `tools/declaration-editor`; don't read, modify, or reuse the declaration editor for it.
- `docs/SPEC.md.bak` — historical backup, not current spec.

## Commands

Inspector (run from `tools/inspector`; Python is managed by `uv`):

```sh
cd tools/inspector
uv sync
uv run pytest                                  # full suite
uv run pytest tests/test_decl.py -k <pattern>  # one test / one file
uv run glyph-inspect list ../../examples/hangul.json
uv run glyph-inspect groups ../../examples/hangul.json --format json --parts
uv run glyph-inspect text ../../examples/hangul.json --text 'ASCII 가각나' --output text.png
```

Declaration editor (run from `tools/declaration-editor`):

```sh
node --test                    # full suite
node --test src/model.test.mjs # one file
```

Serve either static page from the repo root and open the tool directory:

```sh
python3 -m http.server 8000
```

The new `tools/editor` has no `package.json` yet. Its spec requires `npm test` (DOM-free unit tests) and `npm run test:browser` (headless browser integration); add those when implementing.

Convert a BIN to PNG from the repo root (requires Pillow): `python3 tools/font_bin_to_png.py examples/hangul.bin`.

## Gotchas

- Inspector commands depend on the `tools/inspector` cwd and `../../examples` paths. `list`/`groups` never open texture files; `sheet`/`text` do. Exit codes: 2 usage, 3 declaration, 4 texture/IO.
- Inspector parsing is intentionally strict: duplicate keys, unknown fields, bad types, cycles, range escapes, and Unicode conflicts are errors. Don't relax this without changing the root spec and tests.
- Editor tests read `../../../examples`, so run them from `tools/declaration-editor` and never edit examples to make tests pass.
- Static apps must have no build step, no server runtime, no CDN/runtime dependency, and relative asset URLs (GitHub Pages subpath). UI text is Korean; code identifiers and commit messages are English.
- The declaration editor edits a full document clone, validates, then replaces state, and exports a new file. It must preserve fields it does not understand.
- The new editor's core invariants: declaration text is immutable; pixels are edited by absolute `(asset, x, y)`, not per-group copies; originals never change; bundled work format is PNG/ZIP only; history is persistent. See `tools/editor/SPEC.md` §3, §14–16 before touching storage or export.
- Generated `tools/inspector/sheet.png` and `text.png`, plus `.venv/`, `__pycache__/`, `.pytest_cache/`, and `.nanobot/` are gitignored. Don't stage them.
- Commits: Conventional Commits, imperative English subject ≤72 chars, one logical change. See `tools/declaration-editor/AGENTS.md` for editor-specific rules.
