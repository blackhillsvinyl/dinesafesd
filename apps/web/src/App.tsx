import { useEffect, useRef } from 'react';
import { Routes, Route, NavLink, Link, useLocation, useNavigationType } from 'react-router-dom';
import Logo from './components/Logo';
import { useThemePref, setThemePref } from './lib/theme';
import type { ThemePref } from './lib/theme';
import { NOT_FOUND_META, STATIC_META } from './lib/meta';
import { usePageMeta } from './lib/usePageMeta';
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
  auto: 'Theme: auto (follows your device). Switch to light.',
  light: 'Theme: light. Switch to dark.',
  dark: 'Theme: dark. Switch to auto.',
};

function StaticPage({ path, children }: { path: string; children: React.ReactNode }) {
  usePageMeta(STATIC_META[path]);
  return <>{children}</>;
}

function NotFoundPage() {
  usePageMeta(NOT_FOUND_META);
  return (
    <div className="page">
      <h1>Page not found</h1>
      <p>There is nothing at this address.</p>
      <p>
        <Link to="/">Go to the map</Link> · <Link to="/search">Search restaurants</Link>
      </p>
    </div>
  );
}

export default function App() {
  const theme = useThemePref();
  const { pathname } = useLocation();
  const navType = useNavigationType();
  const mainRef = useRef<HTMLElement>(null);
  const first = useRef(true);

  // After in-app navigation, start the new page at the top and move focus
  // into it, so keyboard and screen-reader users aren't left on the old link.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (navType !== 'POP') window.scrollTo(0, 0);
    const main = mainRef.current;
    if (main && !main.contains(document.activeElement)) main.focus({ preventScroll: true });
  }, [pathname, navType]);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="header">
        <NavLink to="/" className="brand" aria-label="DineSafeSD home">
          <Logo size={30} />
          <span className="brand-word" aria-hidden="true">
            DineSafe<span className="brand-sd">SD</span>
          </span>
        </NavLink>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end>
            Map
          </NavLink>
          <NavLink to="/search">Search</NavLink>
          <NavLink to="/latest">Latest</NavLink>
          <NavLink to="/about">About</NavLink>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setThemePref(THEME_CYCLE[theme])}
            title={THEME_LABEL[theme]}
            aria-label={THEME_LABEL[theme]}
          >
            <span aria-hidden="true">{THEME_ICON[theme]}</span>
          </button>
        </nav>
      </header>
      <main className="main" id="main" ref={mainRef} tabIndex={-1}>
        <Routes>
          <Route path="/" element={<MapPage />} />
          <Route path="/search" element={<StaticPage path="/search"><SearchPage /></StaticPage>} />
          <Route path="/latest" element={<StaticPage path="/latest"><LatestPage /></StaticPage>} />
          <Route path="/r/:id" element={<RestaurantPage />} />
          <Route path="/about" element={<StaticPage path="/about"><AboutPage /></StaticPage>} />
          <Route path="/privacy" element={<StaticPage path="/privacy"><PrivacyPage /></StaticPage>} />
          <Route path="/terms" element={<StaticPage path="/terms"><TermsPage /></StaticPage>} />
          <Route path="/support" element={<StaticPage path="/support"><SupportPage /></StaticPage>} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </div>
  );
}
