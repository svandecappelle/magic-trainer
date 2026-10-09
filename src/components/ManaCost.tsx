/** Renders "{2}{W}{U/B}" with Scryfall's official mana symbol SVGs. */
export function ManaCost({ cost }: { cost: string }) {
  const symbols = cost.match(/\{[^}]+\}/g) ?? [];
  return (
    <span className="mana-cost">
      {symbols.map((sym, i) => {
        const code = sym.slice(1, -1).replace(/\//g, '');
        return (
          <img
            key={i}
            className="mana-symbol"
            src={`https://svgs.scryfall.io/card-symbols/${encodeURIComponent(code)}.svg`}
            alt={sym}
          />
        );
      })}
    </span>
  );
}
