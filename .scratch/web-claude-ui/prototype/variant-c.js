/* PROTOTYPE — Variant C: "Project command deck".
   Header ▸ project strip (big switcher cards) ▸ grid of panels ▸ session strip.
   Everything is a card, every card keeps its own chrome; the project is the
   primary object and chat is just the biggest card.
   Hierarchy: project first, then panels; nothing is hidden behind a toggle. */
window.VARIANTS = window.VARIANTS || {};
window.VARIANTS.C = {
  key: 'C',
  name: 'Project command deck (panel grid)',
  mount(root) {
    const P = window.PW.parts;
    const h = P.h, icon = P.icon;

    let projectId = P.project(window.STATE.projectId || 'claude-ui').id;
    let sessionId = P.project(projectId).sessions[0].id;
    let openFile = null;

    const shell = h('div', { style: 'display:flex;flex-direction:column;height:100%;min-height:0;background:var(--bg)' });

    /* ── header ───────────────────────────────────────────────────────── */
    const header = h('div', { class: 'topbar', style: 'height:48px;background:var(--bg)' },
      h('div', { class: 'brand', html: P.ICONS.logo, title: 'Clodeck' }),
      h('div', { class: 'title' }, 'Clodeck'),
      h('div', { class: 'spacer', style: 'flex:1' }),
      h('button', { class: 'icon-btn', style: 'width:auto;height:30px;padding:0 10px;gap:8px;display:flex;background:var(--bg-2);border:1px solid var(--line)' },
        icon('search'), h('span', { style: 'font-size:12px;color:var(--fg-3)' }, 'Jump to project…'),
        h('span', { class: 'chip', style: 'margin-left:14px' }, '⌘K')),
      h('span', { class: 'row', style: 'gap:7px;color:var(--fg-2);font-size:12px' },
        h('span', { class: 'dot live' }), 'API key', h('div', { class: 'avatar', style: 'border-radius:50%' }, window.MOCK.user[0].toUpperCase())));

    /* ── project strip ────────────────────────────────────────────────── */
    const strip = h('div', { style: 'display:flex;gap:10px;padding:0 12px 12px;overflow-x:auto;flex:none' });

    function renderStrip() {
      strip.innerHTML = '';
      window.MOCK.projects.forEach((p) => {
        const on = p.id === projectId;
        const live = p.sessions.filter((s) => s.live).length;
        const card = h('button', {
          style: 'flex:none;width:236px;text-align:left;padding:10px 12px;border-radius:10px;background:' + (on ? 'var(--bg-3)' : 'var(--bg-1)') +
            ';border:1px solid ' + (on ? 'var(--accent)' : 'var(--line)') + ';display:flex;flex-direction:column;gap:6px'
        },
          h('div', { class: 'row', style: 'gap:8px' },
            h('span', { html: on ? P.ICONS.logo : P.ICONS.folder, style: 'width:14px;color:' + (on ? 'var(--accent-2)' : 'var(--fg-3)') }),
            h('span', { class: 'title truncate grow' }, p.name),
            live ? h('span', { class: 'chip accent' }, live + ' live') : null),
          h('div', { class: 'mono truncate', style: 'font-size:11px;color:var(--fg-3)' }, p.path),
          h('div', { class: 'row', style: 'gap:6px;color:var(--fg-3);font-size:11px' },
            icon('branch'), h('span', { class: 'mono' }, p.branch),
            h('span', { class: 'grow' }),
            h('span', {}, p.sessions.length + ' sessions'),
            p.dirty ? h('span', { style: 'color:var(--warn)' }, '●' + p.dirty) : null));
        card.onclick = () => { projectId = p.id; sessionId = p.sessions[0].id; openFile = null; renderAll(); };
        strip.append(card);
      });
      strip.append(h('button', {
        style: 'flex:none;width:56px;border:1px dashed var(--line-2);border-radius:10px;color:var(--fg-3);display:grid;place-items:center',
        title: 'Add project (mock)'
      }, h('span', { html: P.ICONS.plus })));
    }

    /* ── panel grid ───────────────────────────────────────────────────── */
    const grid = h('div', {
      style: 'flex:1;min-height:0;display:grid;grid-template-columns:1fr 400px;grid-template-rows:1fr 1fr;gap:10px;padding:0 12px'
    });

    const chatCard = h('div', { class: 'panel', style: 'grid-column:1;grid-row:1 / span 2;display:flex;flex-direction:column;min-height:0' });
    const termCard = h('div', { class: 'panel', style: 'grid-column:2;grid-row:1;display:flex;flex-direction:column;min-height:0' });
    const fileCard = h('div', { class: 'panel', style: 'grid-column:2;grid-row:2;display:flex;flex-direction:column;min-height:0' });
    grid.append(chatCard, termCard, fileCard);

    /* ── session strip ────────────────────────────────────────────────── */
    const sessStrip = h('div', { style: 'display:flex;gap:10px;padding:12px;overflow-x:auto;flex:none' });

    function renderSessions() {
      const pr = P.project(projectId);
      sessStrip.innerHTML = '';
      sessStrip.append(h('div', {
        style: 'flex:none;width:150px;display:flex;flex-direction:column;justify-content:center;gap:2px'
      }, h('div', { style: 'font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--fg-3)' }, 'Sessions'),
         h('div', { class: 'muted', style: 'font-size:12px' }, pr.sessions.length + ' in ' + pr.name)));
      pr.sessions.forEach((s) => {
        const on = s.id === sessionId;
        const card = h('button', {
          style: 'flex:none;width:250px;text-align:left;padding:10px 12px;border-radius:10px;background:' + (on ? 'var(--bg-3)' : 'var(--bg-1)') +
            ';border:1px solid ' + (on ? 'var(--line-2)' : 'var(--line)') + ';display:flex;flex-direction:column;gap:5px'
        },
          h('div', { class: 'row', style: 'gap:7px' },
            h('span', { class: 'dot' + (s.live ? ' live' : ' idle') }),
            h('span', { class: 'truncate grow', style: 'font-size:13px;color:' + (on ? 'var(--fg)' : 'var(--fg-2)') }, s.title)),
          h('div', { class: 'mono', style: 'font-size:10.5px;color:var(--fg-3)' }, s.id.slice(0, 18) + '…'),
          h('div', { class: 'row', style: 'gap:6px;font-size:11px;color:var(--fg-3)' },
            h('span', {}, s.updated), h('span', { class: 'grow' }),
            h('span', { class: 'chip', style: on ? '' : 'opacity:.6' }, on ? 'open' : 'resume')));
        card.onclick = () => { sessionId = s.id; renderAll(); };
        sessStrip.append(card);
      });
      sessStrip.append(h('button', {
        style: 'flex:none;width:64px;border:1px dashed var(--line-2);border-radius:10px;color:var(--fg-3);display:grid;place-items:center',
        title: 'New session (mock)'
      }, h('span', { html: P.ICONS.plus })));
    }

    /* ── fill the panels ──────────────────────────────────────────────── */
    let code = null;
    const previewHead = h('span', { class: 'mono', style: 'text-transform:none;letter-spacing:0;color:var(--fg-2)' }, 'no file');

    function renderPanels() {
      const pr = P.project(projectId);
      const s = pr.sessions.find((x) => x.id === sessionId) || pr.sessions[0];

      chatCard.innerHTML = '';
      chatCard.append(
        h('div', { class: 'panel-head' }, icon('chat'), 'Chat',
          h('span', { class: 'spacer' }),
          h('span', { class: 'mono truncate', style: 'text-transform:none;letter-spacing:0;max-width:280px;color:var(--fg-2)' }, s.title),
          h('span', { class: 'chip' }, s.id.slice(0, 8))),
        P.ChatPane({ project: pr, session: s }).el);

      termCard.innerHTML = '';
      const term = P.TerminalPane({ projectId });
      termCard.append(
        h('div', { class: 'panel-head' }, icon('terminal'), 'Terminal',
          h('span', { class: 'spacer' }),
          h('span', { class: 'mono truncate', style: 'text-transform:none;letter-spacing:0' }, pr.path)),
        term.el);

      code = P.CodeView({ projectId });
      code.setHead(previewHead);
      const tree = P.FileTree({ projectId, onOpen: (p) => { openFile = p; code.show(p); tree.setOn(p); } });
      if (openFile) { code.show(openFile); tree.setOn(openFile); }
      fileCard.innerHTML = '';
      fileCard.append(
        h('div', { class: 'panel-head' }, icon('eye'), 'File', previewHead,
          h('span', { class: 'spacer' }), h('span', { class: 'chip' }, icon('lock'), 'read-only')),
        h('div', { style: 'display:flex;min-height:0;flex:1' },
          h('div', { style: 'width:190px;flex:none;display:flex;flex-direction:column;min-height:0' }, tree.el),
          h('div', { style: 'flex:1;min-width:0;display:flex;flex-direction:column;min-height:0;border-left:1px solid var(--line)' }, code.el)));
    }

    function renderAll() {
      renderStrip(); renderPanels(); renderSessions();
      window.STATE.projectId = projectId;
      window.STATE.sessionId = sessionId;
      window.PW.render && window.PW.render();
    }

    shell.append(header, strip, grid, sessStrip);
    root.append(shell);
    renderAll();
  },
};
