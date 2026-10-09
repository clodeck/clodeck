/* PROTOTYPE — Variant B: "Three-pane workspace" (IDE).
   Top bar ▸ [explorer | chat | terminal-over-preview] ▸ status bar.
   All four surfaces are visible at once; nothing is summoned.
   Hierarchy: panes are peers; the project switcher is a control in the chrome. */
window.VARIANTS = window.VARIANTS || {};
window.VARIANTS.B = {
  key: 'B',
  name: 'Three-pane workspace (IDE)',
  mount(root) {
    const P = window.PW.parts;
    const h = P.h, icon = P.icon;

    let projectId = P.project(window.STATE.projectId || 'claude-ui').id;
    let sessionId = P.project(projectId).sessions[0].id;
    let openFile = null;
    let leftW = 232, rightW = 348;

    const shell = h('div', { style: 'display:grid;grid-template-columns:1fr;grid-template-rows:44px 1fr 24px;height:100%;overflow:hidden' });

    /* ── top bar ──────────────────────────────────────────────────────── */
    const projBtn = h('button', { class: 'icon-btn', style: 'width:auto;height:30px;padding:0 9px;gap:7px;display:flex;background:var(--bg-2);border:1px solid var(--line-2)' },
      icon('folder'), h('span', { class: 'title truncate', style: 'max-width:180px' }, ''), h('span', { html: P.ICONS.down }));
    projBtn.lastChild.firstChild.style.cssText = 'width:13px;height:13px;color:var(--fg-3)';
    const tabs = h('div', { class: 'sess-tabs' });
    const popup = h('div', {
      style: 'position:absolute;top:44px;left:76px;z-index:40;display:none;width:290px;background:var(--bg-2);border:1px solid var(--line-2);border-radius:10px;box-shadow:0 18px 40px rgba(0,0,0,.5);padding:6px'
    });
    projBtn.onclick = (e) => { e.stopPropagation(); popup.style.display = popup.style.display === 'block' ? 'none' : 'block'; };
    document.addEventListener('mousedown', () => { popup.style.display = 'none'; });

    const topbar = h('div', { class: 'topbar' },
      h('div', { class: 'brand', html: P.ICONS.logo, title: 'Clodeck' }),
      h('div', { style: 'position:relative' }, projBtn, popup),
      h('div', { style: 'width:1px;height:22px;background:var(--line)' }),
      tabs,
      h('button', { class: 'icon-btn', title: 'New session (mock)', html: P.ICONS.plus }),
      h('div', { class: 'spacer', style: 'flex:1' }),
      h('button', { class: 'icon-btn', title: 'Search (mock)', html: P.ICONS.search }),
      h('button', { class: 'icon-btn', title: 'Settings (mock)', html: P.ICONS.gear }),
      h('div', { class: 'avatar', style: 'border-radius:50%' }, window.MOCK.user[0].toUpperCase()));

    function renderTopbar() {
      const pr = P.project(projectId);
      projBtn.querySelector('.title').textContent = pr.name;
      popup.innerHTML = '';
      popup.append(h('div', { class: 'panel-head', style: 'border:0;background:none;height:26px' }, 'Switch project'));
      window.MOCK.projects.forEach((p) => {
        const it = h('button', { class: 'proj-item' + (p.id === projectId ? ' on' : '') },
          icon('folder'), h('span', { class: 'grow' }, h('div', { class: 'truncate' }, p.name), h('div', { class: 'sub truncate' }, p.path)),
          p.sessions.some((s) => s.live) ? h('span', { class: 'dot live' }) : null);
        it.onclick = () => { projectId = p.id; sessionId = p.sessions[0].id; openFile = null; renderAll(); };
        popup.append(it);
      });
      tabs.innerHTML = '';
      pr.sessions.forEach((s) => {
        const t = h('button', { class: 'sess-tab' + (s.id === sessionId ? ' on' : '') },
          h('span', { class: 'dot' + (s.live ? ' live' : ' idle') }),
          h('span', { class: 'truncate', style: 'max-width:190px' }, s.title),
          s.id === sessionId ? h('button', { class: 'icon-btn', style: 'width:18px;height:18px', html: P.ICONS.x }) : null);
        t.onclick = () => { sessionId = s.id; renderAll(); };
        tabs.append(t);
      });
    }

    /* ── left: explorer ───────────────────────────────────────────────── */
    const leftHost = h('div', { style: 'flex:1;min-height:0;display:flex;flex-direction:column' });
    const left = h('div', { style: 'display:flex;flex-direction:column;min-height:0;background:var(--bg-1)' },
      h('div', { class: 'panel-head', style: 'border-left:0;border-right:0;border-top:0' }, 'Explorer', h('span', { class: 'spacer' })),
      leftHost);

    /* ── centre: chat ─────────────────────────────────────────────────── */
    const centreHost = h('div', { style: 'flex:1;min-height:0;display:flex' });
    const centre = h('div', { style: 'flex:1;min-width:0;display:flex;flex-direction:column;min-height:0;background:var(--bg)' },
      h('div', { style: 'height:32px;flex:none;display:flex;align-items:center;gap:8px;padding:0 14px;border-bottom:1px solid var(--line);font-size:12px;color:var(--fg-3)' },
        h('span', { html: P.ICONS.chat, style: 'width:13px;display:block' }),
        h('span', { class: 'mono truncate' }, ''), h('span', { class: 'spacer', style: 'flex:1' }),
        h('span', { class: 'chip' }, 'sonnet-5')),
      centreHost);

    /* ── right: terminal over preview ─────────────────────────────────── */
    const termHost = h('div', { style: 'flex:1;min-height:0;display:flex;flex-direction:column' });
    const previewHead = h('span', { class: 'mono', style: 'text-transform:none;letter-spacing:0;color:var(--fg-2)' }, 'no file selected');
    const previewHost = h('div', { style: 'flex:1;min-height:0;display:flex;flex-direction:column' });
    let code = null, term = null, tree = null;
    const right = h('div', { style: 'display:flex;flex-direction:column;min-height:0;background:var(--bg-1)' },
      h('div', { style: 'flex:1.15;min-height:0;display:flex;flex-direction:column;border-bottom:1px solid var(--line-2)' },
        h('div', { class: 'panel-head' }, icon('terminal'), 'Terminal',
          h('span', { class: 'spacer' }),
          h('span', { class: 'chip' }, 'pty')),
        termHost),
      h('div', { style: 'flex:1;min-height:0;display:flex;flex-direction:column' },
        h('div', { class: 'panel-head' }, icon('eye'), previewHead,
          h('span', { class: 'spacer' }), h('span', { class: 'chip' }, icon('lock'), 'read-only')),
        previewHost));

    /* ── status bar ───────────────────────────────────────────────────── */
    function statusBar() {
      const pr = P.project(projectId);
      return h('div', {
        style: 'display:flex;align-items:center;gap:12px;padding:0 12px;background:var(--bg-1);border-top:1px solid var(--line);font:11px var(--mono);color:var(--fg-3)'
      },
        h('span', { class: 'row', style: 'gap:5px' }, icon('branch'), pr.branch),
        pr.dirty ? h('span', { style: 'color:var(--warn)' }, pr.dirty + ' changed') : h('span', {}, 'clean'),
        h('span', { class: 'spacer', style: 'flex:1' }),
        h('span', {}, pr.path),
        h('span', {}, 'session ' + sessionId.slice(0, 8)),
        h('span', { class: 'row', style: 'gap:5px;color:var(--ok)' }, h('span', { class: 'dot' }), 'agent idle'));
    }

    /* ── resizers ─────────────────────────────────────────────────────── */
    function grip(onDrag) {
      const g = h('div', { style: 'width:5px;flex:none;cursor:col-resize;background:transparent' });
      g.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const move = (ev) => onDrag(ev);
        const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.style.cursor = ''; };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
        document.body.style.cursor = 'col-resize';
      });
      return g;
    }
    const gripL = grip((ev) => { leftW = Math.max(150, Math.min(420, ev.clientX - 0)); left.style.width = leftW + 'px'; });
    const gripR = grip((ev) => { rightW = Math.max(240, Math.min(640, window.innerWidth - ev.clientX)); right.style.width = rightW + 'px'; });

    const content = h('div', { style: 'display:flex;min-height:0;overflow:hidden' }, left, gripL, centre, gripR, right);

    let statusEl = statusBar();

    function renderAll() {
      const pr = P.project(projectId);
      const s = pr.sessions.find((x) => x.id === sessionId) || pr.sessions[0];
      left.style.width = leftW + 'px';
      right.style.width = rightW + 'px';
      renderTopbar();

      tree = P.FileTree({ projectId, onOpen: (p) => { openFile = p; code.show(p); } });
      leftHost.innerHTML = ''; leftHost.append(tree.el);
      if (openFile) tree.setOn(openFile);

      centreHost.innerHTML = '';
      centreHost.append(P.ChatPane({ project: pr, session: s }).el);
      centre.querySelector('.mono').textContent = s.title;

      termHost.innerHTML = '';
      term = P.TerminalPane({ projectId });
      termHost.append(term.el);

      code = P.CodeView({ projectId });
      code.setHead(previewHead);
      previewHost.innerHTML = ''; previewHost.append(code.el);
      if (openFile) code.show(openFile);

      const next = statusBar();
      statusEl.replaceWith(next); statusEl = next;

      window.STATE.projectId = projectId;
      window.STATE.sessionId = sessionId;
      window.PW.render && window.PW.render();
    }

    shell.append(topbar, content, statusEl);
    root.append(shell);
    renderAll();
    // if the window shrinks, keep the right pane from swallowing the middle
    window.addEventListener('resize', () => { rightW = Math.min(rightW, Math.max(240, window.innerWidth - 520)); right.style.width = rightW + 'px'; });
  },
};
