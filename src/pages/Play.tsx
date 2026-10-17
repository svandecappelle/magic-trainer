import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BetweenGames } from '../components/BetweenGames';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CheckedDeckPicker, EngineSummary, ModePicker, Segmented, setupName, useBlockedDecks, useDeckName, useGameSetup } from '../components/Setup';
import { CONSTRUCTED_FORMATS, deckProblems, gameModeOf, type ConstructedFormat } from '../lib/gameModes';
import { GameBoard } from '../components/GameBoard';
import { botAction, fallbackAction } from '../lib/engine/bot';
import { actor, apply, IllegalAction, newGame, teamOf, teamsOf, type Action, type GameState, type PlayerId } from '../lib/engine/engine';
import { loadDeck75 } from '../lib/loadDeck';
import { deleteBotGame, listBotGames, loadBotGame, saveBotGame, type BotGame, type BotSetup, type MatchInfo } from '../lib/botGames';
import { newReplay, saveReplay, type Replay, type ReplayFile } from '../lib/replay';
import { saveResult, syncResults } from '../lib/history';
import { useAccount } from '../store/useAccount';
import { matchOver, matchWinner, newMatch, nextFirst, recordGame, type MatchScore } from '../lib/match';
import type { Card } from '../types';
import { errorText, useT, type AppError } from '../i18n';
import { useApp } from '../store/useApp';

