import { useState, type CSSProperties } from 'react';
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
    case 'creatureType': return t.game.choice.creatureType({ card: card(String(p.card)) });
    case 'crewCost': return t.game.choice.crewCost({ card: card(String(p.card)), n });
    case 'dig': return t.game.choice.dig({ n });
    case 'tradeForCard': return t.game.choice.tradeForCard({ card: card(String(p.card)) });
    case 'triggerMode': return t.game.choice.triggerMode({ card: card(String(p.card)) });
    case 'reflexiveCost': return t.game.choice.reflexiveCost({ card: card(String(p.card)) });
    case 'reflexivePay': return t.game.choice.reflexivePay({ card: card(String(p.card)), cost: String(p.cost), life: Number(p.life) });
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
  /** The prompt, shown as the window's title for scry and surveil. */
  title?: string;
}

/** Answers a pending choice: pick cards, arrange cards, pick modes, or yes/no. */
export function ChoicePanel({ choice, onAnswer, onPreview, title }: Props) {
  const t = useT();
  const show = useCardDisplay();
  const [picked, setPicked] = useState<string[]>([]);
  const [arranged, setArranged] = useState<{ iid: string; zone: ArrangeZone }[]>(
    choice.kind === 'arrange' ? choice.cards.map((c) => ({ iid: c.iid, zone: choice.zones[0] })) : [],
  );
  /** The card being dragged between arrange columns. */
  const [dragging, setDragging] = useState<string | null>(null);
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
          <label key={i} className={`choice-mode${choice.disabled?.includes(i) ? ' disabled' : ''}`}>
            <input type="checkbox" checked={picked.includes(ids[i])} disabled={choice.disabled?.includes(i)} onChange={() => toggle(ids[i])} /> {label}
            {choice.disabled?.includes(i) && <small> — {t.game.modeUnavailable}</small>}
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

  // Arrange (scry, surveil, damage order): one column per zone; the order in a column is the order kept (first = on top).
  const byIid = new Map(choice.cards.map((c) => [c.iid, c]));
  const zoneOf = (iid: string) => arranged.find((x) => x.iid === iid)?.zone;
  /** Moves a card to a zone (last in it), or swaps it with its neighbour in its zone (`step` −1 / +1). */
  const moveTo = (iid: string, zone: ArrangeZone) =>
    setArranged((list) => [...list.filter((x) => x.iid !== iid), { iid, zone }]);
  const shift = (iid: string, step: -1 | 1) =>
    setArranged((list) => {
      const zone = list.find((x) => x.iid === iid)!.zone;
      const inZone = list.filter((x) => x.zone === zone);
      const i = inZone.findIndex((x) => x.iid === iid);
      const j = i + step;
      if (j < 0 || j >= inZone.length) return list;
      [inZone[i], inZone[j]] = [inZone[j], inZone[i]];
      return [...inZone, ...list.filter((x) => x.zone !== zone)];
    });
  const other = (zone: ArrangeZone) => choice.zones.find((z) => z !== zone);
  const answer = (): Answer => {
    const zones: Partial<Record<ArrangeZone, string[]>> = {};
    for (const { iid, zone } of arranged) (zones[zone] ??= []).push(iid);
    return { kind: 'arrange', zones };
  };
  const toHandMax = choice.params?.toHandMax;
  const twoZones = choice.zones.length > 1;
  return (
    <div className="choice-panel arrange-panel" role="dialog" aria-label={title}>
      {title && <h3 className="arrange-title">{title}</h3>}
      <p className="small muted arrange-hint">
        {twoZones ? t.game.arrangeHint : t.game.orderHint}
        {typeof toHandMax === 'number' && <> {t.game.toHandHint(toHandMax)}</>}
      </p>
      <div className="arrange-columns" style={{ '--cols': choice.zones.length } as CSSProperties}>
        {choice.zones.map((zone) => {
          const items = arranged.filter((x) => x.zone === zone);
          return (
            <section
              key={zone}
              className={`arrange-column ${dragging && zoneOf(dragging) !== zone ? 'drop-target' : ''}`}
              aria-label={t.game.arrangeTitles[zone]}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging) moveTo(dragging, zone);
                setDragging(null);
              }}
            >
              {twoZones && <strong className="small">{t.game.arrangeTitles[zone]}</strong>}
              <div className="arrange-cards">
                {items.length === 0 && <span className="small muted">{t.game.dropHere}</span>}
                {items.map(({ iid }, i) => {
                  const c = byIid.get(iid)!;
                  const to = other(zone);
                  const comesBack = zone === 'graveyard' && typeof toHandMax === 'number' && c.card.cmc <= toHandMax;
                  return (
                    <div key={iid} className="choice-arrange">
                      <button
                        type="button"
                        className="arrange-card"
                        draggable={twoZones}
                        onDragStart={() => setDragging(iid)}
                        onDragEnd={() => setDragging(null)}
                        onClick={() => to && moveTo(iid, to)}
                        onMouseEnter={() => onPreview(c.card)}
                        title={to ? t.game.arrangeTitles[to] : undefined}
                      >
                        <img src={show.imageSmall(c.card)} alt={show.name(c.card)} draggable={false} />
                      </button>
                      <div className="row">
                        {zone !== 'graveyard' && items.length > 1 && (
                          <button type="button" className="secondary small" disabled={i === 0} aria-label={t.game.moveEarlier} onClick={() => shift(iid, -1)}>◀</button>
                        )}
                        {zone !== 'graveyard' && <span className="arrange-order">{i + 1}</span>}
                        {zone !== 'graveyard' && items.length > 1 && (
                          <button type="button" className="secondary small" disabled={i === items.length - 1} aria-label={t.game.moveLater} onClick={() => shift(iid, 1)}>▶</button>
                        )}
                        {comesBack && <span className="small comes-back">{t.game.arrangeTitles.graveyard} → ✋</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <div className="row arrange-actions">
        {choice.zones.includes('top') && twoZones && (
          <button type="button" className="secondary" onClick={() => setArranged(choice.cards.map((c) => ({ iid: c.iid, zone: 'top' })))}>{t.game.keepAllTop}</button>
        )}
        <span className="spacer" />
        <button type="button" onClick={() => onAnswer(answer())}>{t.game.confirm}</button>
      </div>
    </div>
  );
}
