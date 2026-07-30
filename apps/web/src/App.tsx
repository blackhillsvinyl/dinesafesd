import { Routes, Route, NavLink } from 'react-router-dom';
import Logo from './components/Logo';
import { useThemePref, setThemePref } from './lib/theme';
import type { ThemePref } from './lib/theme';
import MapPage from './pages/MapPage';
import SearchPage from './pages/SearchPage';
import LatestPage from './pages/LatestPage';
import RestaurantPage from './pages/RestaurantPage';
import AboutPage from './pages/AboutPage';
import PrivacyPage from './pages/PrivacyPage';
import TermsPage from './pages/TermsPage';
import SupportPage from './pages/SupportPage';

const THEME_CYCLE: Record<ThemePref, ThemePref> = { auto: 'light', light: 'dark', dark: 'auto' };
const THEME_ICON: Record<ThemePref, string> = { auto: '◐', light: '☀️', dark: '🌙' };
const THEME_LABEL: Record<ThemePref, string> = {
  auto: 'Theme: auto (follows your device)',
  light: 'Theme: light',
  dark: 'Theme: dark',
};

export default function App() {
  const theme = useThemePref();
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
          <NavLink to="/latest">Latest</NavLink>
          <NavLink to="/about">About</NavLink>
          <button
            className="theme-toggle"
            onClick={() => setThemePref(THEME_CYCLE[theme])}
            title={THEME_LABEL[theme]}
            aria-label={THEME_LABEL[theme]}
          >
            {THEME_ICON[theme]}
          </button>
        </nav>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<MapPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/latest" element={<LatestPage />} />
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
