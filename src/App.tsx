import { NavLink, Route, Routes } from 'react-router-dom';
import { Collection } from './pages/Collection';
import { DeckEditor } from './pages/DeckEditor';
import { Decks } from './pages/Decks';
import { Goldfish } from './pages/Goldfish';
import { Home } from './pages/Home';
import { LifeTracker } from './pages/LifeTracker';
import { Online } from './pages/Online';
import { Play } from './pages/Play';

export function App() {
  return (
    <>
      <nav className="topnav">
        <NavLink to="/" className="brand" end>Magic Trainer</NavLink>
        <NavLink to="/decks">Decks</NavLink>
        <NavLink to="/collection">Collection</NavLink>
        <NavLink to="/goldfish">Goldfish</NavLink>
        <NavLink to="/play">Play vs Bot</NavLink>
        <NavLink to="/online">Play Online</NavLink>
        <NavLink to="/life">Life tracker</NavLink>
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
        Card data and images from <a href="https://scryfall.com">Scryfall</a>. Magic: The Gathering is © Wizards of the Coast.
      </footer>
    </>
  );
}
