// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Decides the hub's order. Pure function, no DOM, tested under Node.
//   favourites: ordered by most recent use (unused ones keep the order they were added)
//   recent:     last `recentLimit` used tools that aren't favourites
//   rest/all:   everything else, alphabetical
// A search query replaces the groups with one flat list of matches: case and accents are ignored,
// and words of 4+ letters may have one typo (exact matches are listed first).

export function localize(value, lang = 'en') {
  if (value && typeof value === 'object') return value[lang] ?? value.en ?? '';
  return value ?? '';
}

const FUZZY_MIN = 4;

// Lowercase and strip accents, so "Café" matches "cafe".
export function fold(text) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

// At most one edit (wrong, missing or extra letter, or two neighbours swapped) between a and b.
export function withinOneEdit(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) {
    return a.slice(i + 1) === b.slice(i + 1)
      || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  }
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

// The term is within one edit of the start of the word ("calcu" or "clacu" for "calculator").
function nearPrefix(term, word) {
  for (let len = term.length - 1; len <= term.length + 1; len++) {
    if (len <= word.length && withinOneEdit(term, word.slice(0, len))) return true;
  }
  return false;
}

export function orderTools(tools, { favourites = [], recent = [], query = '', lang = 'en', categories = {}, recentLimit = 4 } = {}) {
  const byId = new Map(tools.map((t) => [t.id, t]));
  const q = fold(query.trim());

  if (q) {
    const terms = q.split(/\s+/);
    const scored = [];
    for (const tool of tools) {
      const haystack = fold([
        localize(tool.name, lang),
        localize(tool.description, lang),
        localize(categories[tool.category]?.label, lang),
        tool.category,
        ...(tool.tags ?? []),
      ].join(' '));
      const words = haystack.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      let fuzzy = false;
      const ok = terms.every((term) => {
        if (haystack.includes(term)) return true;
        fuzzy = true;
        return term.length >= FUZZY_MIN && words.some((w) => nearPrefix(term, w));
      });
      if (ok) scored.push({ tool, fuzzy });
    }
    const hits = [...scored.filter((s) => !s.fuzzy), ...scored.filter((s) => s.fuzzy)].map((s) => s.tool);
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
