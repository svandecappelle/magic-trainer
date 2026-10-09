/** Ready-made decks for the bot, built from cards whose rules the engine simulates well. */
export const PRESET_DECKS: { id: string; name: string; list: string }[] = [
  {
    id: 'preset-red',
    name: 'Red Aggro (preset)',
    list: `22 Mountain
4 Goblin Guide
4 Monastery Swiftspear
4 Jackal Pup
4 Raging Goblin
4 Hill Giant
4 Lightning Bolt
4 Shock
4 Lava Spike
4 Volcanic Hammer
2 Lava Axe`,
  },
  {
    id: 'preset-green',
    name: 'Green Stompy (preset)',
    list: `24 Forest
4 Llanowar Elves
4 Grizzly Bears
4 Kalonian Tusker
4 Centaur Courser
4 Garruk's Companion
4 Giant Spider
4 Leatherback Baloth
4 Craw Wurm
4 Colossal Dreadmaw`,
  },
  {
    id: 'preset-white',
    name: 'White Weenie (preset)',
    list: `22 Plains
4 Savannah Lions
4 Elite Vanguard
4 Youthful Knight
4 Benalish Knight
4 Suntail Hawk
4 Pegasus Courser
4 Serra Angel
4 Swords to Plowshares
4 Ajani's Pridemate
2 Baneslayer Angel`,
  },
  {
    id: 'preset-flash',
    name: 'Blue-Green Flash (preset)',
    list: `12 Forest
11 Island
4 Ambush Viper
4 Spectral Sailor
4 Grizzly Bears
4 Giant Spider
4 Centaur Courser
2 Craw Wurm
4 Counterspell
3 Essence Scatter
4 Giant Growth
4 Divination`,
  },
];
