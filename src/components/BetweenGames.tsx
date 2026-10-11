import type { ReactNode } from 'react';
import type { PlayerId } from '../lib/engine/engine';
import { useCardDisplay } from '../lib/cardLocale';
import { matchWinner, type MatchScore } from '../lib/match';
import { useT } from '../i18n';
import type { Card } from '../types';
import { ManaCost } from './ManaCost';

/** The smallest main deck a game can start with. */
const MIN_MAIN = 20;

interface Props {
  score: MatchScore;
  names: [string, string];
  me: PlayerId;
  main: Card[];
  side: Card[];
  onChange: (main: Card[], side: Card[]) => void;
  onReady: () => void;
  /** Ready already sent (online): waiting for the opponent. */
  waiting?: boolean;
  /** Extra buttons (leave, change decks…). */
  children?: ReactNode;
}

/** Groups copies of the same card: [card, count], sorted by mana value then name. */
function group(cards: Card[]): [Card, number][] {
  const byId = new Map<string, [Card, number]>();
  for (const c of cards) {
    const cur = byId.get(c.id);
    if (cur) cur[1]++;
    else byId.set(c.id, [c, 1]);
  }
  return [...byId.values()].sort((a, b) => a[0].cmc - b[0].cmc || a[0].name.localeCompare(b[0].name));
}

/** Between two games of a match: the score, and sideboarding (move cards between main deck and sideboard). */
export function BetweenGames({ score, names, me, main, side, onChange, onReady, waiting, children }: Props) {
  const t = useT();
  const show = useCardDisplay();
  const opp: PlayerId = me === 0 ? 1 : 0;
  const winner = matchWinner(score);
  const move = (card: Card, from: Card[], to: Card[], toMain: boolean) => {
    const i = from.findIndex((c) => c.id === card.id);
    const rest = [...from.slice(0, i), ...from.slice(i + 1)];
    const added = [...to, card];
    if (toMain) onChange(added, rest);
    else onChange(rest, added);
  };
  const column = (cards: Card[], title: string, toMain: boolean) => (
    <div className="sb-column">
      <h4>{title} ({cards.length})</h4>
      <ul className="sb-list">
        {group(cards).map(([card, n]) => (
          <li key={card.id}>
            <button className="sb-card" onClick={() => move(card, toMain ? side : main, toMain ? main : side, toMain)} disabled={waiting} title={toMain ? t.match.toMain : t.match.toSide}>
              <span className="qty">{n}</span>
              <span className="card-name">{show.name(card)}</span>
              <ManaCost cost={card.manaCost} />
              <span className="arrow">{toMain ? '←' : '→'}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="panel between-games">
      <h3>
        {t.match.score(names[me], score.wins[me], score.wins[opp], names[opp])}
        <span className="muted small"> · {t.match.bestOf(score.bestOf)}</span>
      </h3>
      {winner !== null ? (
        <p className={winner === me ? 'ok' : 'error'}>{winner === me ? t.match.youWon : t.match.theyWon(names[opp])}</p>
      ) : (
        <>
          <p className="muted small">{t.match.sideboardHint}</p>
          <div className="sb-columns">
            {column(main, t.match.mainDeck, false)}
            {column(side, t.match.sideboard, true)}
          </div>
        </>
      )}
      <div className="row">
        {winner === null && (
          <button onClick={onReady} disabled={waiting || main.length < MIN_MAIN}>
            {waiting ? t.match.waiting(names[opp]) : t.match.startGame(score.games + 1)}
          </button>
        )}
        {main.length < MIN_MAIN && <span className="error small">{t.match.tooFew(MIN_MAIN)}</span>}
        {children}
      </div>
    </div>
  );
}
