/** Small line icons for zones and counters, drawn with the text color (decorative: the label is on the element). */
const PATHS = {
  library: 'M4 2.5h7a1.5 1.5 0 0 1 1.5 1.5v9.5H5.5A1.5 1.5 0 0 1 4 12zM4 12a1.5 1.5 0 0 1 1.5-1.5h7',
  hand: 'M2.5 4.5 7 3.2l2.6 9.3-4.5 1.3zM8.6 3.4l2.4-.3 1.4 9.4-2.3.4',
  graveyard: 'M4 14V7a4 4 0 0 1 8 0v7zM2.5 14h11M8 6.5v4M6.5 8h3',
  exile: 'M8 2a6 6 0 1 0 6 6M8 5a3 3 0 1 0 3 3',
  command: 'M2.5 12.5h11L14 5l-3.2 2.4L8 3 5.2 7.4 2 5z',
  heart: 'M8 13.5S2.5 10 2.5 6.2A2.9 2.9 0 0 1 8 4.8a2.9 2.9 0 0 1 5.5 1.4C13.5 10 8 13.5 8 13.5z',
  poison: 'M8 2.5s-4 4.4-4 7.2a4 4 0 0 0 8 0C12 6.9 8 2.5 8 2.5z',
  sword: 'M13.5 2.5 7 9M13.5 2.5h-3M13.5 2.5v3M5 8.5l2.5 2.5M3 13l2.5-2.5',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon-svg" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
