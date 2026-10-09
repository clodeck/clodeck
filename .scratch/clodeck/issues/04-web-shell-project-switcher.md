# 04: Web app shell + project switcher

**What to build:** A React app shell renders the project switcher as its first real surface: on load and on a refresh action it fetches `/api/projects` and lists the discovered projects, with a loading state while in flight and an error state with retry when the backend is down. The switcher renders from the shared `Project` type, so a backend contract change is caught at compile time.

**Blocked by:** 02, 03

**Status:** resolved

- [x] React + Vite + Tailwind app shell is scaffolded so later chat/terminal/file-drawer slices have a home; those surfaces are stub placeholders only.
- [x] The Vite dev server proxies `/api` to the backend, so the client develops against the real endpoint with no CORS setup.
- [x] The switcher fetches `/api/projects` on mount and on a refresh action; a folder dropped into the root shows up on the next refresh.
- [x] A loading state is shown while the request is in flight (no misleading empty flash).
- [x] An error state with a retry action is shown when the request fails.
- [x] The switcher renders from the shared `Project` type — no hardcoded fixtures (the prototype's mock data is not imported).

## What landed

```
web/src/useProjects.ts      the data seam: fetch on mount, reload(), and a
                            loading | ready | error state union (no implicit empty state)
web/src/ProjectSwitcher.tsx the surface: list + refresh, skeletons, error + retry, empty hint
web/src/App.tsx             the shell: sidebar switcher + the workspace it will fill
web/src/index.css           Tailwind v4 entry + the prototype's palette as @theme tokens
web/vite.config.ts          react + tailwind plugins, `/api` proxied to 127.0.0.1:3001
```

- The palette is the verified prototype's (canvas `#0b0d10`, ink `#e7edf3`, accent `#c96442`, …)
  declared as Tailwind v4 theme tokens, so later surfaces inherit one visual language.
- `loading` is its own state rather than "ready with nothing" — the requirement that the UI never
  flashes an empty list is enforced by the state shape, not by a guard at the render site.
- The fetch validates the envelope at the boundary (`id`/`name`/`path` strings) so a drifted
  response lands in the error state instead of rendering `undefined` — the compile-time contract
  comes from `@clodeck/shared`, and this covers the wire.
- Beyond the ticket's letter, two small additions the shell needed to be a home for later slices:
  selecting a project (highlight + `aria-current`, derived from the fresh list so a deleted project
  stops being selected) and stub Chat / Terminal / Files panels for the selected project.

## Evidence

`npm run build` → typecheck clean, Vite built 18 modules (incl. 10.1 kB of Tailwind CSS).

The spec puts browser-level tests out of scope for this slice, so the switcher was verified by
driving the real dev server in headless Chrome over CDP (throwaway script in the OS temp dir, not
committed) against a temp projects root with `alpha`, `escape`, `zulu`, `.hidden` and a stray file:

```
error state (backend down)   → "Could not load projects / 502 Bad Gateway" + Retry, main area empty
retry after the backend came up → ["alpha","escape","zulu"]  ← real data through the Vite proxy,
                                 dotdir + plain file excluded, alphabetical
select zulu                  → header "zulu" + its path, stub surfaces ["Chat","Terminal","Files"],
                               aria-current on the selected row
throttled refresh (1.5s)     → loading indicator present, "No projects yet" absent
list returns after the refresh
no console errors
```

Screenshots of each state were captured and inspected (error, listed, selected, loading).
