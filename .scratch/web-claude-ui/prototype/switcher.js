/* PROTOTYPE switcher — the floating bar is NOT part of the design being judged.
   Cycles the three variants, keeps the choice in the URL, and mirrors the live
   state (project / session) so you can see it survive a variant switch. */
(function () {
  'use strict';
  const ORDER = ['A', 'B', 'C'];
  const root = document.getElementById('app');

  /* The hash wins when present: replaceState throws on file://, so that is
     where the fallback write lands, and a stale ?variant= must not pin us. */
  function readVariant() {
    const hash = new URLSearchParams(location.hash.replace(/^#/, '')).get('variant');
    const q = new URLSearchParams(location.search).get('variant');
    const v = String(hash || q || 'A').toUpperCase();
    return ORDER.includes(v) ? v : 'A';
  }
  function writeVariant(v) {
    try {
      history.replaceState(null, '', location.pathname + '?variant=' + v);
    } catch (e) {
      location.hash = 'variant=' + v;   // file:// blocks replaceState
    }
  }

  let variant = readVariant();

  /* ── the bar ─────────────────────────────────────────────────────────── */
  const label = document.createElement('span');
  const state = document.createElement('span');
  state.className = 'st';
  const prev = document.createElement('button');
  const next = document.createElement('button');
  prev.innerHTML = '&#9664;';
  next.innerHTML = '&#9654;';
  prev.title = 'Previous variant (←)';
  next.title = 'Next variant (→)';
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = 'prototype';
  tag.title = 'Throwaway — see .scratch/web-claude-ui/issues/03-visual-prototype.md';

  const bar = document.createElement('div');
  bar.className = 'pw';
  bar.append(prev, label, next, tag, state);
  document.body.append(bar);

  function paint() {
    const v = window.VARIANTS[variant];
    label.innerHTML = '';
    const b = document.createElement('b');
    b.textContent = variant;
    label.append(b, document.createTextNode(' ' + v.name));
    const p = window.STATE.projectId || '—';
    const s = (window.STATE.sessionId || '').slice(0, 8) || '—';
    state.textContent = 'project ' + p + ' · session ' + s;
    document.documentElement.dataset.variant = variant;
    document.title = 'PROTOTYPE · ' + variant + ' — ' + v.name;
  }

  function render() {
    root.innerHTML = '';
    window.VARIANTS[variant].mount(root);
    paint();
  }

  function go(dir) {
    const i = (ORDER.indexOf(variant) + dir + ORDER.length) % ORDER.length;
    variant = ORDER[i];
    writeVariant(variant);
    render();
  }
  prev.onclick = () => go(-1);
  next.onclick = () => go(1);

  /* variants call this when their own state changes (project / session) */
  window.PW.render = paint;

  /* ← / → cycle, unless you are typing */
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    if (e.key === '1' || e.key === '2' || e.key === '3') {
      const v = ORDER[Number(e.key) - 1];
      if (v && v !== variant) { e.preventDefault(); variant = v; writeVariant(v); render(); }
    }
  });

  window.addEventListener('hashchange', () => {
    const v = readVariant();
    if (v !== variant) { variant = v; render(); }
  });

  render();
  console.log('[PROTOTYPE] variants: ' + ORDER.join(', ') + ' — cycle with ← → or the bar; ?variant=A|B|C');
})();
