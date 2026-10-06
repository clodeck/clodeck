/* PROTOTYPE mock data — invented, in memory only. Nothing here is real:
   no backend, no files on disk, no Agent SDK. Wipe freely. */

window.MOCK = {
  user: 'ehsan',

  /* the canned assistant reply the composer streams back */
  reply: "Right — the transcript was re-keying on every SDKMessage, so React threw the whole list away and rebuilt it.\n\nI moved the message list to a keyed reducer and now each `assistant` / `user` / `tool_progress` frame appends one entry instead of replacing the array. Two files touched.",

  replyTools: [
    { name: 'Read', arg: 'src/ChatPane.tsx:1-120', status: 'done',
      out: "…118 lines — found `setMessages(prev => [...prev, msg])` inside a\n`useEffect` keyed on the whole event stream. That is the flicker." },
    { name: 'Edit', arg: 'src/ChatPane.tsx', status: 'done',
      out: "applied 2 edits  ·  +14 −9\n  41  -  setMessages(events)\n  41  +  dispatch({ type: 'sdk-message', msg })" }
  ],

  projects: [
    {
      id: 'claude-ui', name: 'claude-ui', path: '~/dev/claude-ui', branch: 'master', dirty: 3,
      sessions: [
        {
          id: 'a3f21c7e-8b44-4c1a-9d02-5f7e1b2c9a10', title: 'Streaming chat over the Agent SDK',
          updated: '2m ago', live: true,
          messages: [
            { role: 'user', text: 'why does the chat pane flicker when a tool result lands?' },
            { role: 'assistant', text: 'Two candidates: the transcript re-renders from scratch, or the SDK frames arrive on separate ticks and each one resets scroll. Let me look.' ,
              tools: [{ name: 'Grep', arg: '"setMessages" -n src', status: 'done',
                        out: 'src/ChatPane.tsx:41\nsrc/hooks/useSession.ts:88' }] },
            { role: 'user', text: 'go ahead and fix it' },
          ]
        },
        {
          id: 'b91d0e55-77aa-4f31-b8c6-2e4d9a0f1123', title: 'Project switcher + session resume',
          updated: 'yesterday', messages: [
            { role: 'user', text: 'map every dir under ~/dev to a project card, remember the last session per project' },
            { role: 'assistant', text: 'So the sidebar state is per-project, not global. I would key the session map by project id and fall back to `continue: true` when there is no remembered id.' },
          ]
        },
        {
          id: 'c07ab1f2-3d19-4e77-9a41-6b2f8c0d4e55', title: 'xterm.js attach + resize handshake',
          updated: '3d ago', messages: [
            { role: 'user', text: 'does addon-attach send resize?' },
            { role: 'assistant', text: 'No — the attach addon only ships the byte stream. Resize has to travel out of band as its own control frame.' },
          ]
        },
      ]
    },
    {
      id: 'acme-api', name: 'acme-api', path: '~/dev/acme-api', branch: 'feat/rate-limit', dirty: 0,
      sessions: [
        {
          id: 'd41c9a80-62b3-4f0e-8c7d-1a5e3b9f7c22', title: 'Rate limiter: token bucket per key',
          updated: '1h ago', live: true,
          messages: [
            { role: 'user', text: 'the limiter counts per route but the spec says per api key' },
            { role: 'assistant', text: 'Then the bucket key is wrong. It should be `key:route` at most, and `key` if the quota is account-wide. Which is it?' },
            { role: 'user', text: 'account-wide for now' },
          ]
        },
        {
          id: 'e88f2b11-90c4-4a2b-b6d1-7c3e5a0f9d33', title: 'Postgres connection pool exhaustion',
          updated: '2d ago', messages: [
            { role: 'user', text: 'p99 spikes every 40 minutes like clockwork' },
            { role: 'assistant', text: 'Clockwork usually means a scheduled job holding a connection. Check the cron worker before the pool math.' },
          ]
        },
      ]
    },
    {
      id: 'blog', name: 'blog', path: '~/dev/blog', branch: 'main', dirty: 0,
      sessions: [
        {
          id: 'f12e7c44-55d8-4b93-a1f0-9e6b2d4c8a77', title: 'Draft: why local shells beat cloud IDEs',
          updated: '5d ago', messages: [
            { role: 'user', text: 'tighten the intro, it takes three paragraphs to say one thing' },
            { role: 'assistant', text: 'Cut it to: the editor is the cheap part, the loop is the product. Everything before that is throat-clearing.' },
          ]
        },
      ]
    },
  ],

  /* read-only viewer contents */
  files: {
    'claude-ui': [
      { name: 'src', type: 'dir', children: [
        { name: 'ChatPane.tsx', type: 'file', lang: 'tsx', lines: [
          "import { useReducer, useEffect, useRef } from 'react';",
          "import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';",
          "import { transcriptReducer, initialTranscript } from './transcript';",
          "",
          "// One entry appended per SDKMessage — never a full-array replace.",
          "// Replacing the array is what made the transcript flicker.",
          "export function ChatPane({ sessionId }: { sessionId: string }) {",
          "  const [transcript, dispatch] = useReducer(",
          "    transcriptReducer,",
          "    initialTranscript,",
          "  );",
          "",
          "  useEffect(() => {",
          "    const stream = openSessionStream(sessionId);",
          "    const off = stream.on('message', (msg: SDKMessage) => {",
          "      dispatch({ type: 'sdk-message', msg });",
          "    });",
          "    return () => { off(); stream.close(); };",
          "  }, [sessionId]);",
          "",
          "  return <Transcript entries={transcript.entries} />;",
          "}",
        ]},
        { name: 'transcript.ts', type: 'file', lang: 'ts', lines: [
          "import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';",
          "",
          "export type Entry =",
          "  | { kind: 'text'; role: 'user' | 'assistant'; text: string }",
          "  | { kind: 'tool'; name: string; input: unknown; result?: string };",
          "",
          "const PROJECT: Record<SDKMessage['type'], Entry['kind'] | null> = {",
          "  system: null,",
          "  assistant: 'text',",
          "  user: 'text',",
          "  tool_progress: 'tool',",
          "  result: null,",
          "  stream_event: null,",
          "};",
          "",
          "export function transcriptReducer(state: State, action: Action): State {",
          "  if (action.type !== 'sdk-message') return state;",
          "  const kind = PROJECT[action.msg.type];",
          "  if (!kind) return state;",
          "  // append-only: keep identity of every prior entry",
          "  return { ...state, entries: [...state.entries, toEntry(action.msg)] };",
          "}",
        ]},
        { name: 'Terminal.tsx', type: 'file', lang: 'tsx', lines: [
          "import { Terminal as XTerm } from '@xterm/xterm';",
          "import { AttachAddon } from '@xterm/addon-attach';",
          "",
          "export function TerminalPane({ projectId }: { projectId: string }) {",
          "  const host = useRef<HTMLDivElement>(null);",
          "",
          "  useEffect(() => {",
          "    const term = new XTerm({ fontFamily: 'ui-monospace', fontSize: 12.5 });",
          "    term.open(host.current!);",
          "    const ws = new WebSocket(`/pty?project=${projectId}`);",
          "    term.loadAddon(new AttachAddon(ws));",
          "",
          "    // attach() does NOT send resize — it travels out of band",
          "    const off = term.onResize(({ cols, rows }) => {",
          "      if (ws.readyState === WebSocket.OPEN) {",
          "        ws.send(JSON.stringify({ t: 'resize', cols, rows }));",
          "      }",
          "    });",
          "    return () => { off.dispose(); ws.close(); term.dispose(); };",
          "  }, [projectId]);",
          "",
          "  return <div ref={host} className='terminal-host' />;",
          "}",
        ]},
      ]},
      { name: 'docs', type: 'dir', children: [
        { name: 'adr', type: 'dir', children: [
          { name: '0001-agent-sdk-transport.md', type: 'file', lang: 'md', lines: [
            "# ADR 0001 — one WebSocket per session",
            "",
            "**Status:** proposed  ",
            "**Date:** 2026-10-06",
            "",
            "## Context",
            "",
            "Chat frames, tool progress, and terminal bytes all need to reach the",
            "browser with the least possible latency. The Agent SDK hands us an",
            "`AsyncGenerator<SDKMessage>` per project.",
            "",
            "## Decision",
            "",
            "One socket per *session*, not per project. Terminal bytes ride the",
            "same socket as chat frames, discriminated by a `t` field.",
            "",
            "## Consequences",
            "",
            "- resume is a socket-level concept; reconnect replays from session_id",
            "- backpressure on the pty needs a watermark before it can block chat",
          ]},
        ]},
        { name: 'GLOSSARY.md', type: 'file', lang: 'md', lines: [
          "# Glossary",
          "",
          "**Project** — one directory on the server, one Agent SDK session at a",
          "time, one terminal. The unit the switcher switches between.",
          "",
          "**Session** — one resumable conversation bound to a project's cwd.",
          "Identified by `session_id`; survives the browser tab.",
          "",
          "**Transcript** — the client-side append-only projection of SDKMessage",
          "frames. Not the source of truth; the jsonl on disk is.",
        ]},
      ]},
      { name: 'package.json', type: 'file', lang: 'json', lines: [
        '{',
        '  "name": "deck",',
        '  "private": true,',
        '  "type": "module",',
        '  "scripts": {',
        '    "dev": "vite",',
        '    "server": "tsx watch src/server/index.ts"',
        '  },',
        '  "dependencies": {',
        '    "@anthropic-ai/claude-agent-sdk": "^0.1.0",',
        '    "@xterm/addon-attach": "^0.11.0",',
        '    "@xterm/xterm": "^5.5.0",',
        '    "node-pty": "^1.0.0",',
        '    "react": "^19.0.0",',
        '    "ws": "^8.18.0"',
        '  }',
        '}',
      ]},
      { name: 'README.md', type: 'file', lang: 'md', lines: [
        "# deck (placeholder name)",
        "",
        "Remote browser access to Claude Code across multiple project",
        "directories, on a server you own.",
        "",
        "> **PROTOTYPE** — this tree is throwaway. See",
        "> `../issues/03-visual-prototype.md` for the question it answers.",
      ]},
    ],
    'acme-api': [
      { name: 'src', type: 'dir', children: [
        { name: 'rate-limit.ts', type: 'file', lang: 'ts', lines: [
          "export type Bucket = { tokens: number; refilledAt: number };",
          "",
          "const buckets = new Map<string, Bucket>();",
          "",
          "// TODO: the spec says the quota is per api key, account-wide.",
          "// Keying on `key:route` here is what the bug report is about.",
          "export function take(key: string, route: string, cost = 1): boolean {",
          "  const id = `${key}:${route}`;",
          "  const now = Date.now();",
          "  const b = buckets.get(id) ?? { tokens: CAPACITY, refilledAt: now };",
          "",
          "  const refill = Math.floor((now - b.refilledAt) / WINDOW_MS) * REFILL_RATE;",
          "  b.tokens = Math.min(CAPACITY, b.tokens + refill);",
          "  b.refilledAt = refill > 0 ? now : b.refilledAt;",
          "",
          "  if (b.tokens < cost) return false;",
          "  b.tokens -= cost;",
          "  buckets.set(id, b);",
          "  return true;",
          "}",
        ]},
        { name: 'db.ts', type: 'file', lang: 'ts', lines: [
          "import { Pool } from 'pg';",
          "",
          "export const pool = new Pool({",
          "  connectionString: process.env.DATABASE_URL,",
          "  max: 10,",
          "  idleTimeoutMillis: 30_000,",
          "});",
          "",
          "// the cron worker holds one connection for the whole run —",
          "// that is the 40-minute p99 spike, not the pool size.",
          "export const cronPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });",
        ]},
      ]},
      { name: 'test', type: 'dir', children: [
        { name: 'rate-limit.test.ts', type: 'file', lang: 'ts', lines: [
          "import { describe, it, expect } from 'vitest';",
          "import { take } from '../src/rate-limit';",
          "",
          "describe('rate limiter', () => {",
          "  it('shares one quota across routes for the same key', () => {",
          "    expect(take('k1', '/a')).toBe(true);",
          "    expect(take('k1', '/b')).toBe(true); // fails today: separate buckets",
          "  });",
          "});",
        ]},
      ]},
      { name: 'package.json', type: 'file', lang: 'json', lines: [
        '{ "name": "acme-api", "scripts": { "test": "vitest run" } }',
      ]},
    ],
    'blog': [
      { name: 'posts', type: 'dir', children: [
        { name: 'local-shells.md', type: 'file', lang: 'md', lines: [
          "---",
          "title: Why local shells beat cloud IDEs",
          "draft: true",
          "---",
          "",
          "The editor is the cheap part. The loop is the product.",
          "",
          "Every cloud IDE ships you a worse editor than the one you already",
          "have, and charges you latency for the privilege. The interesting",
          "question was never where the text lives — it is where the *shell*",
          "lives, because that is where the work actually happens.",
        ]},
      ]},
      { name: 'site.config.ts', type: 'file', lang: 'ts', lines: [
        "export default {",
        "  title: 'ehsan.dev',",
        "  url: 'https://ehsan.dev',",
        "  posts: './posts',",
        "};",
      ]},
    ],
  },

  /* canned terminal responses — fake, matched on the first word */
  term: {
    ls:  'AGENTS.md   README.md   docs/   package.json   src/   vitest.config.ts',
    pwd: '~/dev/claude-ui',
    'git': '__GIT__',
    'npm': '__NPM__',
    node: 'v22.11.0',
    claude: 'deck is a prototype — there is no agent here.',
    whoami: 'ehsan',
    cat:  '__CAT__',
  },
};
