// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

export const strings = {
  en: {
    'mines.name': 'mines',
    'mines.level': 'Board size',
    'mines.level.small': 'small',
    'mines.level.medium': 'medium',
    'mines.level.large': 'large',
    'mines.level.detail': '{rows} × {cols}, {mines} mines',
    'mines.density': 'Mine density',
    'mines.density.value': '{mines} mines, {pct}%',
    'mines.density.next': 'This game has {mines} mines. The new count starts with the next game.',
    'mines.left': 'mines left',
    'mines.time': 'time',
    'mines.new': 'New game',
    'mines.flagMode': 'Flag mode',
    'mines.options': 'Options',
    'mines.close': 'Close',
    'mines.board': 'Minefield, {rows} rows by {cols} columns',

    'mines.cell.hidden': 'hidden',
    'mines.cell.flag': 'flagged',
    'mines.cell.empty': 'empty',
    'mines.cell.one': '1 mine nearby',
    'mines.cell.many': '{n} mines nearby',
    'mines.cell.mine': 'mine',
    'mines.cell.exploded': 'mine, exploded',
    'mines.cell.wrongFlag': 'flagged, no mine',
    'mines.cell.label': 'row {row}, column {col}: {state}',

    'mines.say.opened': '{n} cells opened',
    'mines.say.flag': 'Flagged. {left} mines left',
    'mines.say.unflag': 'Flag removed. {left} mines left',
    'mines.status.won': 'Cleared in {time}.',
    'mines.status.best': 'Cleared in {time}. New best for this size.',
    'mines.status.lost': 'You opened a mine. Start a new game to try again.',

    'mines.confirm.title': 'start a new game?',
    'mines.confirm.body': 'The game in progress will be lost.',
    'mines.confirm.ok': 'New game',

    'mines.stats': 'your record',
    'mines.stats.best': 'best {time}',
    'mines.stats.none': 'no games yet',
    'mines.stats.custom': '{level}, {mines} mines',
    'mines.stats.won': '{won} won of {played}',

    'mines.help.title': 'how to play',
    'mines.help.goal': 'Open every cell that has no mine. A number tells how many of the eight cells around it hold mines. The first cell you open is always safe.',
    'mines.help.touch': 'Touch: tap to open. Long-press, or turn on flag mode, to flag a cell you think holds a mine.',
    'mines.help.mouse': 'Mouse: click to open, right-click to flag.',
    'mines.help.keys': 'Keyboard: arrow keys to move, Enter or Space to open, F to flag.',
    'mines.help.chord': 'Opening a number whose mines are all flagged opens the rest of its neighbours.',
  },
};
