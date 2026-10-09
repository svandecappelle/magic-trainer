import { PRESET_DECKS } from '../lib/engine/presets';
import type { Deck } from '../types';

/** <option>s for picking a saved deck or a preset; pair with loadDeckCards(). */
export function DeckOptions({ decks }: { decks: Deck[] }) {
  return (
    <>
      {decks.length > 0 && (
        <optgroup label="Your decks">
          {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </optgroup>
      )}
      <optgroup label="Presets">
        {PRESET_DECKS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </optgroup>
    </>
  );
}
