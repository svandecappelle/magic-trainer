import { useEffect } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { LANGS, messagesFor, useLang, useT, type Lang } from './i18n';
import { Collection } from './pages/Collection';
import { DeckEditor } from './pages/DeckEditor';
import { Decks } from './pages/Decks';
import { Goldfish } from './pages/Goldfish';
import { Home } from './pages/Home';
import { LifeTracker } from './pages/LifeTracker';
import { Online } from './pages/Online';
import { Play } from './pages/Play';

export function App() {
  const t = useT();
  const { lang, setLang } = useLang();

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <>
      <nav className="topnav">
        <NavLink to="/" className="brand" end>Magic Trainer</NavLink>
        <NavLink to="/decks">{t.nav.decks}</NavLink>
        <NavLink to="/collection">{t.nav.collection}</NavLink>
        <NavLink to="/goldfish">{t.nav.goldfish}</NavLink>
        <NavLink to="/play">{t.nav.play}</NavLink>
        <NavLink to="/online">{t.nav.online}</NavLink>
        <NavLink to="/life">{t.nav.life}</NavLink>
        <span className="spacer" />
        <select className="lang-select" aria-label={t.common.language} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
          {LANGS.map((l) => <option key={l} value={l}>{messagesFor(l).langName}</option>)}
        </select>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/decks" element={<Decks />} />
          <Route path="/decks/:deckId" element={<DeckEditor />} />
          <Route path="/collection" element={<Collection />} />
          <Route path="/goldfish" element={<Goldfish />} />
          <Route path="/goldfish/:deckId" element={<Goldfish />} />
          <Route path="/play" element={<Play />} />
          <Route path="/online" element={<Online />} />
          <Route path="/life" element={<LifeTracker />} />
        </Routes>
      </main>
      <footer className="muted small">
        {t.footer.dataFrom} <a href="https://scryfall.com">Scryfall</a>. {t.footer.wotc}
      </footer>
    </>
  );
}
