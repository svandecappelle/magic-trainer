import type { Card } from '../types';

/** One physical copy of a card in the game. */
export interface Instance {
  iid: string;
  card: Card;
  tapped: boolean;
}

export type Zone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile';
export const ZONES: Zone[] = ['library', 'hand', 'battlefield', 'graveyard', 'exile'];

export type Phase = 'mulligan' | 'bottoming' | 'playing';

export interface GoldfishState {
  zones: Record<Zone, Instance[]>;
  phase: Phase;
  turn: number;
  life: number;
  mulligans: number;
  /** Cards still to put on the bottom after a London mulligan. */
  toBottom: number;
  onThePlay: boolean;
  log: string[];
}

export type GoldfishAction =
  | { type: 'new'; cards: Card[]; onThePlay: boolean }
  | { type: 'mulligan' }
  | { type: 'keep' }
  | { type: 'bottom'; iid: string }
  | { type: 'draw'; n?: number }
  | { type: 'move'; iid: string; to: Zone; position?: 'top' | 'bottom' }
  | { type: 'tap'; iid: string }
  | { type: 'nextTurn' }
  | { type: 'life'; delta: number }
  | { type: 'shuffle' };

export type Rng = () => number;

export function shuffle<T>(items: T[], rng: Rng = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const emptyZones = (): Record<Zone, Instance[]> => ({
  library: [], hand: [], battlefield: [], graveyard: [], exile: [],
});

export const initialState: GoldfishState = {
  zones: emptyZones(),
  phase: 'mulligan',
  turn: 0,
  life: 20,
  mulligans: 0,
  toBottom: 0,
  onThePlay: true,
  log: [],
};

function draw(state: GoldfishState, n: number): GoldfishState {
  const drawn = state.zones.library.slice(0, n);
  return {
    ...state,
    zones: {
      ...state.zones,
      library: state.zones.library.slice(n),
      hand: [...state.zones.hand, ...drawn],
    },
  };
}

function withLog(state: GoldfishState, msg: string): GoldfishState {
  const prefix = state.turn > 0 ? `T${state.turn}: ` : '';
  return { ...state, log: [...state.log, prefix + msg].slice(-50) };
}

function startPlaying(state: GoldfishState): GoldfishState {
  let s: GoldfishState = { ...state, phase: 'playing', turn: 1 };
  if (!s.onThePlay) s = draw(s, 1);
  return withLog(s, s.onThePlay ? 'On the play, no draw' : 'On the draw, drew a card');
}

function findZone(state: GoldfishState, iid: string): Zone | undefined {
  return ZONES.find((z) => state.zones[z].some((c) => c.iid === iid));
}

export function createReducer(rng: Rng = Math.random) {
  return function reducer(state: GoldfishState, action: GoldfishAction): GoldfishState {
    switch (action.type) {
      case 'new': {
        const library = shuffle(
          action.cards.map((card, i) => ({ iid: `${i}`, card, tapped: false })),
          rng,
        );
        const s: GoldfishState = { ...initialState, zones: { ...emptyZones(), library }, onThePlay: action.onThePlay };
        return withLog(draw(s, 7), 'New game, drew 7');
      }

      case 'mulligan': {
        if (state.phase !== 'mulligan') return state;
        const library = shuffle([...state.zones.library, ...state.zones.hand], rng);
        const s = { ...state, mulligans: state.mulligans + 1, zones: { ...state.zones, library, hand: [] } };
        return withLog(draw(s, 7), `Mulligan to ${7 - s.mulligans}`);
      }

      case 'keep': {
        if (state.phase !== 'mulligan') return state;
        if (state.mulligans === 0) return startPlaying(state);
        return withLog(
          { ...state, phase: 'bottoming', toBottom: Math.min(state.mulligans, state.zones.hand.length) },
          `Kept, choose ${state.mulligans} card(s) to bottom`,
        );
      }

      case 'bottom': {
        if (state.phase !== 'bottoming') return state;
        const card = state.zones.hand.find((c) => c.iid === action.iid);
        if (!card) return state;
        const s: GoldfishState = {
          ...state,
          toBottom: state.toBottom - 1,
          zones: {
            ...state.zones,
            hand: state.zones.hand.filter((c) => c.iid !== action.iid),
            library: [...state.zones.library, card],
          },
        };
        return s.toBottom === 0 ? startPlaying(s) : s;
      }

      case 'draw': {
        const n = action.n ?? 1;
        if (!state.zones.library.length) return withLog(state, 'Library is empty!');
        return withLog(draw(state, n), n === 1 ? 'Drew a card' : `Drew ${n} cards`);
      }

      case 'move': {
        const from = findZone(state, action.iid);
        if (!from) return state;
        const card = state.zones[from].find((c) => c.iid === action.iid)!;
        const moved = { ...card, tapped: false };
        const zones = { ...state.zones, [from]: state.zones[from].filter((c) => c.iid !== action.iid) };
        zones[action.to] = action.position === 'top' ? [moved, ...zones[action.to]] : [...zones[action.to], moved];
        return withLog({ ...state, zones }, `${card.card.name}: ${from} → ${action.to}`);
      }

      case 'tap':
        return {
          ...state,
          zones: {
            ...state.zones,
            battlefield: state.zones.battlefield.map((c) => (c.iid === action.iid ? { ...c, tapped: !c.tapped } : c)),
          },
        };

      case 'nextTurn': {
        if (state.phase !== 'playing') return state;
        const s: GoldfishState = {
          ...state,
          turn: state.turn + 1,
          zones: { ...state.zones, battlefield: state.zones.battlefield.map((c) => ({ ...c, tapped: false })) },
        };
        return withLog(draw(s, 1), 'Untap, draw');
      }

      case 'life':
        return { ...state, life: state.life + action.delta };

      case 'shuffle':
        return withLog({ ...state, zones: { ...state.zones, library: shuffle(state.zones.library, rng) } }, 'Shuffled library');
    }
  };
}

export const goldfishReducer = createReducer();
