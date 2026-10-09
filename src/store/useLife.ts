import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Player {
  name: string;
  life: number;
  poison: number;
}

interface LifeState {
  players: Player[];
  startingLife: number;
  active: number;
  turn: number;
  setup: (count: number, startingLife: number) => void;
  update: (index: number, patch: Partial<Player>) => void;
  nextTurn: () => void;
}

const makePlayers = (count: number, life: number, old: Player[] = []): Player[] =>
  Array.from({ length: count }, (_, i) => ({ name: old[i]?.name ?? `Player ${i + 1}`, life, poison: 0 }));

export const useLife = create<LifeState>()(
  persist(
    (set) => ({
      players: makePlayers(2, 20),
      startingLife: 20,
      active: 0,
      turn: 1,
      setup: (count, startingLife) =>
        set((s) => ({ players: makePlayers(count, startingLife, s.players), startingLife, active: 0, turn: 1 })),
      update: (index, patch) =>
        set((s) => ({ players: s.players.map((p, i) => (i === index ? { ...p, ...patch } : p)) })),
      nextTurn: () =>
        set((s) => {
          const active = (s.active + 1) % s.players.length;
          return { active, turn: active === 0 ? s.turn + 1 : s.turn };
        }),
    }),
    { name: 'magic-trainer-life', version: 1 },
  ),
);
