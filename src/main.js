// main.js — home route entry. Paints the text hero + card first, then defers
// the three.js glass enhancement until the browser is idle (perf budget:
// LCP < 2.5s — the three.js bundle must never block first paint).
import './tokens.css';
import './card.css';
import { initChrome } from './chrome.js';
import { initCard } from './card.js';

window.__MARIO_SEIJO_BUILD_ID = '2026-07-15-qa-contrast';

initChrome();
initCard();

// Defer the WebGL glass layer to idle time (code-split; three.js only loads here).
const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 200));
idle(() => {
  import('./glass.js')
    .then((m) => m.initGlass())
    .catch((err) => {
      // The CSS glass is a full fallback, so a failure here is non-fatal — but
      // don't swallow it silently (that hid a ReferenceError for a while). Warn
      // so a broken WebGL layer is visible in the console instead of invisible.
      console.warn('[glass] WebGL layer disabled:', err);
    });
});
