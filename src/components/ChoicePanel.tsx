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
    case 'cumulativeUpkeep': return t.game.choice.cumulativeUpkeep({ card: card(String(p.card)), cost: String(p.cost), n });
    case 'reorder': return t.game.choice.reorder({ n });
    case 'mayShuffle': return t.game.choice.mayShuffle({ card: card(String(p.card)) });
    case 'putBack': return t.game.choice.putBack({ n });
    case 'putFromHand': return t.game.choice.putFromHand({ card: card(String(p.card)) });
    case 'tuckTop': return t.game.choice.tuckTop({ card: card(String(p.card)) });
    case 'payOrDraw': return t.game.choice.payOrDraw({ card: card(String(p.card)), n });
    case 'payLifeOrCounter': return t.game.choice.payLifeOrCounter({ card: card(String(p.card)), n });
    case 'discard': return t.game.choice.discard({ n });
    case 'discardChosen': return t.game.choice.discardChosen({ n, who: names[Number(p.p) as 0 | 1] });
    case 'scry': return t.game.choice.scry({ n });
    case 'surveil': return t.game.choice.surveil({ n });
    case 'optional': return t.game.choice.optional({ card: card(String(p.card)) });
    case 'sacrifice': return t.game.choice.sacrifice({ n });
    case 'search': return t.game.choice.search({ n });
    case 'returnLandCost': return t.game.choice.returnLandCost({ card: card(String(p.card)) });
    case 'exileFromHandCost': return t.game.choice.exileFromHandCost({ card: card(String(p.card)) });
    case 'returnCreatureCost': return t.game.choice.returnCreatureCost({ card: card(String(p.card)) });
    case 'discardCost': return t.game.choice.discardCost({ card: card(String(p.card)), n: n || 1 });
    case 'exileCost': return t.game.choice.exileCost({ card: card(String(p.card)), n });
    case 'costChoice': return t.game.choice.costChoice({ card: card(String(p.card)) });
    case 'damageOrder': return t.game.choice.damageOrder({ card: card(String(p.card)) });
    case 'clone': return t.game.choice.clone({ card: card(String(p.card)) });
    case 'legendRule': return t.game.choice.legendRule({ card: card(String(p.card)) });
    case 'payLife': return t.game.choice.payLife({ card: card(String(p.card)), n });
    case 'sacrificeCost': return t.game.choice.sacrificeCost({ card: card(String(p.card)) });
    case 'creatureType': return t.game.choice.creatureType({ card: card(String(p.card)) });
    case 'returnFromGraveyard': return t.game.choice.returnFromGraveyard({ card: card(String(p.card)) });
    case 'reflexiveSacrifice': return t.game.choice.reflexiveSacrifice({ card: card(String(p.card)) });
    case 'reflexiveRemoveCounter': return t.game.choice.reflexiveRemoveCounter({ card: card(String(p.card)) });
    case 'exploreMill': return t.game.choice.exploreMill({ card: card(String(p.card)) });
    case 'color': return t.game.choice.color({ card: card(String(p.card)) });
    case 'basicType': return t.game.choice.basicType({ card: card(String(p.card)) });
    case 'chosenPlayer': return t.game.choice.chosenPlayer({ card: card(String(p.card)) });
    case 'spellName': return t.game.choice.spellName({ card: card(String(p.card)) });
    case 'cardName': return t.game.choice.cardName({ card: card(String(p.card)) });
    case 'crewCost': return t.game.choice.crewCost({ card: card(String(p.card)), n });
    case 'dig': return t.game.choice.dig({ n });
    case 'tradeForCard': return t.game.choice.tradeForCard({ card: card(String(p.card)) });
    case 'triggerMode': return t.game.choice.triggerMode({ card: card(String(p.card)) });
    case 'reflexiveCost': return t.game.choice.reflexiveCost({ card: card(String(p.card)) });
    case 'gemstoneCaverns': return t.game.choice.gemstoneCaverns({ card: card(String(p.card)) });
    case 'exileFromHand': return t.game.choice.exileFromHand({ card: card(String(p.card)) });
    case 'discardLandInstead': return t.game.choice.discardLandInstead({ card: card(String(p.card)) });
    case 'mayPay': return t.game.choice.mayPay({ card: card(String(p.card)), cost: String(p.cost) });
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
      : choice.purpose === 'payLifeOrCounter' ? [t.game.payLifeN(n), t.game.dontPay]
      : choice.purpose === 'payOrDraw' ? [t.game.payN(n), t.game.dontPay]
      : choice.purpose === 'cumulativeUpkeep' ? [t.game.payMana(String(choice.params?.cost)), t.game.sacrificeIt]
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
            {/* One mode to pick: radio buttons (picking another replaces it). */}
            <input
              type={choice.max === 1 ? 'radio' : 'checkbox'}
              name={choice.max === 1 ? 'choice-mode' : undefined}
              checked={picked.includes(ids[i])}
              disabled={choice.disabled?.includes(i)}
              onChange={() => (choice.max === 1 ? setPicked([ids[i]]) : toggle(ids[i]))}
            />{' '}
            {choice.purpose === 'color' ? t.colors[label] : label}
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
