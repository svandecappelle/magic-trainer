import { useEffect } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { AccountMenu, LoginNotice } from './components/AccountMenu';
import { LANGS, messagesFor, useLang, useT, type Lang } from './i18n';
import { Collection } from './pages/Collection';
import { DeckEditor } from './pages/DeckEditor';
import { Decks } from './pages/Decks';
import { Goldfish } from './pages/Goldfish';
import { History } from './pages/History';
import { Home } from './pages/Home';
import { LifeTracker } from './pages/LifeTracker';
import { Online } from './pages/Online';
import { Play } from './pages/Play';
import { initAccount } from './store/useAccount';

/** The tab bar on phones: each section with a stroke icon. */
const TABS = [
  { to: '/decks', key: 'decks', icon: <><rect x="4" y="3" width="12" height="16" rx="2" /><path d="M8 21h10a2 2 0 0 0 2-2V7" /></> },
  { to: '/collection', key: 'collection', icon: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" /></> },
  { to: '/goldfish', key: 'goldfish', icon: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></> },
  { to: '/play', key: 'play', icon: <><path d="M14.5 17.5L3 6V3h3l11.5 11.5" /><path d="M13 19l6-6M16 16l4 4" /></> },
  { to: '/online', key: 'online', icon: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M3 20c0-3 3-5 6-5s6 2 6 5M15 15c3 0 6 1.5 6 4" /></> },
  { to: '/life', key: 'life', icon: <path d="M12 21s-7-4.5-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.5-9 9-9 9z" /> },
] as const;

export function App() {
  const t = useT();
  const { lang, setLang } = useLang();

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    void initAccount();
  }, []);

  return (
    <>
      <nav className="topnav">
        <NavLink to="/" className="brand" end>
          <svg className="brand-mark" width="26" height="26" viewBox="0 0 40 40" aria-hidden="true">
            <path d="M20 3 35 12v16L20 37 5 28V12z" fill="none" stroke="var(--accent)" strokeWidth="2.6" />
            <path d="M20 10 28 15v10l-8 5-8-5V15z" fill="var(--accent)" />
          </svg>
          Magic Trainer
        </NavLink>
        <NavLink to="/decks">{t.nav.decks}</NavLink>
        <NavLink to="/collection">{t.nav.collection}</NavLink>
        <NavLink to="/goldfish">{t.nav.goldfish}</NavLink>
        <NavLink to="/play">{t.nav.play}</NavLink>
        <NavLink to="/online">{t.nav.online}</NavLink>
        <NavLink to="/life">{t.nav.life}</NavLink>
        {/* Not in the phone tab bar (six tabs fill it): an icon in the top bar there. */}
        <NavLink to="/history" className="nav-history" aria-label={t.nav.history}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 3" />
          </svg>
          <span>{t.nav.history}</span>
        </NavLink>
        <span className="spacer" />
        <select className="lang-select" aria-label={t.common.language} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
          {LANGS.map((l) => <option key={l} value={l}>{messagesFor(l).langName}</option>)}
        </select>
        <AccountMenu />
      </nav>
      <LoginNotice />
      {/* Phones: the sections move to a tab bar at the bottom, within thumb reach. */}
      <nav className="tabbar" aria-label={t.common.sections}>
        {TABS.map(({ to, key, icon }) => (
          <NavLink key={to} to={to}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>
            <span>{t.tabs[key]}</span>
          </NavLink>
        ))}
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/decks" element={<Decks />} />
          <Route path="/decks/:deckId" element={<DeckEditor />} />
          <Route path="/collection" element={<Collection />} />
          <Route path="/goldfish" element={<Goldfish />} />
          <Route path="/goldfish/:deckId" element={<Goldfish />} />
          <Route path="/play/:gameId?" element={<Play />} />
          <Route path="/online/:roomId?" element={<Online />} />
          <Route path="/life" element={<LifeTracker />} />
          <Route path="/history" element={<History />} />
          <Route path="/history/replay/:replayId" element={<History />} />
        </Routes>
      </main>
      <footer className="muted small">
        {t.footer.dataFrom} <a href="https://scryfall.com">Scryfall</a>. {t.footer.wotc}
      </footer>
    </>
  );
}
