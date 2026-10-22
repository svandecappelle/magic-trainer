import type { Permanent } from '../../lib/engine/engine';
import { cardTypes, isCreature, isLandCard, isPlaneswalker } from '../../lib/engine/rules';

/**
 * Big boards: each side's permanents in three lanes, identical ones drawn as one stack ("Treasure ×20"). Only copies
 * nothing tells apart are stacked: the same card, no counters, damage, boosts or attachments, no chosen type or color.
 */
export type Lane = 'creatures' | 'others' | 'lands';

/** Creatures, planeswalkers and battles (what combat is about); lands (not animated); the rest. */
export function laneOf(perm: Permanent): Lane {
  if (isCreature(perm.card) || isPlaneswalker(perm.card) || cardTypes(perm.card).includes('battle')) return 'creatures';
  return isLandCard(perm.card) ? 'lands' : 'others';
}

/** Can this permanent go in a stack at all? (Then it also shows as a compact chip without losing anything.) */
export const plain = (perm: Permanent) =>
  !perm.damage && !perm.boosts.length && !Object.values(perm.counters).some(Boolean) && !perm.commander && !perm.chosenType
  && !perm.chosenColor && !perm.chosenName && !perm.printed && !perm.unanimated && !perm.attachedTo && !perm.statics?.power
  && !perm.statics?.toughness;

/**
 * What copies must share to be one stack. Creatures: tapped or not, summoning sick or not (they act apart); lands and
 * other permanents mix tapped and untapped copies (the stack says how many are untapped).
 */
function stackKey(perm: Permanent): string {
  const c = perm.card;
  const creature = laneOf(perm) === 'creatures';
  return [perm.controller, c.name, c.typeLine, c.oracleText, c.power ?? '', c.toughness ?? '', creature ? `${perm.tapped}|${perm.sick}` : ''].join('\n');
}

export interface Stack {
  /** The copies, in battlefield order; one for a permanent drawn alone. */
  perms: Permanent[];
}

/**
 * Groups permanents into stacks, in the order their first copy comes; `apart`: permanents the board shows alone right
 * now (attacking, chosen as a target or to pay, with an Aura attached…).
 */
export function stacksOf(perms: Permanent[], apart: (perm: Permanent) => boolean = () => false): Stack[] {
  const out: Stack[] = [];
  const byKey = new Map<string, Stack>();
  for (const perm of perms) {
    if (!plain(perm) || apart(perm)) {
      out.push({ perms: [perm] });
      continue;
    }
    const key = stackKey(perm);
    const found = byKey.get(key);
    if (found) found.perms.push(perm);
    else {
      const stack = { perms: [perm] };
      byKey.set(key, stack);
      out.push(stack);
    }
  }
  return out;
}

/** How many copies of a stack are untapped. */
export const untappedIn = (stack: Stack) => stack.perms.filter((p) => !p.tapped).length;
