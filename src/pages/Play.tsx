import { useEffect, useRef, useState } from 'react';
import { BetweenGames } from '../components/BetweenGames';
import { useSearchParams } from 'react-router-dom';
import { DeckPicker, EngineSummary, LifeChoice, ModeTile, Segmented } from '../components/Setup';
import { GameBoard } from '../components/GameBoard';
import { botAction, fallbackAction } from '../lib/engine/bot';
import { actor, apply, IllegalAction, newGame, teamOf, teamsOf, type GameState, type PlayerId } from '../lib/engine/engine';
import { loadDeck75 } from '../lib/loadDeck';
import { matchWinner, newMatch, nextFirst, recordGame, type MatchScore } from '../lib/match';
import type { Card } from '../types';
import { errorText, useT, type AppError } from '../i18n';
import { useApp } from '../store/useApp';

/** You are player 0; in Two-Headed Giant your teammate is player 1 (a bot), and players 2 and 3 are the opponents. */
const ME: PlayerId = 0;
const BOT_DELAY_MS = 650;

export function Play() {
  const t = useT();
  const decks = useApp((s) => s.decks);
  const [game, setGame] = useState<GameState | null>(null);
  // "/play?deck=<id>" (from the home page) preselects that deck.
  const [params] = useSearchParams();
  const [myDeck, setMyDeck] = useState(() => {
    const wanted = params.get('deck');
    return wanted && decks.some((d) => d.id === wanted) ? wanted : (decks[0]?.id ?? 'preset-red');
  });
  const [botDeck, setBotDeck] = useState('preset-green');
  // Two-Headed Giant: your bot teammate's deck and the second opponent's.
  const [twoHeaded, setTwoHeaded] = useState(false);
  const [commander, setCommander] = useState(false);
  // A Commander duel: 40 life (the official rules) or 20 (Duel Commander).
  const [duelLife, setDuelLife] = useState<40 | 20>(40);
  const [allyDeck, setAllyDeck] = useState('preset-red');
  // A Commander deck turns Commander rules on; without a commander in it, say how to set one.
  const chosen = decks.find((d) => d.id === myDeck);
  useEffect(() => {
    if (chosen?.format === 'commander') setCommander(true);
  }, [chosen?.format]);
  const missingCommander = commander && !!chosen && !chosen.entries.some((e) => e.board === 'commander');
  const [botDeck2, setBotDeck2] = useState('preset-red');
  const [first, setFirst] = useState<'random' | 'me' | 'bot'>('random');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [bestOf, setBestOf] = useState<1 | 3>(1);
  // The match being played: its score, your main deck and sideboard (changed by sideboarding), the bot's deck.
  const [match, setMatch] = useState<MatchScore | null>(null);
  const [myCards, setMyCards] = useState<{ main: Card[]; side: Card[] } | null>(null);
  /** The other players' decks (seat 1, 2, 3…) and everyone's commanders. */
  const [botCards, setBotCards] = useState<Card[][]>([]);
  const [commanders, setCommanders] = useState<Card[][]>([]);
  const [between, setBetween] = useState(false);
  /** Who played first in the current game, and whether its result is already in the score. */
  const current = useRef<{ first: PlayerId; scored: boolean }>({ first: ME, scored: true });

  // Count each finished game once in the match score.
  useEffect(() => {
    if (!game || game.winner === null || current.current.scored) return;
    current.current.scored = true;
    // The score is kept per team.
    setMatch((m) => (m ? recordGame(m, game.winner === 'draw' ? 'draw' : teamOf(game, game.winner!), teamOf(game, current.current.first)) : m));
  }, [game]);

  // The bot acts on a timer so the human can follow what it does.
  useEffect(() => {
    const bot = (g: GameState) => { const a = actor(g); return a !== null && a !== ME; };
    if (!game || !bot(game)) return;
    const timer = setTimeout(() => {
      setGame((g) => {
        if (!g || !bot(g)) return g;
        try {
          return apply(g, botAction(g));
        } catch (e) {
          if (!(e instanceof IllegalAction)) throw e;
          return apply(g, fallbackAction(g));
        }
      });
    }, BOT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [game]);

  function startGame(firstPlayer: PlayerId, mine: Card[], others: Card[][], cmd: Card[][] = commanders) {
    current.current = { first: firstPlayer, scored: false };
    setBetween(false);
    // An empty name is displayed as "You" in the current language.
    const names = others.length === 3 ? ['', t.play.allyName, t.play.botName1, t.play.botName2] : ['', t.play.botName];
    setGame(newGame({
      decks: [mine, ...others], names, first: firstPlayer,
      mode: { twoHeaded: others.length === 3, commander, ...(commander && others.length === 1 && duelLife === 20 ? { duelCommander: true } : {}) },
      ...(commander ? { commanders: cmd } : {}),
      // A rematch keeps the full control setting.
      fullControl: game?.fullControl?.length === others.length + 1 ? game.fullControl : undefined,
    }));
  }

  /** A new match (one game, or the first game of a best of 3) with the chosen decks. */
  async function start() {
    setLoading(true);
    setError(null);
    try {
      const seats = twoHeaded ? [allyDeck, botDeck, botDeck2] : [botDeck];
      const [mine, ...others] = await Promise.all([loadDeck75(myDeck, decks), ...seats.map((id) => loadDeck75(id, decks))]);
      if ([mine, ...others].some((d) => d.main.length < 20)) return setError({ code: 'decksTooSmall', params: { n: 20 } });
      // The opponents' first player: seat 1 in a duel, seat 2 in Two-Headed Giant.
      const them: PlayerId = twoHeaded ? 2 : 1;
      const firstPlayer: PlayerId = first === 'me' ? ME : first === 'bot' ? them : Math.random() < 0.5 ? ME : them;
      const cmd = [mine, ...others].map((d) => d.commander);
      setMatch(newMatch(bestOf));
      setMyCards(mine);
      setBotCards(others.map((d) => d.main));
      setCommanders(cmd);
      startGame(firstPlayer, mine.main, others.map((d) => d.main), cmd);
    } catch (e) {
      setError({ code: 'loadFailed', params: { message: e instanceof Error ? e.message : String(e) } });
    } finally {
      setLoading(false);
    }
  }

  if (!game) {
    const mode = twoHeaded ? 'twoHeaded' : 'duel';
    return (
      <div className="page setup">
        <h1>{t.play.title}</h1>

        <section className="setup-section">
          <h4>{t.play.gameType}</h4>
          <div className="mode-tiles">
            {(['duel', 'twoHeaded'] as const).map((m) => (
              <ModeTile key={m} mode={m} text={t.play.modes[m]} on={mode === m} onClick={() => setTwoHeaded(m === 'twoHeaded')} />
            ))}
            <ModeTile mode="commander" text={t.play.modes.commander} on={commander} onClick={() => setCommander(!commander)} />
          </div>
        </section>

        <section className="deck-pickers">
          <DeckPicker label={t.play.yourDeck} value={myDeck} onChange={setMyDeck} />
          {twoHeaded && <DeckPicker label={t.play.allyDeck} value={allyDeck} onChange={setAllyDeck} />}
          <DeckPicker label={twoHeaded ? t.play.botDeck1 : t.play.botDeck} value={botDeck} onChange={setBotDeck} />
          {twoHeaded && <DeckPicker label={t.play.botDeck2} value={botDeck2} onChange={setBotDeck2} />}
        </section>

        <section className="setup-options">
          <Segmented
            label={t.match.format}
            value={bestOf}
            options={[[1, t.match.single], [3, t.match.bo3]]}
            onChange={setBestOf}
          />
          {commander && !twoHeaded && <LifeChoice value={duelLife} onChange={setDuelLife} />}
          <Segmented
            label={t.play.first}
            value={first}
            options={[['random', t.play.firstOptions.random], ['me', t.play.firstOptions.me], ['bot', t.play.firstOptions.bot]]}
            onChange={setFirst}
          />
          <button className="start-button" onClick={start} disabled={loading}>{loading ? t.common.loadingCards : t.play.start}</button>
        </section>
        {missingCommander && <div className="error small">{t.game.noCommanderInDeck(chosen!.name)}</div>}
        {error && <div className="error small">{errorText(t, error)}</div>}

        <EngineSummary deck={chosen} />
      </div>
    );
  }

  // The match score is per team: team 0 is you (and your teammate), team 1 the bots.
  const two = game.players.length === 4;
  const names: [string, string] = two ? [`${t.game.you} & ${t.play.allyName}`, `${t.play.botName1} & ${t.play.botName2}`] : [t.game.you, t.play.botName];
  const winnerTeam = game.winner === null || game.winner === 'draw' ? 'draw' : teamOf(game, game.winner);
  /** The first player of a team (who starts its turns). */
  const lead = (team: number) => teamsOf(game)[team][0];
  const changeDecks = () => {
    setGame(null);
    setMatch(null);
    setBetween(false);
  };

  // Between two games of a best of 3: sideboarding, then the loser plays first.
  if (between && match && myCards) {
    return (
      <div className="page">
        <BetweenGames
          score={match}
          names={names}
          me={0}
          main={myCards.main}
          side={myCards.side}
          onChange={(main, side) => setMyCards({ main, side })}
          onReady={() => startGame(lead(nextFirst(winnerTeam, match.lastFirst ?? 0)), myCards.main, botCards)}
        >
          {matchWinner(match) !== null && <button onClick={start}>{t.match.newMatch}</button>}
          <button className="secondary" onClick={changeDecks}>{t.play.changeDecks}</button>
        </BetweenGames>
      </div>
    );
  }

  const bo3 = match?.bestOf === 3;
  const over = match ? matchWinner(match) !== null : true;
  return (
    <div className="page play">
      <GameBoard
        game={game}
        me={ME}
        onAction={(action) => setGame(apply(game, action))}
        notice={bo3 && match ? <div className="muted">{t.match.inGame(match.games + (game.winner === null ? 1 : 0), t.match.score(names[0], match.wins[0], match.wins[1], names[1]))}</div> : undefined}
        endControls={
          <>
            {bo3 && !over && <button onClick={() => setBetween(true)}>{t.match.nextGame}</button>}
            {bo3 && over && <button onClick={() => setBetween(true)}>{t.match.score(names[0], match!.wins[0], match!.wins[1], names[1])}</button>}
            <button className={bo3 && !over ? 'secondary' : ''} onClick={start}>{bo3 ? t.match.newMatch : t.play.rematch}</button>
            <button className="secondary" onClick={changeDecks}>{t.play.changeDecks}</button>
          </>
        }
      />
    </div>
  );
}
