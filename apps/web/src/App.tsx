import { Routes, Route, NavLink } from 'react-router-dom';
import Logo from './components/Logo';
import MapPage from './pages/MapPage';
import SearchPage from './pages/SearchPage';
import RestaurantPage from './pages/RestaurantPage';
import AboutPage from './pages/AboutPage';
import PrivacyPage from './pages/PrivacyPage';
import TermsPage from './pages/TermsPage';
import SupportPage from './pages/SupportPage';

export default function App() {
  return (
    <div className="app">
      <header className="header">
        <NavLink to="/" className="brand">
          <Logo size={30} />
          <span className="brand-word">
            DineSafe<span className="brand-sd">SD</span>
          </span>
        </NavLink>
        <nav className="nav">
          <NavLink to="/" end>
            Map
          </NavLink>
          <NavLink to="/search">Search</NavLink>
          <NavLink to="/about">About</NavLink>
        </nav>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<MapPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/r/:id" element={<RestaurantPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/support" element={<SupportPage />} />
        </Routes>
      </main>
    </div>
  );
}
