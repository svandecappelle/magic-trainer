import type { Messages } from './en';
import type { ErrorMessages, GoldfishLogMessages, LogMessages } from './types';

/** French uses the singular for 0 and 1. */
const plural = (n: number, one: string, many: string) => `${n} ${n <= 1 ? one : many}`;
const fmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const money = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD' });
const percent = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1, minimumFractionDigits: 1 });
const lists = new Intl.ListFormat('fr', { type: 'conjunction' });

const targetKinds = { any: 'une créature ou un joueur', creature: 'une créature', player: 'un joueur', spell: 'un sort sur la pile' };
const kindName = (kind: string | number) => targetKinds[kind as keyof typeof targetKinds] ?? String(kind);
const filterName = (filter: string | number) => (filter === 'creature' ? 'de créature' : filter === 'noncreature' ? 'non-créature' : '');

const log: LogMessages = {
  goesFirst: (e, c) => (c.isMe(e.p) ? 'Vous commencez' : `${c.name(e.p)} commence`),
  turn: (e, c) => `— Tour ${e.n} : ${c.isMe(e.p) ? 'vous' : c.name(e.p)} —`,
  mulligan: (e, c) => `${c.isMe(e.p) ? 'Vous faites' : `${c.name(e.p)} fait`} un mulligan (garde ${e.keeping})`,
  keep: (e, c) => `${c.isMe(e.p) ? 'Vous gardez' : `${c.name(e.p)} garde`} ${plural(e.n, 'carte', 'cartes')}`,
  playLand: (e, c) => `${c.isMe(e.p) ? 'Vous jouez' : `${c.name(e.p)} joue`} ${c.card(e.card)}`,
  cast: (e, c) => {
    const who = c.isMe(e.p) ? 'Vous lancez' : `${c.name(e.p)} lance`;
    const target =
      e.targetCard ? ` en ciblant ${c.card(e.targetCard)}`
      : e.targetPlayer !== undefined ? (c.isMe(e.targetPlayer) ? ' en vous ciblant' : ` en ciblant ${c.name(e.targetPlayer)}`)
      : '';
    return `${who} ${c.card(e.card)}${target}`;
  },
  enters: (e, c) => `${c.card(e.card)} arrive sur le champ de bataille`,
  attack: (e, c) => `${c.isMe(e.p) ? 'Vous attaquez' : `${c.name(e.p)} attaque`} avec ${c.list(e.cards.map(c.card))}`,
  blocked: (e, c) => `${c.card(e.card)} est bloqué par ${c.list(e.by.map(c.card))}`,
  damage: (e, c) => `${c.card(e.card)} inflige ${e.n} à ${c.card(e.target)}`,
  damagePlayer: (e, c) => `${c.card(e.card)} ${c.isMe(e.p) ? `vous inflige ${e.n}` : `inflige ${e.n} à ${c.name(e.p)}`}`,
  dies: (e, c) => `${c.card(e.card)} meurt`,
  destroyed: (e, c) => `${c.card(e.card)} est détruit`,
  exiled: (e, c) => `${c.card(e.card)} est exilé`,
  pump: (e, c) => `${c.card(e.card)} gagne +${e.power}/+${e.toughness} jusqu'à la fin du tour`,
  countered: (e, c) => `${c.card(e.card)} est contrecarré`,
  fizzles: (e, c) => `${c.card(e.card)} n'a plus de cible et n'a aucun effet`,
  notSimulated: (e, c) => `(l'effet de ${c.card(e.card)} n'est pas simulé)`,
  gainLife: (e, c) => `${c.isMe(e.p) ? 'Vous gagnez' : `${c.name(e.p)} gagne`} ${e.n} points de vie`,
  discard: (e, c) => `${c.isMe(e.p) ? 'Vous défaussez' : `${c.name(e.p)} défausse`} ${c.card(e.card)} (taille de main)`,
  emptyLibrary: (e, c) =>
    c.isMe(e.p) ? 'Vous ne pouvez pas piocher dans une bibliothèque vide : vous perdez' : `${c.name(e.p)} ne peut pas piocher dans une bibliothèque vide et perd`,
  concede: (e, c) => (c.isMe(e.p) ? 'Vous abandonnez' : `${c.name(e.p)} abandonne`),
  wins: (e, c) => (c.isMe(e.p) ? 'Vous gagnez !' : `${c.name(e.p)} gagne !`),
  draw: () => 'La partie est nulle',
};

