# Contributing

Contributions are welcome. Everything a new tool or game has to follow is in [docs/TOOL-GUIDELINES.md](docs/TOOL-GUIDELINES.md): what fits the site, size budgets, how a tool is built, design, accessibility and tests. It ends with a checklist to go through before opening a pull request.

In short, a new tool must:

- be self-contained, with nothing that goes stale, a common everyday use and low stakes
- use no trademarks and not copy a specific existing game or app
- stay within its size budget
- live in its own folder under `tools/`, started from `tools/_template/`, describe itself in its `tool.json`, and have `tools.json` regenerated with `npm run tools`
- use the shared code in `shared/` for the page shell, storage, dialogs, theme and strings
- keep every visible string in its `strings.js`
- save data only through `openStore`, with a `migrate` function whenever the data's shape changes
- make no requests outside the site
- have designed mobile and desktop layouts, feel like an app on phones, and meet WCAG 2.2 AA
- carry SPDX license headers on every file
- include tests, and pass CI

How contributions fit with the site's "not hand-coded" notice is still being decided.
