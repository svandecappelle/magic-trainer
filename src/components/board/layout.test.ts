import { describe, expect, it } from 'vitest';
import { clampSize, layoutStyle, readLayout } from './layout';

describe('board layout', () => {
  it('keeps only valid saved values, within their limits', () => {
    expect(readLayout(null)).toEqual({});
    expect(readLayout('not json')).toEqual({});
    expect(readLayout('[1]')).toEqual({});
    expect(readLayout('{"side":9999,"opp":10,"perm":"big","hand":90.4,"closed":true,"other":1}'))
      .toEqual({ side: 520, opp: 25, hand: 90, closed: true });
    expect(clampSize('perm', 12)).toBe(40);
    expect(readLayout('{"land":200}')).toEqual({ land: 110 });
  });

  it('turns the layout into CSS variables, leaving the card sizes to the window by default', () => {
    expect(layoutStyle({})).toEqual({ '--side-w': '320px', '--opp-fr': '50fr', '--you-fr': '50fr' });
    expect(layoutStyle({ side: 400, opp: 70, perm: 100, land: 50, hand: 120 })).toEqual({
      '--side-w': '400px', '--opp-fr': '70fr', '--you-fr': '30fr', '--perm-w': '100px', '--land-w': '50px', '--hand-w': '120px',
    });
    // Lands left out follow the other permanents (the stylesheet's 70 %).
    expect(layoutStyle({ perm: 100 })).not.toHaveProperty('--land-w');
  });
});