const goldfishLog: GoldfishLogMessages = {
  newGame: () => 'Nouvelle partie, 7 cartes piochées',
  mulligan: (e) => `Mulligan à ${e.keeping}`,
  chooseBottom: (e) => `Main gardée, choisissez ${plural(e.n, 'carte', 'cartes')} à mettre au-dessous`,
  onThePlay: () => 'Vous commencez, pas de pioche',
  onTheDraw: () => 'Vous piochez une carte',
  drew: (e) => (e.n === 1 ? 'Carte piochée' : `${e.n} cartes piochées`),
  libraryEmpty: () => 'La bibliothèque est vide !',
  move: (e, zone, card) => `${card(e.card)} : ${zone(e.from)} → ${zone(e.to)}`,
  untapDraw: () => 'Dégagement, pioche',
  shuffled: () => 'Bibliothèque mélangée',
};

const errors: ErrorMessages = {
  // Règles
  gameOver: () => 'La partie est terminée',
  keepFirst: () => "Décidez d'abord si vous gardez votre main de départ",
  notMulliganTime: () => 'Les mulligans ont lieu avant le début de la partie',
  noMoreMulligans: () => 'Vous ne pouvez plus faire de mulligan',
  chooseBottom: (p) => `Choisissez ${plural(Number(p.n), 'carte', 'cartes')} à mettre au-dessous de votre bibliothèque`,
  notInHand: () => "Cette carte n'est pas dans votre main",
  landTiming: () => 'Les terrains ne se jouent que pendant votre phase principale',
  landAlreadyPlayed: () => 'Vous avez déjà joué un terrain ce tour-ci',
  notALand: () => "Ce n'est pas un terrain de votre main",
  notASpell: () => "Ce n'est pas un sort de votre main",
  sorcerySpeed: (p) => `${p.card} ne peut être lancé que pendant votre phase principale`,
  castTiming: () => 'Les sorts se lancent pendant votre phase principale (ou les éphémères quand vous avez la priorité)',
  needsTarget: (p) => `${p.card} a besoin d'une cible`,
  targetMustBe: (p) => `La cible doit être ${kindName(p.kind)}`,
  counterFilter: (p) => `${p.card} ne peut contrecarrer que les sorts ${filterName(p.filter)}`,
  notEnoughMana: (p) => `Pas assez de mana pour ${p.card}`,
  declareBlockersFirst: () => 'Déclarez les bloqueurs (ou aucun blocage) pour continuer',
  notAttackStep: () => "Ce n'est pas l'étape de déclaration des attaquants",
  cannotAttack: () => 'Cette créature ne peut pas attaquer',
  notBlockStep: () => "Ce n'est pas l'étape de déclaration des bloqueurs",
  notAttacking: () => "Cette créature n'attaque pas",
  menace: (p) => `${p.card} a la menace et doit être bloqué par au moins deux créatures`,
  cannotBlock: (p) => `${p.blocker} ne peut pas bloquer ${p.attacker}`,
  // Serveur
  invalidMessage: () => 'Message invalide',
  unknownMessage: () => 'Message inconnu',
  enterName: () => 'Veuillez saisir un nom',
  deckSize: (p) => `Les decks doivent contenir entre ${p.min} et ${p.max} cartes`,
  invalidCard: () => 'Carte invalide dans le deck',
  noRoom: (p) => `Aucune salle avec le code ${p.code}`,
  roomFull: () => 'Cette salle est pleine',
  gameGone: () => "Cette partie n'existe plus",
  notStarted: () => "La partie n'a pas commencé",
  invalidAction: () => 'Action invalide',
  notYourTurn: () => "Ce n'est pas à vous d'agir",
  gameNotOver: () => "La partie n'est pas terminée",
  opponentLeft: () => 'Votre adversaire est parti',
  notInRoom: () => "Vous n'êtes dans aucune salle",
  // Navigateur
  notConnected: () => 'Pas de connexion au serveur de jeu',
  enterYourName: () => 'Veuillez saisir votre nom',
  enterRoomCode: () => 'Saisissez le code de salle donné par votre ami',
  deckTooSmall: (p) => `Votre deck principal doit contenir au moins ${p.n} cartes.`,
  decksTooSmall: (p) => `Les deux decks principaux doivent contenir au moins ${p.n} cartes.`,
  loadFailed: (p) => `Impossible de charger les cartes : ${p.message}`,
  cannotCastNow: (p) => `${p.card} ne peut pas être lancé maintenant`,
  nothingToTarget: (p) => `${p.card} n'a rien à cibler pour le moment`,
  chooseTargetKind: (p) => `Choisissez ${kindName(p.kind)}`,
};

