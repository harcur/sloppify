// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Site-wide settings. Change repoUrl once the GitHub repo exists.
export const config = {
  name: 'sloppify',
  repoUrl: 'https://github.com/USERNAME/sloppify', // TODO: replace USERNAME
  branch: 'main',
  lang: 'en',
};

// Link to a folder in the repo. '' is the repo root.
export function sourceUrl(path = '') {
  return path ? `${config.repoUrl}/tree/${config.branch}/${path}` : config.repoUrl;
}
