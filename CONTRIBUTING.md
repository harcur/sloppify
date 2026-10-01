# Contributing

Contributions are welcome. Start with [docs/TOOL-GUIDELINES.md](docs/TOOL-GUIDELINES.md): it says what kind of tool fits the site and how heavy it may be. A new tool must:

- live in its own folder under `tools/`, started from `tools/_template/`, and be added to `tools.json`
- use the shared code in `shared/` for the page shell, storage, dialogs, theme and strings
- keep every visible string in its `strings.js`
- save data only through `openStore` in `shared/storage.js`, with a `migrate` function whenever the data's shape changes
- fit the guidelines: self-contained, nothing that goes stale, no trademarks or one-to-one copies of existing games or apps
- stay within the size budgets
- make no requests outside the site (no CDNs, remote fonts, analytics or APIs)
- have a designed layout for both mobile and desktop
- meet WCAG 2.2 AA: keyboard access, screen reader labels, contrast
- carry SPDX license headers on every file
- include tests, and pass CI

Tools that depend on a library under another license (for example GPL) vendor that library inside the tool's folder and include its `LICENSE` there.

How contributions fit with the site's "not hand-coded" notice is still being decided.
