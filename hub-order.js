// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Decides the hub's order. Pure function, no DOM, tested under Node.
//   favourites: ordered by most recent use (unused ones keep the order they were added)
//   recent:     last `recentLimit` used tools that aren't favourites
//   rest/all:   everything else, alphabetical
// A search query replaces the groups with one flat list of matches.

export function localize(value, lang = 'en') {
  if (value && typeof value === 'object') return value[lang] ?? value.en ?? '';
  return value ?? '';
}

export function orderTools(tools, { favourites = [], recent = [], query = '', lang = 'en', categories = {}, recentLimit = 4 } = {}) {
  const byId = new Map(tools.map((t) => [t.id, t]));
  const q = query.trim().toLowerCase();

  if (q) {
    const terms = q.split(/\s+/);
    const hits = tools.filter((tool) => {
      const haystack = [
        localize(tool.name, lang),
        localize(tool.description, lang),
        localize(categories[tool.category]?.label, lang),
        tool.category,
        ...(tool.tags ?? []),
      ].join(' ').toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
    return hits.length ? [{ key: 'results', items: hits }] : [];
  }

  const rank = (id) => { const i = recent.indexOf(id); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  const favIds = [...new Set(favourites)].filter((id) => byId.has(id));
  const favs = favIds.sort((a, b) => rank(a) - rank(b)).map((id) => byId.get(id));
  const favSet = new Set(favIds);

  const rec = [];
  for (const id of recent) {
    if (rec.length >= recentLimit) break;
    if (byId.has(id) && !favSet.has(id) && !rec.some((t) => t.id === id)) rec.push(byId.get(id));
  }

  const used = new Set([...favs, ...rec].map((t) => t.id));
  const rest = tools
    .filter((t) => !used.has(t.id))
    .sort((a, b) => localize(a.name, lang).localeCompare(localize(b.name, lang), lang));

  const groups = [];
  if (favs.length) groups.push({ key: 'favourites', items: favs });
  if (rec.length) groups.push({ key: 'recent', items: rec });
  if (rest.length) groups.push({ key: groups.length ? 'rest' : 'all', items: rest });
  return groups;
}