export const fr: Messages = {
  langName: 'Français',
  num: (n) => fmt.format(n),
  price: (n) => money.format(n),
  percent: (n) => percent.format(n),
  list: (items) => lists.format(items),

  common: {
    hoverPreview: 'Survolez une carte pour la voir',
    loadingCards: 'Chargement des cartes…',
    keep: 'Garder',
    mulligan: 'Mulligan',
    delete: 'Supprimer',
    cancel: 'Annuler',
    turn: 'Tour',
    log: 'Journal',
    language: 'Langue',
  },
  nav: {
    decks: 'Decks',
    collection: 'Collection',
    goldfish: 'Goldfish',
    play: 'Contre le bot',
    online: 'En ligne',
    life: 'Points de vie',
  },
  footer: {
    dataFrom: 'Données et images des cartes :',
    wotc: 'Magic: The Gathering est © Wizards of the Coast.',
  },
  types: {
    Land: 'Terrain', Creature: 'Créature', Planeswalker: 'Planeswalker', Battle: 'Bataille', Instant: 'Éphémère',
    Sorcery: 'Rituel', Artifact: 'Artefact', Enchantment: 'Enchantement', Other: 'Autre',
  },
  formats: {
    standard: 'Standard', pioneer: 'Pionnier', modern: 'Moderne', legacy: 'Legacy', vintage: 'Vintage',
    pauper: 'Pauper', commander: 'Commander', casual: 'Libre',
  },
  presets: {
    'preset-red': 'Aggro rouge (prédéfini)',
    'preset-green': 'Stompy vert (prédéfini)',
    'preset-white': 'Weenie blanc (prédéfini)',
    'preset-flash': 'Flash bleu-vert (prédéfini)',
  },
  colors: { W: 'Blanc', U: 'Bleu', B: 'Noir', R: 'Rouge', G: 'Vert' },

  home: {
    summary: (decks, unique) =>
      `${plural(decks, 'deck', 'decks')} · ${plural(unique, 'carte unique', 'cartes uniques')} dans votre collection`,
    features: {
      decks: ['Création de decks', 'Cherchez parmi toutes les cartes, créez des decks, importez et exportez des listes, vérifiez la courbe et les probabilités de terrains.'],
      collection: ['Collection', 'Suivez les cartes que vous possédez et leur valeur. Les decks indiquent les cartes qui vous manquent.'],
      goldfish: ['Goldfish', 'Entraînez-vous seul avec un deck : mains de départ, mulligan London, tours de jeu, engagement des terrains.'],
      play: ['Contre le bot', 'Testez votre deck contre un adversaire virtuel avec un vrai combat, du mana et des sorts de destruction.'],
      online: ['En ligne', 'Affrontez un ami sur Internet : partagez un code de salle, choisissez vos decks et jouez.'],
      life: ['Points de vie', 'Points de vie, poison et tours pour 2 à 6 joueurs autour de la table, plus dés et pile ou face.'],
    },
    recentDecks: 'Decks récents',
    cardCount: (n) => `(${plural(n, 'carte', 'cartes')})`,
  },

  decks: {
    title: 'Decks',
    newDeckName: 'Nom du nouveau deck',
    createDeck: 'Créer le deck',
    importDecklist: 'Importer une liste',
    importHelp: 'Collez une liste exportée depuis MTG Arena, MTGO, Moxfield, Archidekt… ou chargez un fichier .txt.',
    importFormat: 'Les lignes ressemblent à « 4 Lightning Bolt » ; une ligne « Sideboard » commence la réserve.',
    deckName: 'Nom du deck',
    lookingUp: 'Recherche des cartes…',
    importAsNew: 'Importer comme nouveau deck',
    detected: (main, side) => `${main} principal · ${side} réserve`,
    noneFound: (unknown) => `Aucune carte trouvée. Inconnues : ${unknown.join(', ')}`,
    partlyFound: (unknown) => `Deck créé, mais ces cartes sont introuvables : ${unknown.join(', ')}`,
    openDeck: 'Ouvrir le deck →',
    importedName: 'Deck importé',
    untitled: 'Deck sans titre',
    empty: "Aucun deck pour l'instant. Créez-en un ou importez une liste.",
    tile: (format, n) => `${format} · ${plural(n, 'carte', 'cartes')}`,
    goldfish: 'Goldfish',
    confirmDelete: (name) => `Supprimer « ${name} » ?`,
  },

  editor: {
    notFound: 'Deck introuvable.',
    back: 'Retour aux decks',
    imported: (n) => `${plural(n, 'ligne importée', 'lignes importées')}.`,
    importedMissing: (unknown) => `Importé. Introuvables : ${unknown.join(', ')}`,
    empty: 'Vide',
    owned: 'Exemplaires dans votre collection',
    addOne: 'Ajouter un exemplaire',
    removeOne: 'Retirer un exemplaire',
    toSide: 'Déplacer un exemplaire en réserve',
    toMain: 'Déplacer un exemplaire dans le deck principal',
    toSideShort: '→Rés.',
    toMainShort: '→Pr.',
    import: 'Importer',
    export: 'Exporter',
    goldfish: 'Goldfish ▶',
    importHelp: 'Collez une liste (Arena/MTGO/texte). Elle remplace la liste actuelle.',
    copy: 'Copier',
    addCards: 'Ajouter des cartes',
    addMain: '+Pr.',
    addSide: '+Rés.',
    addMainTitle: 'Ajouter au deck principal',
    addSideTitle: 'Ajouter à la réserve',
    mainDeck: 'Deck principal',
    sideboard: 'Réserve',
  },

  stats: {
    cards: 'cartes',
    sideboard: 'réserve',
    avgMv: 'VM moy.',
    curve: 'Courbe de mana',
    colors: 'Couleurs',
    colorless: 'Incolore',
    pips: (color, n) => `${color} : ${plural(n, 'symbole', 'symboles')}`,
    types: 'Types',
    openingHand: 'Main de départ',
    chanceLead: 'Probabilité d’avoir au moins',
    chanceTail: 'terrain(s) en 7 cartes :',
    landsIn: (lands, size) => `${plural(lands, 'terrain', 'terrains')} sur ${plural(size, 'carte', 'cartes')}`,
    needSeven: 'Ajoutez au moins 7 cartes.',
    curveTitle: (n) => plural(n, 'carte', 'cartes'),
  },

  search: {
    placeholder: 'Chercher des cartes… (syntaxe Scryfall : "t:goblin c:r cmc<=2")',
    searching: 'Recherche…',
    results: (n) => plural(n, 'résultat', 'résultats'),
    loadMore: 'Afficher plus',
  },

  collection: {
    title: 'Collection',
    unique: 'uniques',
    cards: 'cartes',
    addCards: 'Ajouter des cartes',
    addFoil: 'Ajouter un exemplaire foil',
    owned: 'Cartes possédées',
    filter: 'Filtrer par nom',
    columns: ['Carte', 'Édition', 'Qté', 'Foil', 'Prix'],
    empty: 'Rien pour le moment. Cherchez à gauche pour ajouter des cartes.',
  },

  zones: { library: 'bibliothèque', hand: 'main', battlefield: 'champ de bataille', graveyard: 'cimetière', exile: 'exil' },

  goldfish: {
    title: 'Goldfish',
    intro: "Choisissez un deck pour vous entraîner. Piochez des mains de départ, faites des mulligans et jouez des tours en solo.",
    noDecks: "Vous n'avez encore aucun deck.",
    createOne: 'Créez-en un',
    onThePlay: 'Je commence',
    newGame: 'Nouvelle partie',
    untapped: 'Terrains dégagés',
    library: 'Bibliothèque',
    draw: 'Piocher',
    shuffle: 'Mélanger',
    nextTurn: 'Tour suivant ▶',
    opening: (cards, mulligans, lands) =>
      `Main de départ (${plural(cards, 'carte', 'cartes')}${mulligans ? `, mulligan ${mulligans}` : ''}, ${plural(lands, 'terrain', 'terrains')}).`,
    bottoming: (n) => `Mulligan London : cliquez sur ${plural(n, 'carte', 'cartes')} de votre main à mettre au-dessous.`,
    battlefield: 'Champ de bataille',
    battlefieldHint: '(cliquez sur une carte pour l’engager ou la dégager)',
    hand: (n) => `Main (${n})`,
    handHint: '(cliquez sur une carte pour la jouer)',
    graveyard: (n) => `Cimetière (${n})`,
    exile: (n) => `Exil (${n})`,
    actions: {
      gy: ['Cim.', 'Au cimetière'], ex: ['Exil', 'Exiler'], top: ['Dessus', 'Mettre au-dessus de la bibliothèque'],
      hand: ['Main', 'Renvoyer en main'], bf: ['CdB', 'Mettre sur le champ de bataille'],
    },
    turnPrefix: (turn) => (turn > 0 ? `T${turn} : ` : ''),
    log: goldfishLog,
  },

  life: {
    players: 'Joueurs',
    startingLife: 'Points de vie de départ',
    reset: 'Réinitialiser',
    flipCoin: 'Pile ou face',
    coin: (heads) => (heads ? 'Face' : 'Pile'),
    nextPlayer: 'Joueur suivant ▶',
    poison: 'Poison',
    defeated: 'Éliminé',
    playerName: (n) => `Joueur ${n}`,
  },

  play: {
    title: 'Contre le bot',
    yourDeck: 'Votre deck',
    botDeck: 'Deck du bot',
    first: 'Qui commence',
    firstOptions: { random: 'Au hasard', me: 'Moi', bot: 'Le bot' },
    start: 'Lancer la partie',
    rematch: 'Revanche',
    changeDecks: 'Changer de decks',
    botName: 'Bot',
    rules:
      "Règles simplifiées. Mulligan London ; les éphémères et les cartes avec le flash peuvent être lancés quand vous avez la priorité : en réponse à un sort, après la déclaration des attaquants ou des bloqueurs, et en fin de tour. Vous n'êtes sollicité que si vous avez quelque chose à lancer, sauf si vous activez le contrôle total pendant la partie. Le combat gère le vol, la portée, la célérité, la vigilance, le piétinement, le contact mortel, le lien de vie, le défenseur, l'initiative, la double initiative et la menace. Les sorts qui infligent des blessures, détruisent ou exilent une créature, contrecarrent un sort, renforcent une créature, font piocher ou gagner des points de vie sont automatisés ; les autres effets (dont les capacités et déclenchements des créatures) ne sont pas encore simulés.",
    buildDeck: 'Créez un deck',
    bringYourOwn: 'pour jouer avec le vôtre.',
    yourDecks: 'Vos decks',
    presets: 'Prédéfinis',
  },

  online: {
    title: 'Jouer en ligne',
    connecting: 'Connexion au serveur de jeu…',
    disconnected: 'Déconnecté du serveur de jeu, nouvelle tentative…',
    devHint: 'En développement, lancez-le avec',
    yourName: 'Votre nom',
    namePlaceholder: 'Nom',
    deck: 'Deck',
    host: 'Créer une partie',
    hostHint: 'Obtenez un code de salle à envoyer à un ami.',
    createRoom: 'Créer la salle',
    join: 'Rejoindre une partie',
    joinHint: 'Saisissez le code envoyé par votre ami.',
    joinButton: 'Rejoindre',
    sendCode: 'Envoyez ce code de salle à votre adversaire :',
    copy: 'Copier',
    copied: 'Copié !',
    waiting: "En attente d'un adversaire…",
    leaveRoom: 'Quitter la salle',
    reconnecting: 'Reconnexion au serveur…',
    oppDisconnected: (name) => `${name} s'est déconnecté. Il peut recharger la page pour revenir.`,
    wantsRematch: (name) => `${name} veut une revanche.`,
    room: (code) => `Salle ${code}`,
    waitingFor: (name) => `En attente de ${name}…`,
    opponent: "l'adversaire",
    leave: 'Quitter',
  },

  game: {
    you: 'Vous',
    nameYou: (name) => `${name} (vous)`,
    zones: (library, hand, graveyard) => `Bibliothèque ${library} · Main ${hand} · Cimetière ${graveyard}`,
    steps: { mulligan: 'Mulligans', main1: 'Principale 1', attack: 'Attaquants', block: 'Bloqueurs', main2: 'Principale 2' },
    turnLabel: (n, step) => `Tour ${n} · ${step}`,
    targetKinds,
    windows: {
      begin: (myTurn) =>
        myTurn ? 'Début de votre tour. Lancez un éphémère, ou passez.' : 'Début du tour adverse. Lancez un éphémère, ou passez.',
      main: () => 'Lancez un éphémère, ou passez.',
      combat: (myTurn) =>
        myTurn
          ? 'Début du combat. Lancez un éphémère, ou passez.'
          : "L'adversaire passe au combat. Lancez un éphémère avant la déclaration des attaquants, ou passez.",
      attack: (myTurn) =>
        myTurn ? 'Attaquants déclarés. Lancez un éphémère, ou passez.' : 'Vous êtes attaqué. Lancez un éphémère avant les blocages, ou passez.',
      block: () => 'Bloqueurs déclarés. Lancez une astuce de combat, ou passez aux blessures.',
      end: (myTurn) => (myTurn ? 'Fin de votre tour. Lancez un éphémère, ou passez.' : "Fin du tour adverse. Lancez un éphémère, ou passez."),
    },
    youWin: 'Vous gagnez ! 🎉',
    theyWin: (name) => `${name} gagne.`,
    drawGame: 'Partie nulle.',
    oppDeciding: (name) => `${name} réfléchit à un mulligan…`,
    oppDecidesFirst: (name) => `${name} décide en premier…`,
    bottomPrompt: (taken, need, chosen) =>
      `Mulligan ${taken} : cliquez sur ${plural(need, 'carte', 'cartes')} à mettre au-dessous (${chosen}/${need}), ou refaites un mulligan.`,
    openingHand: (lands) => `Main de départ : ${plural(lands, 'terrain', 'terrains')}. Garder ou mulligan ?`,
    mayRespond: (name) => `${name} peut répondre…`,
    choosingBlockers: (name) => `${name} choisit ses bloqueurs…`,
    thinking: (name) => `${name} réfléchit…`,
    chooseTarget: (kind) => `Choisissez une cible (${kind}).`,
    onStack: (card, owner) =>
      `${card} ${owner === null ? '(le vôtre)' : `de ${owner}`} est sur la pile. Répondez avec un éphémère, ou passez.`,
    passResolve: 'Passer (laisser résoudre)',
    pass: 'Passer',
    declareAttackers: 'Déclarez les attaquants : cliquez sur vos créatures.',
    attackWith: (n) => `Attaquer avec ${n}`,
    noAttack: 'Pas d’attaque',
    clickAttacker: "Cliquez maintenant sur l'attaquant à bloquer.",
    declareBlockers: 'Déclarez les bloqueurs : cliquez sur une de vos créatures, puis sur un attaquant.',
    confirmBlocks: 'Valider les blocages',
    main1: 'Phase principale : jouez un terrain, lancez des sorts.',
    main2: 'Seconde phase principale.',
    toCombat: 'Passer au combat ▶',
    endTurn: 'Finir le tour ▶',
    stack: 'Pile (dessus en premier)',
    blocks: (name) => `bloque ${name}`,
    sick: "Mal d'invocation",
    concede: 'Abandonner',
    fullControl: 'Contrôle total',
    fullControlHint: (on) =>
      on
        ? 'Vous recevez la priorité à chaque étape : au début du tour adverse et de son combat, après les attaquants et les bloqueurs, sur chaque sort (les vôtres aussi) et à la fin du tour adverse.'
        : "Vous n'êtes sollicité que si vous avez un éphémère ou une carte avec le flash lançable maintenant. Activez cette option pour vous arrêter à chaque étape.",
  },

  log,
  errors,
};
