import { LANGS, messagesFor } from '../i18n';
import type { ReplayFile } from './replay';

/**
 * A shared replay seen by someone else: its owner's seat is named after them where the game stored "You" (a game
 * against the bot, in any language; "You & Ally" in Two-Headed Giant). Online games have the players' names already.
 */
export function ownerNamed(file: ReplayFile, owner: string): ReplayFile {
  const start = file.replay.start;
  const seat = start.players[file.me];
  if (!seat) return file;
  const you = LANGS.map((l) => messagesFor(l).game.you).find((w) => seat.name === w || seat.name.startsWith(`${w} & `));
  if (you === undefined) return file;
  const players = start.players.map((p, i) => (i === file.me ? { ...p, name: owner + p.name.slice(you.length) } : p));
  return { ...file, replay: { ...file.replay, start: { ...start, players } } };
}
