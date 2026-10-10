import { useState } from 'react';
import type { Answer, ArrangeZone, CardInst, Choice } from '../lib/engine/engine';
import { useCardDisplay } from '../lib/cardLocale';
import { useT } from '../i18n';
import type { Messages } from '../i18n/en';
import type { Card } from '../types';

/** The prompt line for a choice the viewer has to make. `card` localizes card names. */
export function choicePrompt(t: Messages, choice: Choice, card: (englishName: string) => string): string {
  const p = choice.params ?? {};
  if (choice.purpose === 'cleanupDiscard') return t.game.choice.cleanupDiscard({ n: Number(p.n) });
  if (choice.purpose === 'payOrCounter') return t.game.choice.payOrCounter({ card: card(String(p.card)), n: Number(p.n) });
  if (choice.kind === 'cards') return t.game.choice.cards(choice.min, choice.max);
  if (choice.kind === 'mode') return t.game.choice.mode(choice.min, choice.max);
  return t.game.choice.arrange;
}

interface Props {
  choice: Choice;
  onAnswer: (answer: Answer) => void;
  onPreview: (card: Card) => void;
}

/** Answers a pending choice: pick cards, arrange cards, pick modes, or yes/no. */
export function ChoicePanel({ choice, onAnswer, onPreview }: Props) {
  const t = useT();
  const show = useCardDisplay();
  const [picked, setPicked] = useState<string[]>([]);
  const [arranged, setArranged] = useState<{ iid: string; zone: ArrangeZone }[]>(
    choice.kind === 'arrange' ? choice.cards.map((c) => ({ iid: c.iid, zone: choice.zones[0] })) : [],
  );
  const toggle = (id: string) => setPicked((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));

  const cardImage = (c: CardInst, selected: boolean, onClick?: () => void) => (
    <img
      key={c.iid}
      className={`choice-card ${selected ? 'selected' : ''}`}
      src={show.imageSmall(c.card)}
      alt={show.name(c.card)}
      onClick={onClick}
      onMouseEnter={() => onPreview(c.card)}
    />
  );

  if (choice.kind === 'yesNo') {
    const pay = choice.purpose === 'payOrCounter';
    return (
      <div className="choice-panel">
        <button onClick={() => onAnswer({ kind: 'yesNo', yes: true })}>{pay ? t.game.payN(Number(choice.params?.n)) : t.game.yes}</button>
        <button className="secondary" onClick={() => onAnswer({ kind: 'yesNo', yes: false })}>{pay ? t.game.dontPay : t.game.no}</button>
      </div>
    );
  }

  if (choice.kind === 'cards') {
    return (
      <div className="choice-panel">
        <div className="small muted">{t.game.targetsPicked(picked.length, choice.min, choice.max)}</div>
        <div className="choice-cards">{choice.options.map((c) => cardImage(c, picked.includes(c.iid), () => toggle(c.iid)))}</div>
        <button disabled={picked.length < choice.min || picked.length > choice.max} onClick={() => onAnswer({ kind: 'cards', iids: picked })}>
          {t.game.confirm}
        </button>
      </div>
    );
  }

  if (choice.kind === 'mode') {
    const ids = choice.modes.map((_, i) => String(i));
    return (
      <div className="choice-panel">
        {choice.modes.map((label, i) => (
          <label key={i} className="choice-mode">
            <input type="checkbox" checked={picked.includes(ids[i])} onChange={() => toggle(ids[i])} /> {label}
          </label>
        ))}
        <button
          disabled={picked.length < choice.min || picked.length > choice.max}
          onClick={() => onAnswer({ kind: 'mode', modes: picked.map(Number) })}
        >
          {t.game.confirm}
        </button>
      </div>
    );
  }

  // Arrange: each card goes to a zone; the order shown is the order kept (first = on top).
  const byIid = new Map(choice.cards.map((c) => [c.iid, c]));
  const move = (i: number) =>
    setArranged((list) => (i <= 0 ? list : [...list.slice(0, i - 1), list[i], list[i - 1], ...list.slice(i + 1)]));
  const answer = (): Answer => {
    const zones: Partial<Record<ArrangeZone, string[]>> = {};
    for (const { iid, zone } of arranged) (zones[zone] ??= []).push(iid);
    return { kind: 'arrange', zones };
  };
  return (
    <div className="choice-panel">
      <div className="choice-cards">
        {arranged.map(({ iid, zone }, i) => (
          <div key={iid} className="choice-arrange">
            {cardImage(byIid.get(iid)!, false)}
            <div className="row">
              {i > 0 && <button className="secondary small" onClick={() => move(i)}>◀</button>}
              {choice.zones.map((z) => (
                <button
                  key={z}
                  className={`small ${z === zone ? '' : 'secondary'}`}
                  onClick={() => setArranged((list) => list.map((x) => (x.iid === iid ? { ...x, zone: z } : x)))}
                >
                  {t.game.arrangeZones[z]}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button onClick={() => onAnswer(answer())}>{t.game.confirm}</button>
    </div>
  );
}
