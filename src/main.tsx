import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => {
        for (const reg of registrations) {
          if (reg.active && reg.active.scriptURL.includes('dev-sw')) {
            reg.unregister();
          } else {
            reg.update();
          }
        }
      })
      .catch(() => {});

    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {
      // Ignore service worker registration errors in restricted frames
    });
  });
}

createRoot(document.getElementById('root')!).render(<App />);