/** You are player 0; in Two-Headed Giant your teammate is player 1 (a bot), and players 2 and 3 are the opponents. */
const ME: PlayerId = 0;
const BOT_DELAY_MS = 650;
/** Wait for the game to settle before saving it (the bot plays several actions in a row). */
const SAVE_DELAY_MS = 300;
/** Your actions that can be taken back, the most recent ones. */
const UNDO_KEEP = 30;

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
  // The game mode (Constructed in a format, Free Play, Commander, Duel Commander), Duel or Two-Headed Giant.
  const [gameSetup, setGameSetup] = useGameSetup();
  const twoHeaded = gameSetup.twoHeaded;
  const commander = !!gameModeOf(gameSetup).commander;
  const blocked = useBlockedDecks();
  const [allyDeck, setAllyDeck] = useState('preset-red');
  // Picking a Commander deck turns Commander on; a deck of a Constructed format picks that format.
  const chosen = decks.find((d) => d.id === myDeck);
  useEffect(() => {
    if (!chosen || game) return;
    if (chosen.format === 'commander' && !commander) setGameSetup({ ...gameSetup, mode: 'commander' });
    if (gameSetup.mode === 'constructed' && CONSTRUCTED_FORMATS.includes(chosen.format as ConstructedFormat)) setGameSetup({ ...gameSetup, format: chosen.format as ConstructedFormat });
  }, [chosen?.id]); // eslint-disable-line react-hooks/exhaustive-deps
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
  /** The current game's replay, and the match (its id, its games' replays, its result saved). */
  const replay = useRef<Replay | null>(null);
  const matchInfo = useRef<MatchInfo>({ id: '', replays: [], recorded: true });
  /** The states before your last actions, to take them back (the bot's answers with them). */
  const undoStack = useRef<{ game: GameState; steps: number }[]>([]);
  const loggedIn = useAccount((s) => !!s.user);

  // ---------- The game's own address: /play/<id>, saved in this browser (lib/botGames.ts) ----------
  const { gameId } = useParams();
  const navigate = useNavigate();
  /** The game shown, by id: set when a saved game is loaded or a new one starts, so neither is loaded again. */
  const loadedId = useRef<string | null>(null);
  /** /play/<id> of a game this browser no longer has. */
  const [missing, setMissing] = useState(false);
  const setup = (): BotSetup => ({ myDeck, botDeck, allyDeck, botDeck2, setup: gameSetup, first, bestOf });
  // Before the first paint: a reload shows the game, not the setup for a moment.
  useLayoutEffect(() => {
    if ((gameId ?? null) === loadedId.current) return;
    loadedId.current = gameId ?? null;
    const saved = gameId ? loadBotGame(gameId) : null;
    setMissing(!!gameId && !saved);
    if (!saved) {
      setGame(null);
      setMatch(null);
      setBetween(false);
      return;
    }
    const { setup: su } = saved;
    setMyDeck(su.myDeck); setBotDeck(su.botDeck); setAllyDeck(su.allyDeck); setBotDeck2(su.botDeck2);
    setGameSetup(su.setup); setFirst(su.first); setBestOf(su.bestOf);
    setMatch(saved.match); setMyCards(saved.myCards); setBotCards(saved.botCards); setCommanders(saved.commanders);
    setBetween(saved.between);
    current.current = saved.current;
    replay.current = saved.replay ?? null;
    matchInfo.current = saved.matchInfo ?? { id: gameId!, replays: [], recorded: false };
    undoStack.current = [];
    setGame(saved.game);
  }, [gameId]);
  // Saved after each change, once the game is still for a moment.
  useEffect(() => {
    if (!game || !gameId || loadedId.current !== gameId) return;
    const timer = setTimeout(() => {
      const saved: BotGame = {
        setup: setup(), game, match, myCards, botCards, commanders, between, current: current.current,
        ...(replay.current ? { replay: replay.current } : {}), matchInfo: matchInfo.current,
      };
      const opponents = twoHeaded ? [botDeck, botDeck2] : [botDeck];
      saveBotGame(gameId, saved, [deckName(myDeck), opponents.map(deckName).join(' & ')]);
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  });
  const deckName = useDeckName();

  /** "Mono Red vs Elves": the match's title in the history and the replays. */
  const opponentTitle = () => (twoHeaded ? [botDeck, botDeck2] : [botDeck]).map(deckName).join(' & ');

  // Count each finished game once in the match score, and keep its replay.
  useEffect(() => {
    if (!game || game.winner === null || current.current.scored) return;
    current.current.scored = true;
    undoStack.current = [];
    if (replay.current) {
      const file: ReplayFile = {
        id: crypto.randomUUID(), at: Date.now(), title: `${deckName(myDeck)} vs ${opponentTitle()}`, me: ME,
        replay: replay.current, end: { log: game.log.length, winner: game.winner },
      };
      if (saveReplay(file)) matchInfo.current.replays.push(file.id);
    }
    // The score is kept per team.
    setMatch((m) => (m ? recordGame(m, game.winner === 'draw' ? 'draw' : teamOf(game, game.winner!), teamOf(game, current.current.first)) : m));
  }, [game]);

  // A finished match goes in the history (and the account's, logged in).
  useEffect(() => {
    const info = matchInfo.current;
    if (!match || !matchOver(match) || info.recorded || !info.id) return;
    info.recorded = true;
    const winner = matchWinner(match);
    saveResult({
      id: info.id, at: Date.now(), kind: 'bot', twoHeaded, commander, bestOf: match.bestOf, deck: deckName(myDeck), opponent: opponentTitle(),
      result: winner === null ? 'draw' : winner === 0 ? 'win' : 'loss', wins: match.wins[0], losses: match.wins[1], replays: [...info.replays],
    });
    if (loggedIn) syncResults().catch(() => {}); // sent later from the History page otherwise
  }, [match]);

  /** Plays an action, recorded in the replay; `mine`: yours, which can be taken back. Throws IllegalAction. */
  function play(from: GameState, action: Action, mine: boolean) {
    const next = apply(from, action);
    if (mine) undoStack.current = [...undoStack.current.slice(1 - UNDO_KEEP), { game: from, steps: replay.current?.steps.length ?? 0 }];
    replay.current?.steps.push({ a: action });
    setGame(next);
  }

  /** Takes back your last action, and what the bot did after it. Not once the game is over. */
  const canUndo = !!game && game.winner === null && undoStack.current.length > 0;
  function undo() {
    const last = undoStack.current.at(-1);
    if (!last || !game || game.winner !== null) return;
    undoStack.current = undoStack.current.slice(0, -1);
    if (replay.current) replay.current.steps.length = last.steps;
    setGame(last.game);
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || e.shiftKey) return;
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      e.preventDefault();
      undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The bot acts on a timer so the human can follow what it does.
  useEffect(() => {
    const bot = (g: GameState) => { const a = actor(g); return a !== null && a !== ME; };
    if (!game || !bot(game)) return;
    const timer = setTimeout(() => {
      try {
        play(game, botAction(game), false);
      } catch (e) {
        if (!(e instanceof IllegalAction)) throw e;
        play(game, fallbackAction(game), false);
      }
    }, BOT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [game]);

  function startGame(firstPlayer: PlayerId, mine: Card[], others: Card[][], cmd: Card[][] = commanders) {
    current.current = { first: firstPlayer, scored: false };
    setBetween(false);
    undoStack.current = [];
    // An empty name is displayed as "You" in the current language.
    const names = others.length === 3 ? ['', t.play.allyName, t.play.botName1, t.play.botName2] : ['', t.play.botName];
    const started = newGame({
      decks: [mine, ...others], names, first: firstPlayer,
      mode: gameModeOf({ ...gameSetup, twoHeaded: others.length === 3 }),
      ...(commander ? { commanders: cmd } : {}),
      // A rematch keeps the full control setting.
      fullControl: game?.fullControl?.length === others.length + 1 ? game.fullControl : undefined,
    });
    replay.current = newReplay(started);
    setGame(started);
  }

  /** A new match (one game, or the first game of a best of 3) with the chosen decks. */
  async function start() {
    setLoading(true);
    setError(null);
    try {
      const seats = twoHeaded ? [allyDeck, botDeck, botDeck2] : [botDeck];
      const [mine, ...others] = await Promise.all([loadDeck75(myDeck, decks), ...seats.map((id) => loadDeck75(id, decks))]);
      if ([mine, ...others].some((d) => d.main.length === 0)) return setError({ code: 'decksTooSmall', params: { n: 1 } });
      // Constructed: every deck must be legal in the format.
      for (const d of [mine, ...others]) {
        const issue = deckProblems(d, gameSetup).blocking[0];
        if (issue) {
          const { kind, ...rest } = issue;
          return setError({ code: 'deckNotLegal', params: { format: gameSetup.format, issue: kind, ...rest } });
        }
      }
      // The opponents' first player: seat 1 in a duel, seat 2 in Two-Headed Giant.
      const them: PlayerId = twoHeaded ? 2 : 1;
      const firstPlayer: PlayerId = first === 'me' ? ME : first === 'bot' ? them : Math.random() < 0.5 ? ME : them;
      const cmd = [mine, ...others].map((d) => d.commander);
      matchInfo.current = { id: crypto.randomUUID(), replays: [], recorded: false };
      setMatch(newMatch(bestOf));
      setMyCards(mine);
      setBotCards(others.map((d) => d.main));
      setCommanders(cmd);
      startGame(firstPlayer, mine.main, others.map((d) => d.main), cmd);
      // A new game gets its address; a new match or a rematch keeps the game's.
      if (!gameId) {
        const id = crypto.randomUUID();
        loadedId.current = id;
        setMissing(false);
        navigate(`/play/${id}`);
      }
    } catch (e) {
      setError({ code: 'loadFailed', params: { message: e instanceof Error ? e.message : String(e) } });
    } finally {
      setLoading(false);
    }
  }

  if (!game) {
    return (
      <div className="page setup">
        <h1>{t.play.title}</h1>
        {missing && <div className="banner">{t.play.gameMissing}</div>}
        <SavedGames />
        <p className="small history-link"><Link to="/history">{t.history.title} →</Link></p>

        <ModePicker setup={gameSetup} onChange={setGameSetup}>
          <Segmented label={t.match.format} value={bestOf} options={[[1, t.match.single], [3, t.match.bo3]]} onChange={setBestOf} />
          <Segmented
            label={t.play.first}
            value={first}
            options={[['random', t.play.firstOptions.random], ['me', t.play.firstOptions.me], ['bot', t.play.firstOptions.bot]]}
            onChange={setFirst}
          />
        </ModePicker>

        <section className="deck-pickers">
          <CheckedDeckPicker label={t.play.yourDeck} value={myDeck} onChange={setMyDeck} setup={gameSetup} onBlocked={blocked.report('mine')} />
          {twoHeaded && <CheckedDeckPicker label={t.play.allyDeck} value={allyDeck} onChange={setAllyDeck} setup={gameSetup} onBlocked={blocked.report('ally')} />}
          <CheckedDeckPicker label={twoHeaded ? t.play.botDeck1 : t.play.botDeck} value={botDeck} onChange={setBotDeck} setup={gameSetup} onBlocked={blocked.report('bot')} />
          {twoHeaded && <CheckedDeckPicker label={t.play.botDeck2} value={botDeck2} onChange={setBotDeck2} setup={gameSetup} onBlocked={blocked.report('bot2')} />}
        </section>

        <section className="setup-options start-row">
          <span className="small muted">{setupName(t, gameSetup)} · {twoHeaded ? t.modes.twoHeaded : t.modes.duel}</span>
          <button className="start-button" onClick={start} disabled={loading || blocked.any}>{loading ? t.common.loadingCards : t.play.start}</button>
        </section>
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
  // Back to the setup: this game is over for good.
  const changeDecks = () => {
    if (gameId) deleteBotGame(gameId);
    navigate('/play');
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
        onAction={(action) => play(game, action, true)}
        notice={
          <>
            {bo3 && match && <div className="muted">{t.match.inGame(match.games + (game.winner === null ? 1 : 0), t.match.score(names[0], match.wins[0], match.wins[1], names[1]))}</div>}
            {game.winner === null && (
              <button type="button" className="icon undo-button" disabled={!canUndo} title={t.play.undoHint} onClick={undo}>↶ {t.play.undo}</button>
            )}
          </>
        }
        endControls={
          <>
            {matchInfo.current.replays.length > 0 && (
              <Link className="button secondary" to={`/history/replay/${matchInfo.current.replays.at(-1)}`}>{t.history.watchReplay}</Link>
            )}
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

/** Unfinished games saved in this browser, to resume. */
function SavedGames() {
  const t = useT();
  const [games, setGames] = useState(() => listBotGames().filter((g) => !g.over));
  if (games.length === 0) return null;
  return (
    <section className="saved-games">
      <h4>{t.play.savedGames}</h4>
      <ul className="plain-list">
        {games.slice(0, 5).map((g) => (
          <li key={g.id}>
            <Link to={`/play/${g.id}`}>{t.play.savedGame(g.title[0], g.title[1], g.turn)}</Link>
            <span className="small muted">{new Date(g.savedAt).toLocaleString()}</span>
            <button
              type="button"
              className="icon"
              aria-label={t.play.forgetGame}
              title={t.play.forgetGame}
              onClick={() => {
                deleteBotGame(g.id);
                setGames((list) => list.filter((x) => x.id !== g.id));
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
