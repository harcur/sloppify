// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Every visible string in the shared shell and hub. Add a language by adding a key next to "en".
export const strings = {
  en: {
    'skip': 'Skip to content',
    'menu': 'Menu',
    'menu.back': 'All tools',
    'menu.favAdd': 'Add to favourites',
    'menu.favRemove': 'Remove from favourites',
    'menu.theme': 'theme',
    'theme.system': 'System',
    'theme.light': 'Light',
    'theme.dark': 'Dark',
    'menu.data': 'your data',
    'data.export': 'Export',
    'data.import': 'Import',
    'data.resetTool': 'Reset {tool} data',
    'data.reset': 'Reset everything',

    'footer.text': 'AI-generated, no greed involved. No ads, no tracking, your data stays in this browser.',
    'footer.source': 'Source on GitHub',
    'sheet.close': 'Close',

    'notice.title': 'before you start',
    'notice.body': 'Not hand-coded at all, just generated with AI by a dev with no greed behind it. No ads, no tracking, and no server, so I couldn\u2019t collect your data even if I wanted to. Everything here is free to copy.',
    'notice.code': 'Read the code',
    'notice.ok': 'Got it',

    'dialog.cancel': 'Cancel',
    'dialog.ok': 'OK',
    'dialog.exportFirst': 'Export current data first',

    'import.title': 'Replace all your data?',
    'import.body': 'Everything sloppify has stored in this browser will be replaced with the contents of \u201c{file}\u201d. This can\u2019t be undone.',
    'import.confirm': 'Replace data',
    'import.invalidTitle': 'Can\u2019t import that file',
    'import.invalid': 'It isn\u2019t a sloppify backup, or it\u2019s from a newer version of the site. Nothing was changed.',
    'import.failed': 'The backup couldn\u2019t be written, possibly because browser storage is full. Your previous data was restored.',

    'reset.title': 'Reset everything?',
    'reset.body': 'This deletes everything sloppify has stored in this browser: favourites, settings and saved data from every tool. This can\u2019t be undone.',
    'reset.confirm': 'Reset everything',

    'resetTool.title': 'Reset {tool} data?',
    'resetTool.body': 'This deletes everything {tool} has stored in this browser, such as saved progress, records and settings. Other tools, favourites and the theme are kept. This can\u2019t be undone.',

    'incompat.title': 'Saved data needs attention',
    'incompat.body': 'The saved data for {tool} is from a version this page can\u2019t read. Export it to keep a copy, then reset {tool} to continue.',
    'incompat.reset': 'Reset {tool}',

    'toast.exported': 'Exported',
    'toast.imported': 'Imported',
    'toast.reset': 'Everything reset',
    'toast.resetTool': '{tool} data reset',
    'toast.favAdded': '{name} added to favourites',
    'toast.favRemoved': '{name} removed from favourites',
    'storage.unavailable': 'This browser is blocking storage, so nothing will be saved between visits.',

    'hub.title': 'sloppify',
    'hub.search': 'Search tools',
    'hub.placeholder': 'Find a tool or game',
    'hub.group.favourites': 'favourites',
    'hub.group.recent': 'recent',
    'hub.group.rest': 'everything else',
    'hub.group.all': 'all tools',
    'hub.group.results': 'search results',
    'hub.star': 'Favourite {name}',
    'hub.results': '{n} results',
    'hub.result1': '1 result',
    'hub.noResults': 'Nothing matches \u201c{q}\u201d. Try another word.',
    'hub.loadFailed': 'The tool list didn\u2019t load. Check your connection and reload the page.',
  },
};
