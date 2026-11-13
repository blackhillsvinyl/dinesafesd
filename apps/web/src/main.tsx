import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { fetchRestaurant } from './lib/api';
import { prerenderedUpdatedAt } from './lib/prerendered';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60 * 5, gcTime: 1000 * 60 * 30 },
  },
});

const root = document.getElementById('root')!;
prerenderedUpdatedAt(); // read the build stamp before React replaces the markup

function mount() {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>
  );
}

// Restaurant pages arrive with the report already in the HTML. Load its data
// before mounting so the prerendered report stays on screen until React can
// draw the same thing, instead of flashing a loading state.
const prerenderedId =
  root.getAttribute('data-prerendered') === 'restaurant'
    ? /^\/r\/([^/]+)\/?$/.exec(window.location.pathname)?.[1]
    : undefined;
if (prerenderedId) {
  const id = decodeURIComponent(prerenderedId);
  queryClient
    .prefetchQuery({
      queryKey: ['restaurant', id],
      queryFn: () => fetchRestaurant(id),
      staleTime: 1000 * 60 * 30,
    })
    .finally(mount);
} else {
  mount();
}
