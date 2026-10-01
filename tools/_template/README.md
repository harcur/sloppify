# Tool template

Starting point for a new tool. This folder isn't listed in `tools.json` and isn't deployed.

0. Read `docs/TOOL-GUIDELINES.md` and check the idea against Part 1. Its checklist at the end covers everything below.
1. Copy this folder to `tools/<your-id>/`. The id is lowercase letters, digits and dashes.
2. Replace `my-tool` with your id in `app.js` and `strings.js`, and set the name and title.
3. Add an entry to `tools.json` with id, name, description, category, tags, license and path.
4. Keep every visible string in `strings.js`.
5. If the tool saves anything, use `openStore` from `shared/storage.js` and bump `version` with a `migrate` function whenever the saved data's shape changes. Never write to storage directly.
6. Design both a mobile and a desktop layout, and keep everything keyboard and screen reader accessible.
7. If the tool uses a library under a different license (for example GPL), vendor it inside this folder, add that license as `LICENSE` here, set `license` in `tools.json` and in `app.js`, and mark the files with SPDX headers.
8. Add tests under `tests/`.
