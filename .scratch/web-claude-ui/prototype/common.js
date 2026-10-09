/* PROTOTYPE shared widgets — throwaway.
   The three variants differ in LAYOUT; these components (chat, terminal, file
   tree, code view) are deliberately shared so the comparison stays about
   structure. Everything is in-memory and fake. */
(function () {
  'use strict';

  const M = window.MOCK;

  /* ── tiny DOM helpers ─────────────────────────────────────────────────── */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const k in (props || {})) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'style') el.setAttribute('style', v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(kid));
    }
    return el;
  }
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const svg = (d, extra = '') => '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + d + extra + '</svg>';

  const ICONS = {
    logo:     svg('<path d="M12 2.5 21.5 12 12 21.5 2.5 12z" fill="currentColor" stroke="none"/>'),
    folder:   svg('<path d="M3 7a2 2 0 0 1 2-2h3.6l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    file:     svg('<path d="M6.5 3h7l5 5v12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M13.5 3v5h5"/>'),
    terminal: svg('<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="m7 10 3 2-3 2M13 14.5h4"/>'),
    chat:     svg('<path d="M21 12a8 8 0 0 1-8 8H7l-4 2.5L4 17.5A8 8 0 1 1 21 12z"/>'),
    gear:     svg('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1"/>'),
    search:   svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
    branch:   svg('<line x1="7" y1="6" x2="7" y2="18"/><circle cx="18" cy="6.5" r="2.5"/><circle cx="7" cy="19" r="2.5"/><path d="M18 9a9 9 0 0 1-9 9"/>'),
    plus:     svg('<path d="M12 5v14M5 12h14"/>'),
    send:     svg('<path d="M4.5 12 20 4.5l-7 15-1.8-6.2z"/>'),
    down:     svg('<path d="m6 9.5 6 6 6-6"/>'),
    right:    svg('<path d="m9.5 6 6 6-6 6"/>'),
    x:        svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
    eye:      svg('<path d="M2.5 12S6.5 5.5 12 5.5 21.5 12 21.5 12 17.5 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
    lock:     svg('<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>'),
    grid:     svg('<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>'),
    dots:     svg('<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>'),
    user:     svg('<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>'),
    upload:   svg('<path d="M12 15V4.5M7.5 8.5 12 4l4.5 4.5"/><path d="M4.5 15.5v3a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-3"/>'),
    download: svg('<path d="M12 4.5V15M7.5 11.5 12 16l4.5-4.5"/><path d="M4.5 15.5v3a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-3"/>'),
    refresh:  svg('<path d="M4.5 12a7.5 7.5 0 0 1 13.6-4.3M19.5 12a7.5 7.5 0 0 1-13.6 4.3"/><path d="M18.5 4.2v3.6h-3.6M5.5 19.8v-3.6h3.6"/>'),
    list:     svg('<path d="M9.5 6.5H20M9.5 12H20M9.5 17.5H20"/><path d="M4 6.5h.01M4 12h.01M4 17.5h.01"/>'),
    filePlus: svg('<path d="M6.5 3h7l5 5v12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M13.5 3v5h5M12 12v5M9.5 14.5h5"/>'),
    folderPlus: svg('<path d="M3 7a2 2 0 0 1 2-2h3.6l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10.5v5M9.5 13h5"/>'),
    pencil:   svg('<path d="M4.5 19.5h4l10.5-10.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4.5 15.5z"/><path d="m13.5 6.5 3 3"/>'),
  };
  const icon = (n) => h('span', { class: 'ic', html: ICONS[n] || ICONS.file }).firstChild;

  /* state shown in the prototype bar */
  window.STATE = window.STATE || { variant: 'A', projectId: null, sessionId: null };
  window.PW = window.PW || {};

  /* ── mock data access ─────────────────────────────────────────────────── */
  const project = (id) => M.projects.find((p) => p.id === id) || M.projects[0];
  const fileTree = (id) => M.files[id] || [];
  const flatten = (nodes, out = [], prefix = '') => {
    for (const n of nodes) {
      const path = prefix ? prefix + '/' + n.name : n.name;
      if (n.type === 'dir') flatten(n.children || [], out, path);
      else out.push({ ...n, path });
    }
    return out;
  };
  const findFile = (id, path) => flatten(fileTree(id)).find((f) => f.path === path);

  /* derived file metadata — deterministic, so the drawer reads as real but stays fake */
  const PERMS = ['644', '755', '664', '600'];
  function langFor(name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    return { ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', json: 'json', md: 'md',
      css: 'css', html: 'html', sh: 'sh', py: 'py', yml: 'yml', yaml: 'yml' }[ext] || 'ts';
  }
  function fileMeta(f) {
    const key = f.path || f.name || '';
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    const bytes = (f.lines || []).join('\n').length;
    const size = bytes >= 1024 ? (bytes / 1024).toFixed(1) + ' KB' : bytes + ' B';
    const perm = PERMS[h % PERMS.length];
    const rel = ['2m ago', '38m ago', '1h ago', '3h ago', 'yesterday', '2d ago', '5d ago', '2w ago', 'last month'][h % 9];
    return { size, perm, modified: rel };
  }

  /* ── syntax colouring (rough, on purpose) ─────────────────────────────── */
  const KW = 'const|let|var|function|return|if|else|for|of|in|await|async|new|class|import|from|export|default|type|interface|extends|implements|try|catch|throw|typeof|null|true|false|undefined|this|as|void|describe|it|expect';
  function highlight(line, lang) {
    let s = esc(line);
    if (lang === 'md') {
      s = s.replace(/^(#{1,6} .*)$/, '<span class="c-kw">$1</span>');
      s = s.replace(/(\*\*[^*]+\*\*)/g, '<span class="c-str">$1</span>');
      s = s.replace(/^(&gt; .*)$/, '<span class="c-com">$1</span>');
      return s;
    }
    const RE = new RegExp(
      '(\\/\\/.*$)' +                                        // comment
      '|(`[^`]*`|\'[^\']*\'|"[^"]*")' +                      // string
      '|\\b(' + KW + ')\\b' +                                 // keyword
      '|\\b(\\d+(?:\\.\\d+)?)\\b', 'g');                      // number
    return s.replace(RE, (m, com, str, kw, num) => {
      if (com) return '<span class="c-com">' + m + '</span>';
      if (str) return '<span class="c-str">' + m + '</span>';
      if (kw) return '<span class="c-kw">' + m + '</span>';
      if (num) return '<span class="c-num">' + m + '</span>';
      return m;
    });
  }

  /* ── minimal markdown → HTML (escape first, then transform) ───────────── */
  function renderMarkdown(raw) {
    const lines = esc(String(raw)).split('\n');
    const out = [];
    let list = null;
    const closeList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
    const inline = (t) => t
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
    let i = 0;
    while (i < lines.length) {
      const ln = lines[i];
      const h = ln.match(/^(#{1,6})\s+(.*)$/);
      if (h) { closeList(); out.push('<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>'); i++; continue; }
      if (/^\s*```/.test(ln)) {
        closeList(); i++;
        const buf = [];
        while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        out.push('<pre><code>' + buf.join('\n') + '</code></pre>');
        continue;
      }
      if (/^\s*(---+|\*\*\*+)\s*$/.test(ln)) { closeList(); out.push('<hr>'); i++; continue; }
      if (/^\s*>\s?/.test(ln)) {
        closeList();
        const buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(inline(lines[i].replace(/^\s*>\s?/, ''))); i++; }
        out.push('<blockquote>' + buf.join('<br>') + '</blockquote>');
        continue;
      }
      const ul = ln.match(/^\s*[-*]\s+(.*)$/);
      const ol = ln.match(/^\s*\d+\.\s+(.*)$/);
      if (ul || ol) {
        const kind = ul ? 'ul' : 'ol';
        if (list !== kind) { closeList(); out.push('<' + kind + '>'); list = kind; }
        out.push('<li>' + inline((ul || ol)[1]) + '</li>');
        i++; continue;
      }
      if (ln.trim() === '') { closeList(); i++; continue; }
      closeList();
      const buf = [inline(ln)];
      while (i + 1 < lines.length && lines[i + 1].trim() !== '' &&
             !/^(#{1,6}\s|>\s?|[-*]\s|\d+\.\s|\s*```)/.test(lines[i + 1])) {
        i++; buf.push(inline(lines[i]));
      }
      out.push('<p>' + buf.join('<br>') + '</p>');
      i++;
    }
    closeList();
    return out.join('\n');
  }

  /* ── chat: one turn ───────────────────────────────────────────────────── */
  function toolCard(t, opts) {
    opts = opts || {};
    const status = h('span', { class: 'badge-ok' });
    const card = h('div', { class: 'tool' },
      h('div', { class: 'tool-head', onclick: () => card.classList.toggle('collapsed') },
        h('span', { class: 'caret', html: ICONS.down }),
        h('span', { class: 'name' }, t.name),
        h('span', { class: 'arg truncate' }, t.arg),
        h('span', { class: 'grow' }),
        status),
      h('pre', { class: 'tool-body' }, t.out || ''));
    if (opts.running) {
      status.textContent = 'running…';
      status.className = 'chip';
      card.classList.add('collapsed');
      card._done = () => {
        card.classList.remove('collapsed');
        status.className = 'badge-ok';
        status.textContent = 'done';
      };
    } else {
      status.textContent = 'done';
    }
    return card;
  }

  function turnEl(msg) {
    if (msg.role === 'user') {
      return h('div', { class: 'turn turn-user' }, h('div', { class: 'bubble' }, msg.text));
    }
    const body = h('div', { class: 'body' }, h('div', { class: 'bubble' }, msg.text));
    (msg.tools || []).forEach((t) => body.append(toolCard(t)));
    return h('div', { class: 'turn turn-assistant' },
      h('div', { class: 'avatar', html: ICONS.logo }), body);
  }

  function scrollDown(scroller) {
    requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; });
  }

  /* ── chat pane (transcript + composer + simulated stream) ─────────────── */
  function ChatPane(opts) {
    const session = opts.session;
    const scroller = h('div', { class: 'transcript' });
    const inner = h('div', { class: 'transcript-inner' });
    scroller.append(inner);
    session.messages.forEach((m) => inner.append(turnEl(m)));

    const ta = h('textarea', {
      rows: 1, placeholder: 'Message ' + opts.project.name + '…',
      oninput: () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; send.disabled = !ta.value.trim(); },
      onkeydown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
        e.stopPropagation();   // keep arrow keys out of the variant switcher
      },
    });
    const send = h('button', { class: 'send', disabled: true, title: 'Send', html: ICONS.send });
    send.onclick = submit;
    const box = h('div', { class: 'composer-box' }, ta, send);
    const foot = h('div', { class: 'composer-foot' },
      h('span', { class: 'chip' }, 'sonnet-5'),
      h('span', { class: 'chip ghost' }, 'plan mode'),
      h('span', { class: 'grow' }),
      h('span', {}, 'Enter to send · Shift+Enter for a newline'));
    const composer = h('div', { class: 'composer' },
      h('div', { class: 'composer-inner' }, box, foot));

    let busy = false;
    async function submit() {
      const text = ta.value.trim();
      if (!text || busy) return;
      busy = true;
      ta.value = ''; ta.style.height = 'auto'; send.disabled = true;

      inner.append(turnEl({ role: 'user', text }));
      scrollDown(scroller);

      const bubble = h('div', { class: 'bubble' }, h('span', { class: 'cursor' }));
      const body = h('div', { class: 'body' }, bubble);
      const turn = h('div', { class: 'turn turn-assistant' },
        h('div', { class: 'avatar', html: ICONS.logo }), body);
      inner.append(turn);
      const cursor = bubble.querySelector('.cursor');
      scrollDown(scroller);

      await sleep(320);
      for (let i = 0; i < M.reply.length; i += 4) {
        cursor.before(M.reply.slice(i, i + 4));
        scrollDown(scroller);
        await sleep(9);
      }
      cursor.remove();

      for (const t of M.replyTools) {
        const card = toolCard(t, { running: true });
        body.append(card);
        scrollDown(scroller);
        await sleep(650);
        card._done();
        scrollDown(scroller);
      }
      busy = false;
    }

    const el = h('div', { class: 'chat' }, scroller, composer);
    el.style.cssText = 'display:flex;flex-direction:column;min-height:0;flex:1;height:100%';
    scrollDown(scroller);
    return { el, focus: () => ta.focus() };
  }

  /* ── terminal widget (fake shell) ─────────────────────────────────────── */
  function TerminalPane(opts) {
    const projectId = opts.projectId;
    const dir = project(projectId).path.replace('~/', '');
    const term = h('div', { class: 'term', tabindex: '0' });
    const body = h('div');
    term.append(body);

    function promptHtml() {
      return '<span class="p-user">' + M.user + '</span><span class="p-sym">@</span>' +
        '<span class="p-path">' + esc(dir.split('/').pop()) + '</span><span class="p-sym">:~$</span> ';
    }
    body.append(h('div', { class: 'dim', html: 'deck · prototype shell — not a real pty, nothing is executed' }));
    body.append(h('div', { class: 'dim', html: 'last login: today on ttys002' }));

    function newLine() {
      const line = h('div', { class: 'term-line', html: promptHtml() });
      const input = h('input', { class: 'term-input', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'terminal input' });
      line.append(input);
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') run(line, input.value);
      });
      body.append(line);
      scrollDown(term);
      return input;
    }

    function out(text, cls) {
      body.append(h('div', { class: 'term-line out ' + (cls || ''), html: esc(text).replace(/\n/g, '<br>') }));
      scrollDown(term);
    }

    function run(line, raw) {
      const cmd = raw.trim();
      line.innerHTML = promptHtml() + '<span>' + esc(raw) + '</span>';
      if (!cmd) return newLine().focus();
      const [bin, ...rest] = cmd.split(/\s+/);

      if (bin === 'clear') {
        body.innerHTML = '';
      } else if (bin === 'ls') {
        out(M.term.ls);
      } else if (bin === 'pwd') {
        out(M.term.pwd);
      } else if (bin === 'git') {
        if (rest[0] === 'log') out('f2a91c3  wip: transcript reducer\n6d06231  after handoff\n023edc7  math');
        else out('On branch ' + project(projectId).branch + '\n' +
                 (project(projectId).dirty ? 'Changes not staged for commit:\n  modified:   src/ChatPane.tsx\n  modified:   src/transcript.ts' : 'nothing to commit, working tree clean'));
      } else if (bin === 'npm' || bin === 'pnpm') {
        if (rest[0] === 'test') out('> vitest run\n\n ✓ src/transcript.test.ts (3)\n\n Test Files  1 passed (1)\n      Tests  3 passed (3)\n   Duration  412ms', '');
        else out('> vite\n\n  VITE v6.0.1  ready in 284 ms\n\n  ➜  Local:   http://localhost:5173/\n  ➜  press h + enter to show help');
      } else if (bin === 'cat') {
        const f = findFile(projectId, rest[0] || '');
        if (f) out(f.lines.join('\n'));
        else out('cat: ' + (rest[0] || '') + ': No such file or directory', 'err');
      } else if (M.term[bin]) {
        out(M.term[bin]);
      } else {
        out('bash: ' + bin + ': command not found', 'err');
      }
      newLine().focus();
    }

    const input = newLine();
    term.addEventListener('mousedown', (e) => {
      if (e.target.tagName !== 'INPUT') { e.preventDefault(); (body.querySelector('.term-input') || input).focus(); }
    });

    const wrap = h('div', { style: 'display:flex;flex-direction:column;min-height:0;flex:1;height:100%' }, term);
    return { el: wrap, focus: () => (body.querySelector('.term-input') || input).focus() };
  }

  /* ── file tree / drawer (read-only + file ops) ────────────────────────── */
  function FileTree(opts) {
    const wrap = h('div', { class: 'tree-wrap' });
    const treeHost = h('div', { class: 'tree' });
    const rows = new Map();       // path -> file row
    const dirRows = new Map();    // path -> folder row
    let mode = 'tree';            // 'tree' | 'list' (simple view)
    let activeDir = null;         // folder selected as create/move target
    let dragPath = null;          // file being dragged internally
    let toastEl = null, promptEl = null, openMenuEl = null, openMenuBtn = null;

    wrap.append(treeHost);
    if (opts.toolbar) {
      wrap.prepend(buildToolbar());
      const overlay = h('div', { class: 'drop-overlay' }, 'Drop files to upload · max ' + (opts.maxUploadMB || 200) + ' MB');
      wrap.append(overlay);
      wrap.addEventListener('dragover', (e) => { if (hasOsFiles(e)) { e.preventDefault(); overlay.style.display = 'grid'; } });
      wrap.addEventListener('dragleave', (e) => { if (!wrap.contains(e.relatedTarget)) overlay.style.display = 'none'; });
      wrap.addEventListener('drop', (e) => {
        if (!hasOsFiles(e)) return;
        e.preventDefault(); overlay.style.display = 'none';
        if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files);
      });
      document.addEventListener('mousedown', (e) => {
        if (openMenuEl && !openMenuEl.contains(e.target) && (!openMenuBtn || !openMenuBtn.contains(e.target))) closeMenu();
      });
    }

    function hasOsFiles(e) { return !!(e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')); }
    function rootNodes() { if (!M.files[opts.projectId]) M.files[opts.projectId] = []; return M.files[opts.projectId]; }

    /* find a node (and its parent array + index) by path */
    function locate(nodes, path, prefix) {
      prefix = prefix || '';
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const p = prefix ? prefix + '/' + n.name : n.name;
        if (p === path) return { node: n, array: nodes, index: i };
        if (n.type === 'dir') { const r = locate(n.children || [], path, p); if (r) return r; }
      }
      return null;
    }
    function newPathFor(oldPath, newName) {
      const base = oldPath.includes('/') ? oldPath.split('/').slice(0, -1).join('/') : '';
      return base ? base + '/' + newName : newName;
    }

    function render() {
      treeHost.innerHTML = '';
      rows.clear(); dirRows.clear();
      if (mode === 'tree') renderTree(rootNodes(), treeHost, '');
      else renderList(rootNodes());
    }

    function renderTree(nodes, host, prefix) {
      nodes.forEach((n) => {
        const path = prefix ? prefix + '/' + n.name : n.name;
        const dir = n.type === 'dir';
        const row = h('div', {
          class: 'tree-row' + (dir ? ' dir' : '') + (dir && path === activeDir ? ' active' : '') + (opts.toolbar ? ' with-actions' : '')
        },
          icon(dir ? 'folder' : 'file'),
          h('span', { class: 'name truncate' }, n.name),
          (opts.toolbar && !dir) ? h('span', { class: 'size' }, fileMeta({ ...n, path }).size) : null);
        host.append(row);
        if (opts.toolbar) attachMenu(row, path, n);
        if (dir) {
          dirRows.set(path, row);
          const kids = h('div', { class: 'tree-kids' });
          host.append(kids);
          row.onclick = () => { kids.hidden = !kids.hidden; if (opts.toolbar) setActiveDir(path); };
          if (opts.toolbar) {
            row.addEventListener('dragover', (e) => {
              if (!dragPath) return;
              e.preventDefault(); e.stopPropagation();
              row.classList.add('drop-target');
            });
            row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
            row.addEventListener('drop', (e) => {
              if (!dragPath) return;
              e.preventDefault(); e.stopPropagation();
              row.classList.remove('drop-target');
              confirmMove(dragPath, path);
            });
          }
          renderTree(n.children || [], kids, path);
        } else {
          rows.set(path, row);
          row.onclick = () => { opts.onOpen(path); setOn(path); };
          if (opts.toolbar) {
            row.draggable = true;
            row.addEventListener('dragstart', (e) => { dragPath = path; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', path); });
            row.addEventListener('dragend', () => { dragPath = null; dirRows.forEach((r) => r.classList.remove('drop-target')); });
          }
        }
      });
    }

    function renderList(nodes) {
      const files = flatten(nodes);
      treeHost.append(h('div', { class: 'list-head' },
        h('span', { class: 'c-name' }, 'Name'),
        h('span', { class: 'c-size' }, 'Size'),
        h('span', { class: 'c-mod' }, 'Modified'),
        h('span', { class: 'c-perm' }, 'Perm')));
      files.forEach((n) => {
        const m = fileMeta(n);
        const row = h('div', { class: 'list-row' + (opts.toolbar ? ' with-actions' : ''), title: n.path },
          h('span', { class: 'c-name' }, icon('file'), h('span', { class: 'name truncate' }, n.name)),
          h('span', { class: 'c-size' }, m.size),
          h('span', { class: 'c-mod' }, m.modified),
          h('span', { class: 'c-perm' }, m.perm));
        if (opts.toolbar) attachMenu(row, n.path, n);
        row.onclick = () => { opts.onOpen(n.path); setOn(n.path); };
        rows.set(n.path, row);
        treeHost.append(row);
      });
    }

    const setOn = (path) => {
      rows.forEach((r) => r.classList.remove('on'));
      if (rows.get(path)) rows.get(path).classList.add('on');
    };
    function setActiveDir(path) {
      activeDir = path;
      dirRows.forEach((r, p) => r.classList.toggle('active', p === path));
    }

    /* ── per-row actions: rename / delete ───────────────────────────────── */
    function attachMenu(row, path, node) {
      const more = h('button', { class: 'row-more', title: 'Actions', html: ICONS.dots });
      const menu = h('div', { class: 'row-menu', style: 'display:none' },
        h('button', { class: 'mi' }, 'Rename'),
        h('button', { class: 'mi danger' }, 'Delete'));
      row.append(more, menu);
      const ren = menu.querySelector('.mi');
      const del = menu.querySelector('.mi.danger');
      const open = () => {
        const r = more.getBoundingClientRect();
        menu.style.cssText = 'display:block;position:fixed;z-index:60;top:' + (r.bottom + 4) + 'px;left:' + Math.max(8, r.right - 132) + 'px;';
        openMenuEl = menu; openMenuBtn = more;
      };
      more.onclick = (e) => {
        e.stopPropagation();
        if (openMenuEl === menu) { closeMenu(); return; }
        closeMenu(); open();
      };
      ren.onclick = (e) => { e.stopPropagation(); closeMenu(); startRename(path, node); };
      del.onclick = (e) => { e.stopPropagation(); closeMenu(); removeNode(path, node); };
    }
    function closeMenu() { if (openMenuEl) { openMenuEl.style.display = 'none'; openMenuEl = null; openMenuBtn = null; } }

    function startRename(path, node) {
      promptFor({
        initial: node.name, placeholder: node.name,
        hint: node.type === 'dir' ? 'rename folder' : 'rename file',
        onCommit: (name) => renameNode(path, node, name),
      });
    }
    function renameNode(path, node, newName) {
      if (newName === node.name) return;
      const parent = locate(rootNodes(), path);
      const siblings = parent ? parent.array : rootNodes();
      if (siblings.some((x) => x !== node && x.name === newName)) { toast('“' + newName + '” already exists'); return; }
      node.name = newName;
      if (node.type === 'dir' && activeDir === path) activeDir = null;
      render();
      toast('renamed to ' + newName);
      if (opts.onRename) opts.onRename(path, newPathFor(path, newName), node.type === 'dir');
    }

    function removeNode(path, node) {
      const isDir = node.type === 'dir';
      confirmDialog('Delete ' + (isDir ? 'folder' : 'file'),
        'Delete “' + node.name + (isDir ? '” and everything inside it?' : '”?') + ' This cannot be undone.',
        'Delete', () => {
          const loc = locate(rootNodes(), path);
          if (!loc) return;
          loc.array.splice(loc.index, 1);
          if (isDir && activeDir === path) activeDir = null;
          render();
          toast('deleted ' + node.name);
          if (opts.onDelete) opts.onDelete(path, isDir);
        });
    }

    /* ── toolbar: upload / new file / new folder / refresh / view toggle ── */
    function buildToolbar() {
      const tb = h('div', { class: 'tree-toolbar' });
      const input = h('input', { type: 'file', multiple: true, style: 'display:none' });
      input.onchange = () => { handleUpload(input.files); input.value = ''; };
      const btn = (ic, title, onclick) => { const b = h('button', { class: 'icon-btn', style: 'width:26px;height:26px', title, html: ICONS[ic] }); b.onclick = onclick; tb.append(b); return b; };

      btn('upload', 'Upload file (max ' + (opts.maxUploadMB || 200) + ' MB)', () => input.click());
      btn('filePlus', 'New file' + (activeDir ? ' in ' + activeDir : ''), () => showPrompt('file'));
      btn('folderPlus', 'New folder' + (activeDir ? ' in ' + activeDir : ''), () => showPrompt('dir'));
      const refreshBtn = btn('refresh', 'Refresh', () => {
        refreshBtn.classList.add('spin');
        setTimeout(() => { refreshBtn.classList.remove('spin'); render(); toast('synced'); }, 550);
      });
      const viewBtn = btn('list', 'Simple view (flat list)', () => {
        mode = mode === 'tree' ? 'list' : 'tree';
        viewBtn.innerHTML = ICONS[mode === 'tree' ? 'list' : 'folder'];
        viewBtn.title = mode === 'tree' ? 'Simple view (flat list)' : 'Tree view';
        render();
      });
      tb.append(input);
      return tb;
    }

    /* ── prompts + confirm + toast ──────────────────────────────────────── */
    function showPrompt(kind) {
      promptFor({
        placeholder: kind === 'dir' ? 'folder-name' : 'file-name.ts',
        hint: activeDir ? 'in ' + activeDir : 'in root',
        onCommit: (name) => createNode(kind, name),
      });
    }
    function promptFor(o) {
      if (!promptEl) { promptEl = h('div', { class: 'file-prompt' }); wrap.insertBefore(promptEl, treeHost); }
      promptEl.innerHTML = '';
      promptEl.style.display = 'flex';
      const input = h('input', { placeholder: o.placeholder || '', spellcheck: 'false' });
      if (o.initial) input.value = o.initial;
      const hint = o.hint ? h('span', { class: 'prompt-hint' }, o.hint) : null;
      const ok = h('button', { class: 'icon-btn', style: 'width:24px;height:24px', title: 'OK', html: ICONS.send });
      const cancel = h('button', { class: 'icon-btn', style: 'width:24px;height:24px', title: 'Cancel', html: ICONS.x });
      const finish = (commit) => {
        const name = input.value.trim();
        promptEl.style.display = 'none'; promptEl.innerHTML = '';
        if (commit && name) o.onCommit(name);
      };
      ok.onclick = () => finish(true);
      cancel.onclick = () => finish(false);
      input.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); };
      promptEl.append(input); if (hint) promptEl.append(hint); promptEl.append(ok, cancel);
      input.focus();
      if (o.initial) { const dot = o.initial.lastIndexOf('.'); input.setSelectionRange(0, dot > 0 ? dot : o.initial.length); }
    }

    function createNode(kind, name) {
      const node = kind === 'dir'
        ? { name, type: 'dir', children: [] }
        : { name, type: 'file', lang: langFor(name), lines: ['// ' + name, ''] };
      const t = activeDir ? locate(rootNodes(), activeDir) : null;
      const parent = (t && t.node.type === 'dir') ? (t.node.children || (t.node.children = [])) : rootNodes();
      parent.push(node);
      render();
      toast((kind === 'dir' ? 'folder ' : 'file ') + name + ' created' + (activeDir ? ' in ' + activeDir : ''));
      if (kind === 'file') { const path = activeDir ? activeDir + '/' + name : name; opts.onOpen(path); setOn(path); }
    }

    function handleUpload(fileList) {
      const max = (opts.maxUploadMB || 200) * 1024 * 1024;
      const root = rootNodes();
      let added = 0, big = 0;
      Array.from(fileList || []).forEach((f) => {
        if (f.size > max) { big++; return; }
        root.unshift({ name: f.name, type: 'file', lang: langFor(f.name),
          lines: ['// uploaded: ' + f.name, '// ' + f.size + ' bytes', ''] });
        added++;
      });
      render();
      toast(added ? added + ' uploaded' + (big ? ' · ' + big + ' too large' : '') : (big ? big + ' file(s) over the limit' : 'nothing to upload'));
    }

    function confirmMove(srcPath, destDirPath) {
      const name = srcPath.split('/').pop();
      confirmDialog('Move file', 'Move “' + name + '” into “' + (destDirPath || 'root') + '”?', 'Move', () => moveNode(srcPath, destDirPath));
    }
    function moveNode(srcPath, destDirPath) {
      const src = locate(rootNodes(), srcPath);
      const dest = locate(rootNodes(), destDirPath);
      if (!src || !dest || dest.node.type !== 'dir') { dragPath = null; return; }
      const parentPath = srcPath.includes('/') ? srcPath.split('/').slice(0, -1).join('/') : '';
      if (parentPath === destDirPath) { dragPath = null; toast('already in ' + (destDirPath || 'root')); return; }
      src.array.splice(src.index, 1);
      (dest.node.children || (dest.node.children = [])).push(src.node);
      dragPath = null;
      render();
      const newPath = destDirPath ? destDirPath + '/' + src.node.name : src.node.name;
      toast('moved ' + src.node.name + ' → ' + (destDirPath || 'root'));
      if (opts.onMove) opts.onMove(srcPath, destDirPath);
      setOn(newPath);
    }

    function confirmDialog(title, detail, okLabel, onOk) {
      const overlay = h('div', { class: 'modal' });
      const box = h('div', { class: 'modal-box' },
        h('div', { class: 'modal-title' }, title),
        h('div', { class: 'modal-detail' }, detail),
        h('div', { class: 'modal-actions' },
          h('button', { class: 'btn' }, 'Cancel'),
          h('button', { class: 'btn danger' }, okLabel)));
      const cancel = box.querySelector('.btn');
      const ok = box.querySelector('.btn.danger');
      const close = (result) => { overlay.remove(); if (result) onOk(); };
      cancel.onclick = () => close(false);
      ok.onclick = () => close(true);
      overlay.onclick = (e) => { if (e.target === overlay) close(false); };
      const onKey = (e) => { if (e.key === 'Escape') { close(false); document.removeEventListener('keydown', onKey); } };
      document.addEventListener('keydown', onKey);
      overlay.append(box);
      document.body.append(overlay);
      cancel.focus();
    }

    function toast(msg) {
      if (!toastEl) { toastEl = h('div', { class: 'toast' }); wrap.append(toastEl); }
      toastEl.textContent = msg;
      toastEl.classList.add('show');
      clearTimeout(toastEl._t);
      toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 2200);
    }

    render();
    return { el: wrap, setOn };
  }

  /* ── read-only code viewer (source table / markdown / editable) ───────── */
  function CodeView(opts) {
    const host = h('div', { class: 'code' });
    const empty = h('div', { class: 'empty-state' },
      h('div', { html: ICONS.eye }), h('div', {}, 'read-only'), h('div', {}, 'pick a file'));
    host.append(empty);
    let head = opts.headEl;
    let current = null;
    let preview = false;
    let editing = false;

    function paint() {
      host.innerHTML = '';
      if (!current) { host.append(empty); if (head) head.textContent = 'no file'; return; }
      if (editing) {
        const ta = document.createElement('textarea');
        ta.className = 'code-edit';
        ta.spellcheck = false;
        ta.value = current.lines.join('\n');
        host.append(ta);
      } else if (preview && current.lang === 'md') {
        host.innerHTML = '<div class="md">' + renderMarkdown(current.lines.join('\n')) + '</div>';
      } else {
        const rows = current.lines.map((ln, i) =>
          '<tr><td class="ln">' + (i + 1) + '</td><td class="src">' + highlight(ln, current.lang || 'ts') + '</td></tr>');
        host.innerHTML = '<table><tbody>' + rows.join('') + '</tbody></table>';
      }
      host.scrollTop = 0;
      if (head) head.textContent = current.path;
    }

    function show(path) {
      if (!path) { current = null; preview = false; editing = false; paint(); return; }
      current = opts.projectId ? findFile(opts.projectId, path) : null;
      preview = false; editing = false;
      paint();
    }

    function toggleEdit() {
      if (editing) {
        const ta = host.querySelector('textarea.code-edit');
        if (ta && current) { const next = ta.value.split('\n'); current.lines.splice(0, current.lines.length, ...next); }
      }
      editing = !editing;
      paint();
      return editing;
    }

    return {
      el: host, show,
      setHead: (el) => { head = el; },
      togglePreview: () => { if (current && current.lang === 'md') { preview = !preview; paint(); } return preview; },
      toggleEdit,
      isMarkdown: () => !!(current && current.lang === 'md'),
      previewOn: () => preview,
      isEditing: () => editing,
    };
  }

  /* ── project + session pickers (shared look, layout-owned placement) ──── */
  function ProjectList(opts) {
    const list = h('div', { class: 'proj-list' });
    M.projects.forEach((p) => {
      const item = h('button', { class: 'proj-item' + (p.id === opts.active ? ' on' : '') },
        icon('folder'),
        h('span', { class: 'grow' },
          h('div', { class: 'truncate' }, p.name),
          h('div', { class: 'sub truncate' }, p.path)),
        h('span', { class: 'dot' + (p.sessions.some((s) => s.live) ? ' live' : ' idle') }));
      item.onclick = () => opts.onSelect(p.id);
      list.append(item);
    });
    return { el: list, setActive: () => {} };
  }

  function SessionList(opts) {
    const list = h('div', { class: 'sess-list' });
    project(opts.projectId).sessions.forEach((s) => {
      const item = h('button', { class: 'sess-item' + (s.id === opts.active ? ' on' : '') },
        h('div', { class: 't truncate' }, s.title),
        h('div', { class: 'm' }, s.updated + (s.live ? ' · live' : '')));
      item.onclick = () => opts.onSelect(s.id);
      list.append(item);
    });
    return { el: list };
  }

  window.PW.parts = {
    h, esc, icon, ICONS, sleep, project, fileTree, flatten, findFile, fileMeta,
    highlight, toolCard, turnEl, scrollDown, ChatPane, TerminalPane, FileTree, CodeView,
    ProjectList, SessionList,
  };
})();
