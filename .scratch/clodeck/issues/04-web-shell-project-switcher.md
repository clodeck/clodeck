# 04: Web app shell + project switcher

**What to build:** A React app shell renders the project switcher as its first real surface: on load and on a refresh action it fetches `/api/projects` and lists the discovered projects, with a loading state while in flight and an error state with retry when the backend is down. The switcher renders from the shared `Project` type, so a backend contract change is caught at compile time.

**Blocked by:** 02, 03

**Status:** ready-for-agent

- [ ] React + Vite + Tailwind app shell is scaffolded so later chat/terminal/file-drawer slices have a home; those surfaces are stub placeholders only.
- [ ] The Vite dev server proxies `/api` to the backend, so the client develops against the real endpoint with no CORS setup.
- [ ] The switcher fetches `/api/projects` on mount and on a refresh action; a folder dropped into the root shows up on the next refresh.
- [ ] A loading state is shown while the request is in flight (no misleading empty flash).
- [ ] An error state with a retry action is shown when the request fails.
- [ ] The switcher renders from the shared `Project` type — no hardcoded fixtures (the prototype's mock data is not imported).
