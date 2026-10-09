/* PROTOTYPE — Variant A: "Chat-first, tools on demand" (claudecodeui classic).
   Nav rail ▸ project + session sidebar ▸ chat takes the whole stage.
   Terminal and file viewer live in a bottom drawer you summon.
   Hierarchy: chat is the product; everything else is a tool you pull out. */
window.VARIANTS = window.VARIANTS || {};
window.VARIANTS.A = {
  key: 'A',
  name: 'Chat-first, tools on demand',
  mount(root) {
    const P = window.PW.parts;
    const h = P.h, icon = P.icon;

    let projectId = P.project(window.STATE.projectId || 'claude-ui').id;
    let sessionId = P.project(projectId).sessions[0].id;
    let drawerTab = null;              // null | 'terminal' | 'files'
    let openFile = null;

    const shell = h('div', { style: 'display:grid;grid-template-columns:52px 244px 1fr;grid-template-rows:1fr auto;height:100%' });

    /* ── rail ─────────────────────────────────────────────────────────── */
    const rail = h('div', { class: 'rail', style: 'grid-row:1 / span 2' },
      h('div', { class: 'brand', html: P.ICONS.logo, title: 'Clodeck' }));
    const btnChat = h('button', { class: 'icon-btn on', title: 'Chat', html: P.ICONS.chat });
    const btnTerm = h('button', { class: 'icon-btn', title: 'Terminal drawer', html: P.ICONS.terminal });
    const btnFiles = h('button', { class: 'icon-btn', title: 'Files drawer', html: P.ICONS.eye });
    const btnSearch = h('button', { class: 'icon-btn', title: 'Search (mock)', html: P.ICONS.search });
    rail.append(btnChat, btnTerm, btnFiles, btnSearch, h('div', { class: 'spacer' }),
      h('button', { class: 'icon-btn', title: 'Settings (mock)', html: P.ICONS.gear }));
    btnChat.onclick = () => setDrawer(null);
    btnTerm.onclick = () => setDrawer('terminal');
    btnFiles.onclick = () => setDrawer('files');

    /* ── sidebar: project switcher + sessions ─────────────────────────── */
    const sideHost = h('div');
    const sidebar = h('div', {
      style: 'grid-column:2;grid-row:1 / span 2;display:flex;flex-direction:column;min-height:0;background:var(--bg-1);border-right:1px solid var(--line)'
    },
      h('div', { class: 'panel-head' }, 'Projects', h('span', { class: 'spacer' }),
        h('button', { class: 'icon-btn', style: 'width:22px;height:22px', title: 'Add project (mock)', html: P.ICONS.plus })),
      sideHost);

    function renderSide() {
      const pr = P.project(projectId);
      const projects = P.ProjectList({ active: projectId, onSelect: (id) => { projectId = id; sessionId = P.project(id).sessions[0].id; openFile = null; renderAll(); } });
      const sessions = P.SessionList({ projectId, active: sessionId, onSelect: (id) => { sessionId = id; renderAll(); } });
      sideHost.innerHTML = '';
      sideHost.append(projects.el);
      sideHost.append(h('div', { class: 'panel-head', style: 'border-top:1px solid var(--line);border-bottom:1px solid var(--line)' },
        'Sessions · ' + pr.sessions.length, h('span', { class: 'spacer' }),
        h('button', { class: 'icon-btn', style: 'width:22px;height:22px', title: 'New session (mock)', html: P.ICONS.plus })));
      sideHost.append(sessions.el);
      sideHost.append(h('div', { style: 'padding:8px 10px;margin-top:auto;border-top:1px solid var(--line);display:flex;align-items:center;gap:8px;color:var(--fg-3);font-size:12px' },
        icon('user'), h('span', { class: 'truncate' }, window.MOCK.user), h('span', { class: 'grow' }), h('span', { class: 'chip' }, 'API key')));
    }

    /* ── stage: chat ──────────────────────────────────────────────────── */
    const stageHost = h('div', { style: 'flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden' });
    const main = h('div', { style: 'grid-column:3;grid-row:1;display:flex;flex-direction:column;min-height:0;background:var(--bg)' }, stageHost);

    function renderStage() {
      const pr = P.project(projectId);
      const s = pr.sessions.find((x) => x.id === sessionId) || pr.sessions[0];
      const head = h('div', { style: 'display:flex;align-items:center;gap:9px;height:44px;flex:none;padding:0 14px;border-bottom:1px solid var(--line);background:var(--bg-1)' },
        h('span', { class: 'title truncate' }, s.title),
        h('span', { class: 'chip' }, s.id.slice(0, 8)),
        h('span', { class: 'spacer', style: 'flex:1' }),
        h('span', { class: 'chip ghost' }, icon('branch'), pr.branch),
        pr.dirty ? h('span', { class: 'chip accent' }, pr.dirty + ' changed') : null,
        h('button', { class: 'icon-btn', title: 'Session actions (mock)', html: P.ICONS.dots }));
      stageHost.innerHTML = '';
      stageHost.append(head);
      stageHost.append(P.ChatPane({ project: pr, session: s }).el);
    }

    /* ── bottom drawer: terminal | files ──────────────────────────────── */
    const drawerHost = h('div', { style: 'flex:1;min-height:0' });
    const drawerTabs = h('div', { style: 'display:flex;gap:2px' });
    const drawerClose = h('button', { class: 'icon-btn', style: 'width:24px;height:24px', title: 'Close drawer', html: P.ICONS.x });
    drawerClose.onclick = () => setDrawer(null);
    const drawer = h('div', {
      style: 'grid-column:3;grid-row:2;display:none;flex-direction:column;height:42vh;min-height:0;background:var(--bg-1);border-top:1px solid var(--line-2)'
    },
      h('div', { class: 'panel-head' }, drawerTabs, h('span', { class: 'spacer' }), drawerClose),
      drawerHost);

    let termPane = null, tree = null, code = null, codeHead = null, fileDetails = null, dlBtn = null, pvBtn = null, editBtn = null;

    function downloadOpenFile() {
      const f = openFile && P.findFile(projectId, openFile);
      if (!f) return;
      const blob = new Blob([f.lines.join('\n')], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = f.name;
      document.body.append(a); a.click(); a.remove();
      URL.revokeObjectURL(a.href);
    }
    function syncEditBtn() {
      const editing = code.isEditing();
      editBtn.innerHTML = (editing ? P.ICONS.pencil : P.ICONS.lock) + (editing ? 'editable' : 'read-only');
      editBtn.classList.toggle('accent', editing);
      editBtn.title = editing ? 'Switch to read-only' : 'Switch to editable';
    }
    function renderFileHead() {
      const f = openFile && P.findFile(projectId, openFile);
      if (!f) { fileDetails.textContent = ''; dlBtn.style.display = 'none'; pvBtn.style.display = 'none'; editBtn.style.display = 'none'; return; }
      const m = P.fileMeta(f);
      fileDetails.textContent = m.size + ' · ' + m.modified + ' · ' + m.perm;
      dlBtn.style.display = '';
      pvBtn.style.display = f.lang === 'md' ? '' : 'none';
      pvBtn.textContent = code.previewOn() ? 'Source' : 'Preview';
      editBtn.style.display = '';
      syncEditBtn();
    }
    function buildFilesPane() {
      tree = P.FileTree({
        projectId, toolbar: true,
        onOpen: (p) => { openFile = p; code.show(p); renderFileHead(); },
        onRename: (oldPath, newPath, isDir) => {
          if (isDir) { if (openFile === oldPath || (openFile && openFile.startsWith(oldPath + '/'))) { openFile = null; code.show(null); renderFileHead(); } }
          else if (openFile === oldPath) { openFile = newPath; code.show(newPath); renderFileHead(); }
        },
        onDelete: (path, isDir) => {
          if (isDir ? (openFile === path || (openFile && openFile.startsWith(path + '/'))) : (openFile === path)) { openFile = null; code.show(null); renderFileHead(); }
        },
        onMove: (srcPath, destDir) => {
          if (openFile === srcPath) { const nm = srcPath.split('/').pop(); openFile = destDir ? destDir + '/' + nm : nm; code.show(openFile); renderFileHead(); }
        },
      });
      codeHead = h('span', { class: 'mono', style: 'text-transform:none;letter-spacing:0;color:var(--fg-2)' }, 'no file selected');
      fileDetails = h('span', { class: 'file-details' });
      dlBtn = h('button', { class: 'icon-btn', style: 'width:22px;height:22px;display:none', title: 'Download', html: P.ICONS.download });
      dlBtn.onclick = downloadOpenFile;
      pvBtn = h('button', { class: 'chip ghost', style: 'display:none;cursor:pointer;height:20px', title: 'Toggle markdown preview' }, 'Preview');
      pvBtn.onclick = () => { code.togglePreview(); pvBtn.textContent = code.previewOn() ? 'Source' : 'Preview'; };
      editBtn = h('button', { class: 'chip', style: 'display:none;cursor:pointer;height:20px', html: P.ICONS.lock + 'read-only', title: 'Switch to editable' });
      editBtn.onclick = () => { code.toggleEdit(); syncEditBtn(); };
      code = P.CodeView({ projectId });
      code.setHead(codeHead);
      const right = h('div', { style: 'flex:1;display:flex;flex-direction:column;min-width:0;border-left:1px solid var(--line)' },
        h('div', { class: 'panel-head', style: 'background:var(--bg-1)' }, codeHead, fileDetails, h('span', { class: 'spacer' }),
          pvBtn, dlBtn, editBtn),
        code.el);
      return h('div', { style: 'display:flex;min-height:0;height:100%' },
        h('div', { style: 'width:300px;flex:none;display:flex;flex-direction:column;min-height:0' }, tree.el),
        right);
    }
    function buildTermPane() {
      termPane = P.TerminalPane({ projectId });
      return termPane.el;
    }

    function setDrawer(tab) {
      drawerTab = tab;
      btnTerm.classList.toggle('on', tab === 'terminal');
      btnFiles.classList.toggle('on', tab === 'files');
      btnChat.classList.toggle('on', tab === null);
      drawer.style.display = tab ? 'flex' : 'none';
      drawerTabs.innerHTML = '';
      if (!tab) return;
      [['terminal', 'Terminal', P.ICONS.terminal], ['files', 'Files · read-only', P.ICONS.eye]].forEach(([k, label, ic]) => {
        const b = h('button', { class: 'icon-btn', style: 'width:auto;height:24px;padding:0 9px;gap:6px;display:flex;font-size:12px;text-transform:none;letter-spacing:0' + (tab === k ? ';background:var(--bg-3);color:var(--fg)' : '') },
          h('span', { html: ic }), h('span', {}, label));
        b.firstChild.firstChild.style.cssText = 'width:13px;height:13px';
        b.onclick = () => setDrawer(k);
        drawerTabs.append(b);
      });
      drawerHost.innerHTML = '';
      if (tab === 'terminal') { const el = buildTermPane(); drawerHost.append(el); termPane.focus(); }
      else { drawerHost.append(buildFilesPane()); if (openFile) { code.show(openFile); tree.setOn(openFile); renderFileHead(); } }
    }

    /* if the drawer is open and the project changes, rebuild its body */
    function refreshDrawer() {
      if (!drawerTab) return;
      drawerHost.innerHTML = '';
      if (drawerTab === 'terminal') { drawerHost.append(buildTermPane()); }
      else { drawerHost.append(buildFilesPane()); if (openFile) { code.show(openFile); tree.setOn(openFile); renderFileHead(); } }
    }

    function renderAll() {
      renderSide();
      renderStage();
      refreshDrawer();
      window.STATE.projectId = projectId;
      window.STATE.sessionId = sessionId;
      window.PW.render && window.PW.render();
    }

    renderSide(); renderStage();
    shell.append(rail, sidebar, main, drawer);
    root.append(shell);
    renderAll();
  },
};
