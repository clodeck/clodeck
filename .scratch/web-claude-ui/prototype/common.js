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

  /* ── read-only file tree ──────────────────────────────────────────────── */
  function FileTree(opts) {
    const root = h('div', { class: 'tree' });
    const rows = new Map();

    function build(nodes, host, prefix) {
      nodes.forEach((n) => {
        const path = prefix ? prefix + '/' + n.name : n.name;
        const row = h('button', { class: 'tree-row' + (n.type === 'dir' ? ' dir' : '') },
          icon(n.type === 'dir' ? 'folder' : 'file'),
          h('span', { class: 'truncate' }, n.name));
        host.append(row);
        if (n.type === 'dir') {
          const kids = h('div', { class: 'tree-kids' });
          host.append(kids);
          row.onclick = () => { kids.hidden = !kids.hidden; };
          build(n.children || [], kids, path);
        } else {
          rows.set(path, row);
          row.onclick = () => { opts.onOpen(path); setOn(path); };
        }
      });
    }
    const setOn = (path) => {
      rows.forEach((r) => r.classList.remove('on'));
      if (rows.get(path)) rows.get(path).classList.add('on');
    };
    build(fileTree(opts.projectId), root, '');
    if (rows.size && !opts.noDefault) { /* leave unselected: the viewer is empty until you click */ }
    return { el: root, setOn };
  }

  /* ── read-only code viewer ────────────────────────────────────────────── */
  function CodeView(opts) {
    const host = h('div', { class: 'code' });
    const empty = h('div', { class: 'empty-state' },
      h('div', { html: ICONS.eye }), h('div', {}, 'read-only'), h('div', {}, 'pick a file'));
    host.append(empty);
    let head = opts.headEl;

    function show(path) {
      const f = opts.projectId && findFile(opts.projectId, path);
      host.innerHTML = '';
      if (!f) { host.append(empty); if (head) head.textContent = 'no file'; return; }
      const rows = f.lines.map((ln, i) =>
        '<tr><td class="ln">' + (i + 1) + '</td><td class="src">' + highlight(ln, f.lang || 'ts') + '</td></tr>');
      host.innerHTML = '<table><tbody>' + rows.join('') + '</tbody></table>';
      host.scrollTop = 0;
      if (head) head.textContent = f.path;
    }
    return { el: host, show, setHead: (el) => { head = el; } };
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
    h, esc, icon, ICONS, sleep, project, fileTree, flatten, findFile,
    highlight, toolCard, turnEl, scrollDown, ChatPane, TerminalPane, FileTree, CodeView,
    ProjectList, SessionList,
  };
})();
