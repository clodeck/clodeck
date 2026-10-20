# 86: The operator's docs catch up

**What to build:** README chāhār mode rā, do motaghayyer-e env rā, va warning-e Bypass rā mostanad
mikonad — pas operator bedoone khāndan-e code midānad har mode che ghā'ede-i dārad va che-tori Bypass rā
roshan/khāmoosh konad.

**Blocked by:** 85

**Status:** ready-for-agent

## Agent Brief

**Summary:** Docs-only. Hich code-i taghir nemikonad; README bā raftār-e land-shode ham-rāh mishavad.

**Current behavior:**
- README hich chiz-i dar morede permission mode, `CLODECK_PERMISSION_MODE` yā `CLODECK_ALLOW_BYPASS`
  nemiguyad.
- `AGENTS.md` va `GLOSSARY.md` dar ticket 81 update shodan; README (khārej az MVP) hanooz na.

**Desired behavior:**
- Yek bakhsh-e **permission modes** bā jadval-e chāhār mode: Ask, Accept edits, Plan, Bypass — va
  raftār-e har kodoom barā-ye read/Edit/Bash.
- `CLODECK_PERMISSION_MODE` (default: `default`; maghādir-e mojtāz: `default`, `acceptEdits`, `plan`,
  `bypassPermissions`) va `CLODECK_ALLOW_BYPASS` (default: on) mostanad beshavand.
- Warning-e Bypass shāmel-e in jomle bāshad: *"Every tool runs without asking. A project's own deny/ask
  rules in `.claude/settings.json` will still apply."*
- README digar nagooyad ke clodeck az SDK's native semantics estefāde mikonad (read-only Bash āzād,
  `acceptEdits` filesystem commands āzād, Plan prompts).

**Acceptance criteria:**
- [ ] README yek bakhsh-e permission-modes bā jadval-e chāhār mode dārad.
- [ ] `CLODECK_PERMISSION_MODE` va `CLODECK_ALLOW_BYPASS` bā default va maghādir-e mojtāz mostanad shode-and.
- [ ] Warning-e Bypass jomle-ye project rules rā dārad.
- [ ] Hich jomle-i dar README raftār-e SDK-native rā be onvān-e raftār-e clodeck neshoon nemidahad.
- [ ] `npm run typecheck` and `npm test` pass (docs-only; suite sabz mimānad).

**Out of scope:**
- `AGENTS.md`, `GLOSSARY.md`, ADR — dar ticket 81 land shodan.
- `spec-09-permission-modes.md` — `/to-spec`.
