/**
 * Scroll effects, wired once for the whole app:
 * - anything with `.reveal` slides in when it scrolls into view (stagger with `--i`);
 * - anything with `.spin-on-scroll` gets `--scroll` (its distance through the screen, -1…1) so CSS can
 *   turn or shift it as the page moves.
 * Nothing is hidden unless this runs (`html.js-reveal`), and "reduce motion" turns the movement off in CSS.
 */
export function watchScrollEffects(root: HTMLElement = document.body) {
  if (typeof IntersectionObserver === 'undefined') return;
  document.documentElement.classList.add('js-reveal');

  const seen = new WeakSet<Element>();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });

  const spinners = new Set<HTMLElement>();
  let frame = 0;
  const updateSpin = () => {
    frame = 0;
    const h = window.innerHeight || 1;
    spinners.forEach((el) => {
      if (!el.isConnected) { spinners.delete(el); return; }
      const r = el.getBoundingClientRect();
      const p = Math.max(-1, Math.min(1, (r.top + r.height / 2 - h / 2) / (h / 2)));
      el.style.setProperty('--scroll', p.toFixed(3));
    });
  };
  const queueSpin = () => { if (!frame) frame = requestAnimationFrame(updateSpin); };
  // Scrolling happens on the page or inside sheets/modals, so listen everywhere
  document.addEventListener('scroll', queueSpin, { passive: true, capture: true });
  window.addEventListener('resize', queueSpin, { passive: true });

  // Safety net: never leave something on screen hidden if the observer is slow to report
  const showVisible = () => {
    const h = window.innerHeight;
    root.querySelectorAll('.reveal:not(.in)').forEach((el) => { const r = el.getBoundingClientRect(); if (r.bottom > 0 && r.top < h) el.classList.add('in'); });
  };
  let safety = 0;

  const scan = () => {
    root.querySelectorAll('.reveal').forEach((el) => { if (!seen.has(el)) { seen.add(el); io.observe(el); } });
    window.clearTimeout(safety);
    safety = window.setTimeout(showVisible, 1500);
    root.querySelectorAll<HTMLElement>('.spin-on-scroll').forEach((el) => spinners.add(el));
    queueSpin();
  };
  let queued = false;
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; scan(); }); } })
    .observe(root, { childList: true, subtree: true });
  scan();
}
