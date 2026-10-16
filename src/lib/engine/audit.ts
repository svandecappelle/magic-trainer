import type { Card } from '../../types';
import {
  activatedOf, auraTarget, castInfo, castSpec, entersAsCopy, entersCounters, entersTappedRule, beginsWithLuck, discardsLandInstead, manaConditions, stateMana, doesntUntap, frontText, gameRulesOf, isInstantOrSorcery,
  KEYWORDS, beginsOnBattlefield, chosenTypeMana, choosesCreatureType, doublesEquippedTriggers, equipDiscount, freeFirstEquip, isStoried, manaLifeCost, manaPain, manaUnits, modeSimulated, protectionsOf, staticsOf, toxicOf, triggersOf, wardCost, wardLife, protectsSpells, namesCardToStop, drawsOneMore, handMana, choosesBasicType, tapsAnotherForMana, blocksOnlyFlyers, legendaryMana, entersAsBirdCopy, type AbilitySpec,
} from './rules';

/**
 * What the engine understands of a card, line by line: a tool to check cards (scripts/audit-cards.ts, the card-audit
 * skill) and a regression test (audit.test.ts). It reads the card the way the engine does, it doesn't play it.
 */

/** ok: simulated; notSimulated: recognized but does nothing (logged "not simulated"); unread: silently ignored. */
export type LineStatus = 'ok' | 'notSimulated' | 'unread';

export interface LineReport {
  text: string;
  status: LineStatus;
  /** How the engine reads it: "keyword", "trigger → mill", "spell → destroy (1 target)"… */
  how: string;
}

/** ok: every line simulated; partial: some; none: nothing beyond keywords; refused: can't be cast at all. */
export type CardStatus = 'ok' | 'partial' | 'none' | 'refused';

export interface CardReport {
  name: string;
  manaCost: string;
  typeLine: string;
  status: CardStatus;
  lines: LineReport[];
  /** Other faces (adventure, modal double-faced, split…): only the front face is audited line by line. */
  otherFaces: boolean;
}

const stripReminder = (text: string) => text.replace(/\s*\([^)]*\)/g, '').trim();

/** "draw+discard (1 target)", or null when nothing is simulated. */
function effectsText(spec: AbilitySpec): string | null {
  if (!spec.effects.length) return null;
  if (spec.modal) return `choose ${spec.modal.min}–${spec.modal.max} modes`;
  const targets = spec.targets.length ? ` (${spec.targets.length} target${spec.targets.length > 1 ? 's' : ''})` : '';
  const c = spec.condition;
  const cond = !c ? '' : c.tapped ? ', if tapped' : `, if ${c.lost ? 'life gained and lost' : `${c.gained}+ life gained`} this turn`;
  const kinds = spec.effects.map((e) => (e.kind === 'tap' && e.untap ? 'untap' : e.kind)).join('+');
  return kinds + targets + (spec.mayPay ? `, may pay ${spec.mayPay}` : spec.optional ? ', optional' : '') + cond;
}

/** Keywords on a line ("Flying, lifelink", "Ward {2}", "Kicker {1}{U}"), or null if it isn't a keyword line. */
function keywordLine(card: Card, line: string, one: Card): LineReport | null {
  // A static ability starting like a keyword ("Double all damage …", Scryfall's keyword "Double").
  if (staticsOf(one).length) return null;
  const known = (card.keywords ?? []).map((k) => k.toLowerCase());
  const pieces = line.split(/,\s*/).map((p) => p.trim().toLowerCase());
  const keywordOf = (p: string) => [...known, ...KEYWORDS].sort((a, b) => b.length - a.length).find((k) => p === k || p.startsWith(`${k} `) || p.startsWith(`${k}—`));
  if (!pieces.every((p) => keywordOf(p))) return null;
  const info = castInfo(one);
  const supported = (p: string) => {
    const k = keywordOf(p)!;
    if ((KEYWORDS as readonly string[]).includes(k)) return true;
    if (k === 'ward') return wardCost(one) > 0 || wardLife(one) > 0;
    if (k === 'protection') return protectionsOf(one).length > 0;
    if (k === 'toxic') return toxicOf(one) > 0;
    if (k === 'equip') return activatedOf(one).length > 0;
    if (k === 'enchant') return !!auraTarget(card);
    if (k === 'kicker') return !!info.kicker;
    if (k === 'flashback') return !!info.flashback;
    if (k.endsWith('cycling')) return !!info.cycling;
    if (k === 'convoke') return info.convoke;
    if (k === 'delve') return info.delve;
    if (k === 'affinity') return !!info.affinity;
    if (k === 'mobilize') return triggersOf(one).length > 0;
    if (k === 'storied') return isStoried(one);
    if (k === 'crew') return activatedOf(one).some((a) => a.cost.crew !== undefined);
    if (k === 'cumulative upkeep') return triggersOf(one).some((tr) => tr.ability.effects.some((x) => x.kind === 'cumulativeUpkeep'));
    if (k === 'devoid') return true; // the card's colors are already none
    if (k === 'metalcraft') return manaConditions(one).some((c) => 'artifacts' in c);
    return false;
  };
  const missing = pieces.filter((p) => !supported(p)).map((p) => keywordOf(p)!);
  return missing.length
    ? { text: line, status: 'notSimulated', how: `keyword not simulated: ${missing.join(', ')}` }
    : { text: line, status: 'ok', how: 'keyword' };
}

