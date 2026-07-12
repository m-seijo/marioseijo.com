// chrome.js — shared page chrome used by both routes: the theme toggle and the
// auto-updating copyright year. Kept tiny and dependency-free.

export function initChrome() {
  // Theme toggle. Tokens redefine under [data-theme]; the toggle flips relative
  // to the OS preference so the first click always visibly changes something.
  const btn = document.getElementById('theme');
  if (btn) {
    btn.addEventListener('click', () => {
      const root = document.documentElement;
      const cur = root.getAttribute('data-theme');
      const prefersDark = window.matchMedia('(prefers-color-scheme:dark)').matches;
      root.setAttribute('data-theme', cur ? (cur === 'dark' ? 'light' : 'dark') : (prefersDark ? 'light' : 'dark'));
    });
  }

  // Auto-updating END year of the copyright range. 2009 — the year
  // of first publication — is hard-coded in the HTML, which also ships a real
  // end year so the notice stays correct with JS off.
  const year = String(new Date().getFullYear());
  document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = year; });
}
