// Runs before the app bundle so the page never flashes the wrong theme (SPEC-0001 CA-60).
(() => {
  try {
    const root = document.documentElement;
    const theme = localStorage.getItem('nephoscope.theme') || 'system';
    const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    root.dataset.theme = dark ? 'dark' : 'light';
    const density = localStorage.getItem('nephoscope.density');
    if (density === 'compact' || density === 'comfortable' || density === 'default') root.dataset.density = density;
  } catch {
    /* Storage can be unavailable; the defaults in index.html apply. */
  }
})();