/** One line of a permanent (or a keyword/cost line of a spell). Null: a spell's rules text, read as a whole. */
function lineReport(card: Card, line: string, spell: boolean): LineReport | null {
  // The card with only this line, so each reader says whether it understands it.
  const one: Card = { ...card, oracleText: line };
  const kw = keywordLine(card, line, one);
  if (kw) return kw;
  if (/^As an additional cost to cast this spell/i.test(line)) {
    const info = castInfo(one);
    if (/^As an additional cost to cast this spell, you may /i.test(line)) return { text: line, status: 'ok', how: 'optional cost, never paid' };
    if (info.unknownCost) return { text: line, status: 'notSimulated', how: spell ? 'cost not understood: the spell is not simulated' : 'cost not understood: the card can\'t be cast' };
    return { text: line, status: 'ok', how: `additional cost: ${info.additional!.kind}` };
  }
  const triggers = triggersOf(one);
  if (triggers.length) {
    const read = triggers.map((t) => effectsText(t.ability));
    const event = [...new Set(triggers.map((t) => t.event.on))].join('/');
    return read.every((r) => r)
      ? { text: line, status: 'ok', how: `trigger (${event}${triggers.some((t) => t.oncePerTurn) ? ', once each turn' : ''}) → ${read.join(' | ')}` }
      : { text: line, status: 'notSimulated', how: `trigger (${event}), effect not simulated` };
  }
  const channel = castInfo(one).channel;
  if (channel) {
    const read = effectsText(channel.ability);
    return read
      ? { text: line, status: 'ok', how: `channel (from hand) → ${read}${channel.legendaryDiscount ? ', {1} less per legendary creature' : ''}` }
      : { text: line, status: 'notSimulated', how: 'channel, effect not simulated' };
  }
  const activated = activatedOf(one);
  if (activated.length) {
    const read = effectsText(activated[0].ability);
    return read
      ? { text: line, status: 'ok', how: `${activated[0].cost.loyalty !== undefined ? 'loyalty ability' : 'activated'} → ${read}` }
      : { text: line, status: 'notSimulated', how: 'activated ability, effect not simulated' };
  }
  if (chosenTypeMana(one)) return { text: line, status: 'ok', how: 'mana for a creature spell of the chosen type (can\'t be countered)' };
  // Multiversal Passage: its two lines are read together.
  if (choosesBasicType(card) && /^As this land enters, choose a basic land type|^This land is the chosen type/.test(line)) {
    return { text: line, status: 'ok', how: 'chooses a basic land type (its mana); pay 2 life or it enters tapped' };
  }
  if (blocksOnlyFlyers(one)) return { text: line, status: 'ok', how: 'blocks only creatures with flying' };
  if (legendaryMana(one)) return { text: line, status: 'ok', how: 'mana: any color for a legendary spell (it can\'t be countered)' };
  const tapsOther = tapsAnotherForMana(one);
  if (tapsOther) return { text: line, status: 'ok', how: `mana: any color, tapping another untapped ${tapsOther} that makes no mana (chosen automatically)` };
  const fromHand = handMana(one);
  if (fromHand) return { text: line, status: 'ok', how: `mana: ${fromHand}, exiling it from the hand (spent last)` };
  const state = stateMana(one);
  if (state) {
    const how = { imprinted: 'the colors of the exiled card', legends: 'the colors of your legendary creatures and planeswalkers', luck: 'C, any color with a luck counter', perArtifact: 'U for each artifact you control', mining: 'any color, removing a mining counter (sacrificed after the last)', reflect: 'one mana of a type your other lands could make' }[state];
    return { text: line, status: 'ok', how: `mana: ${how}` };
  }
  if (/\bAdd \{|\bAdd (?:one|two|three) mana\b/.test(line) && !spell) {
    // Command Tower: read with a five-color commander.
    const units = manaUnits({ ...one, typeLine: 'Land' }, ['W', 'U', 'B', 'R', 'G']);
    // A life-cost mana ability next to a free one: its colors cost life when spent (see manaPain).
    const life = /^\{T\}, Pay \d+ life:/.test(line);
    const lifeLeftOut = life && !manaLifeCost(card) && !manaPain(card, ['W', 'U', 'B', 'R', 'G']);
    return units.length && !lifeLeftOut
      ? { text: line, status: 'ok', how: `mana: ${units.map((u) => u.join('/')).join(' ')}${life ? ' (pays life)' : ''}` }
      : { text: line, status: 'unread', how: 'mana ability not understood' };
  }
  if (staticsOf(one).length) return { text: line, status: 'ok', how: 'static ability' };
  if (equipDiscount(one)) return { text: line, status: 'ok', how: `equip costs {${equipDiscount(one)}} less` };
  if (freeFirstEquip(one)) return { text: line, status: 'ok', how: 'first equip each turn for {0} (enduring story)' };
  if (doublesEquippedTriggers(one)) return { text: line, status: 'ok', how: 'triggers an additional time while equipped' };
  if (choosesCreatureType(one)) return { text: line, status: 'ok', how: 'chooses a creature type as it enters' };
  if (discardsLandInstead(one)) return { text: line, status: 'ok', how: 'enters only by discarding a land card' };
  // Pithing Needle: its two lines are read together.
  if (namesCardToStop(card) && /choose a card name|sources with the chosen name/.test(line)) return { text: line, status: 'ok', how: 'names a card: its activated abilities (not mana) are stopped' };
  if (drawsOneMore(one)) return { text: line, status: 'ok', how: 'draws one more card with one or fewer in hand' };
  if (protectsSpells(one)) return { text: line, status: 'ok', how: 'your spells can\'t be countered' };
  if (doesntUntap(one)) return { text: line, status: 'ok', how: 'doesn\'t untap during its controller\'s untap step' };
  if (beginsWithLuck(one)) return { text: line, status: 'ok', how: 'may begin the game on the battlefield (not the starting player)' };
  if (beginsOnBattlefield(one)) return { text: line, status: 'ok', how: 'begins the game on the battlefield (always)' };
  const rules = gameRulesOf(one);
  if (rules.length) return { text: line, status: 'ok', how: `rule for the game: ${rules.join(', ')}` };
  // Cases: "To solve — …" goes with "Solved — …", which is not simulated.
  if (/^To solve — /.test(line)) return { text: line, status: 'notSimulated', how: 'Case: solving not simulated' };
  const counters = entersCounters(one);
  if (counters) return { text: line, status: 'ok', how: `enters with ${counters.n} ${counters.counter} counters` };
  const tapped = entersTappedRule(one);
  if (tapped) return { text: line, status: 'ok', how: `enters tapped (${tapped.kind})` };
  if (entersAsBirdCopy(one)) return { text: line, status: 'ok', how: 'enters as a copy (mana value up to the mana spent), a Bird with flying' };
  if (entersAsCopy(one)) return { text: line, status: 'ok', how: 'enters as a copy' };
  // Handled by the counter effect itself (engine.ts), on any spell.
  if (/^This spell can't be countered\.$/.test(line)) return { text: line, status: 'ok', how: 'can\'t be countered' };
  if (spell) return null;
  if (/^[^:"]+: /.test(line)) return { text: line, status: 'unread', how: 'activated ability with a cost or restriction not understood' };
  return { text: line, status: 'unread', how: 'not read by the engine' };
}

/** What the engine understands of `card`. */
export function auditCard(card: Card): CardReport {
  const [front, ...rest] = card.oracleText.split('\n//\n');
  const frontCard: Card = { ...card, oracleText: front, typeLine: card.typeLine.split(' // ')[0] };
  const spell = isInstantOrSorcery(frontCard);
  const lines: LineReport[] = [];
  const body: string[] = [];
  const raws = frontText(frontCard).split('\n').map(stripReminder).filter(Boolean);
  for (let i = 0; i < raws.length; i++) {
    const line = raws[i];
    // A permanent's modal trigger ("When … enters, choose one —" then "• …") is read with its modes.
    const modes: string[] = [];
    if (!spell && line.endsWith(' —')) while (raws[i + 1 + modes.length]?.startsWith('• ')) modes.push(raws[i + 1 + modes.length]);
    if (modes.length) {
      const block = [line, ...modes].join('\n');
      const report = lineReport(frontCard, block, spell);
      lines.push({ ...(report ?? { status: 'unread', how: 'not read by the engine' }), text: line });
      const modal = triggersOf({ ...frontCard, oracleText: block })[0]?.ability.modal;
      modes.forEach((m, k) => {
        const ok = !!modal?.specs[k]?.effects.length;
        lines.push(modal
          ? { text: m, status: ok ? 'ok' : 'notSimulated', how: ok ? `mode → ${effectsText(modal.specs[k])}` : 'mode not simulated (can\'t be chosen)' }
          : { text: m, status: lines.at(-1)!.status, how: 'mode of the ability above' });
      });
      i += modes.length;
      continue;
    }
    // Modes ("• …") and the "Choose one —" line belong to the spell's text.
    const report = spell && (line.startsWith('• ') || /^Choose /.test(line)) ? null : lineReport(frontCard, line, spell);
    const above = lines.at(-1);
    if (!spell && line.startsWith('• ') && above) lines.push({ text: line, status: above.status, how: 'mode of the ability above' });
    else if (report) lines.push(report);
    else body.push(line);
  }
  if (body.length) {
    const info = castInfo(frontCard);
    if (info.modal) {
      for (const line of body) {
        if (!line.startsWith('• ')) {
          lines.push({ text: line, status: 'ok', how: `modal: choose ${info.modal.min}–${info.modal.max}` });
          continue;
        }
        const i = info.modal.modes.indexOf(line.slice(2).trim());
        const ok = i >= 0 && modeSimulated(frontCard, 0, i);
        lines.push({ text: line, status: ok ? 'ok' : 'notSimulated', how: ok ? 'mode' : 'mode not simulated (can\'t be chosen)' });
      }
    } else {
      const read = effectsText(castSpec(frontCard, {}));
      for (const line of body) lines.push({ text: line, status: read ? 'ok' : 'notSimulated', how: read ? `spell → ${read}` : 'spell not simulated' });
    }
  }
  const info = castInfo(frontCard);
  const refused = info.unknownCost && !spell;
  const bad = lines.filter((l) => l.status !== 'ok').length;
  const good = lines.filter((l) => l.status === 'ok' && l.how !== 'keyword').length;
  const status: CardStatus = refused ? 'refused' : !bad ? 'ok' : good ? 'partial' : 'none';
  return { name: card.name, manaCost: card.manaCost, typeLine: card.typeLine, status, lines, otherFaces: rest.length > 0 };
}

const MARK: Record<LineStatus, string> = { ok: '✓', notSimulated: '✗', unread: '?' };

/** A plain-text report, problems first (refused, none, partial, ok). `problemsOnly` hides fully simulated cards. */
export function formatAudit(reports: CardReport[], problemsOnly = false): string {
  const order: CardStatus[] = ['refused', 'none', 'partial', 'ok'];
  const sorted = [...reports].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.name.localeCompare(b.name));
  const out: string[] = [];
  for (const r of sorted) {
    if (problemsOnly && r.status === 'ok') continue;
    out.push(`${r.status.toUpperCase().padEnd(8)} ${r.name} ${r.manaCost} — ${r.typeLine}${r.otherFaces ? ' (other faces not audited)' : ''}`);
    for (const l of r.lines) out.push(`  ${MARK[l.status]} ${l.text.length > 70 ? `${l.text.slice(0, 69)}…` : l.text}\n      ${l.how}`);
  }
  const count = (s: CardStatus) => reports.filter((r) => r.status === s).length;
  out.push('', `${reports.length} cards: ${count('ok')} ok, ${count('partial')} partial, ${count('none')} not simulated, ${count('refused')} can't be cast`);
  out.push('✓ simulated   ✗ recognized, not simulated   ? silently ignored by the engine (check these first)');
  return out.join('\n');
}
