// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Site-wide settings.
export const config = {
  name: 'sloppify',
  repoUrl: 'https://github.com/harcur/sloppify',
  branch: 'main',
  lang: 'en',
};

// Link to a folder in the repo. '' is the repo root.
export function sourceUrl(path = '') {
  return path ? `${config.repoUrl}/tree/${config.branch}/${path}` : config.repoUrl;
}
