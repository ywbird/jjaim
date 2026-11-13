# Editor contributor rules

## Commits

- Use Conventional Commits: `<type>(editor): <summary>`.
- Commit one logical change at a time. Do not mix refactoring, formatting, and behavior in one commit unless the behavior needs the refactor.
- Write the subject in imperative English, 72 characters or fewer, no trailing period.
- Add a body only when the reason is not visible in the diff, a breaking change is involved, or manual verification steps matter.
- Stage explicit paths. Never stage `.venv/`, `__pycache__/`, `.pytest_cache/`, `.nanobot/`, or generated PNG previews.
- Do not commit a change that fails `node --test` or that leaves the page with a console error.
- Keep user-visible UI text Korean, matching the repository README. Keep code identifiers and commit messages English.

## Scope

- The editor is a static page: HTML, CSS, and ES modules. No build step, no server, no new runtime dependency.
- Keep files under `tools/declaration-editor/`. Touch `../../SPEC.md` or `examples/` only when the editor cannot work without the change.
- The example definition set is read-only input; the editor must export a new file instead of rewriting it.
- Preserve unknown-to-the-editor data by editing a full document clone and validating before replacing the current state.
