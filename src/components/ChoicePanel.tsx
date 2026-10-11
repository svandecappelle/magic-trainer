import { useState } from 'react';
import type { Answer, ArrangeZone, CardInst, Choice } from '../lib/engine/engine';
import { useCardDisplay } from '../lib/cardLocale';
import { useT } from '../i18n';
import type { Messages } from '../i18n/en';
import type { Card } from '../types';

/** The prompt line for a choice the viewer has to make. `card` localizes card names; `names` are the players' names. */
export function choicePrompt(t: Messages, choice: Choice, card: (englishName: string) => string, names: [string, string]): string {
  const p = choice.params ?? {};
  const n = Number(p.n);
  switch (choice.purpose) {
    case 'cleanupDiscard': return t.game.choice.cleanupDiscard({ n });
    case 'payOrCounter': return t.game.choice.payOrCounter({ card: card(String(p.card)), n });
    case 'discard': return t.game.choice.discard({ n });
    case 'discardChosen': return t.game.choice.discardChosen({ n, who: names[Number(p.p) as 0 | 1] });
    case 'scry': return t.game.choice.scry({ n });
    case 'surveil': return t.game.choice.surveil({ n });
    case 'optional': return t.game.choice.optional({ card: card(String(p.card)) });
    case 'sacrifice': return t.game.choice.sacrifice({ n });
    case 'search': return t.game.choice.search({ n });
    case 'discardCost': return t.game.choice.discardCost({ card: card(String(p.card)), n: n || 1 });
    case 'exileCost': return t.game.choice.exileCost({ card: card(String(p.card)), n });
    case 'costChoice': return t.game.choice.costChoice({ card: card(String(p.card)) });
    case 'damageOrder': return t.game.choice.damageOrder({ card: card(String(p.card)) });
    case 'clone': return t.game.choice.clone({ card: card(String(p.card)) });
    case 'legendRule': return t.game.choice.legendRule({ card: card(String(p.card)) });
    case 'payLife': return t.game.choice.payLife({ card: card(String(p.card)), n });
    case 'sacrificeCost': return t.game.choice.sacrificeCost({ card: card(String(p.card)) });
    case 'triggerTargets':
      if (choice.kind === 'targets') {
        return t.game.choice.triggerTargets({ card: card(String(p.card)), kind: t.game.targetKinds[choice.slots[0].kind] });
      }
  }
  if (choice.kind === 'cards') return t.game.choice.cards(choice.min, choice.max);
  if (choice.kind === 'mode') return t.game.choice.mode(choice.min, choice.max);
  return t.game.choice.arrange;
}

/** A cost of "A or B" as sent by the engine ("life:3", "discard:1", "exileGraveyard:6", "mana:{1}"). */
function costLabel(t: Messages, label: string): string {
  const [kind, value] = label.split(':');
  if (kind === 'life') return t.game.payLifeN(Number(value));
  if (kind === 'discard') return t.game.discardN(Number(value));
  if (kind === 'exileGraveyard') return t.game.exileN(Number(value));
  if (kind === 'mana') return t.game.payMana(value);
  return label;
}

/** Identifies a choice (kind, purpose, cards or modes), so the panel starts over for each new one. */
export function choiceKey(choice: Choice): string {
  const cards = choice.kind === 'cards' ? choice.options : choice.kind === 'arrange' ? choice.cards : [];
  const extra = choice.kind === 'mode' ? choice.modes.join('|') : '';
  return `${choice.player}:${choice.kind}:${choice.purpose}:${cards.map((c) => c.iid).join(',')}:${extra}`;
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
    const n = Number(choice.params?.n);
    const [yes, no] =
      choice.purpose === 'payOrCounter' ? [t.game.payN(n), t.game.dontPay]
      : choice.purpose === 'payLife' ? [t.game.payLifeN(n), t.game.enterTapped]
      : choice.purpose === 'costChoice' ? [costLabel(t, String(choice.params?.yes)), costLabel(t, String(choice.params?.no))]
      : [t.game.yes, t.game.no];
    return (
      <div className="choice-panel">
        <button onClick={() => onAnswer({ kind: 'yesNo', yes: true })}>{yes}</button>
        <button className="secondary" onClick={() => onAnswer({ kind: 'yesNo', yes: false })}>{no}</button>
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

  // Targets are picked on the board.
  if (choice.kind === 'targets') return null;

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
