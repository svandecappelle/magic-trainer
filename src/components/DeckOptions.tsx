import { useT } from '../i18n';
import { PRESET_DECKS } from '../lib/engine/presets';
import type { Deck } from '../types';

/** <option>s for picking a saved deck or a preset; pair with loadDeckCards(). */
export function DeckOptions({ decks }: { decks: Deck[] }) {
  const t = useT();
  return (
    <>
      {decks.length > 0 && (
        <optgroup label={t.play.yourDecks}>
          {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </optgroup>
      )}
      <optgroup label={t.play.presets}>
        {PRESET_DECKS.map((p) => <option key={p.id} value={p.id}>{t.presets[p.id] ?? p.name}</option>)}
      </optgroup>
    </>
  );
}
