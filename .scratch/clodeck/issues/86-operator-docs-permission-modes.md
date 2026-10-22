# 86: The operator's docs catch up

**What to build:** README chāhār mode rā, do motaghayyer-e env rā, va warning-e Bypass rā mostanad
mikonad — pas operator bedoone khāndan-e code midānad har mode che ghā'ede-i dārad va che-tori Bypass rā
roshan/khāmoosh konad.

**Blocked by:** 85

**Status:** resolved

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
- [x] README yek bakhsh-e permission-modes bā jadval-e chāhār mode dārad.
- [x] `CLODECK_PERMISSION_MODE` va `CLODECK_ALLOW_BYPASS` bā default va maghādir-e mojtāz mostanad shode-and.
- [x] Warning-e Bypass jomle-ye project rules rā dārad.
- [x] Hich jomle-i dar README raftār-e SDK-native rā be onvān-e raftār-e clodeck neshoon nemidahad.
- [x] `npm run typecheck` and `npm test` pass (docs-only; suite sabz mimānad).

**Out of scope:**
- `AGENTS.md`, `GLOSSARY.md`, ADR — dar ticket 81 land shodan.
- `spec-09-permission-modes.md` — `/to-spec`.

## What landed

- `README.md` — a **Permission modes** section: the four-mode table, the three deliberate deltas, the
  tighten-never-loosen rule, session-state behaviour, and a **Bypass** subsection with its gates, its
  confirm/badge and the warning sentence verbatim; two rows in **Configuration**
  (`CLODECK_PERMISSION_MODE`, `CLODECK_ALLOW_BYPASS`) with defaults and accepted values; a Contents
  entry, the `What you get` Chat row, and a **Security** bullet for the mode being server-enforced.
- The mid-turn paragraph documents what shipped, not what decision 7 promised: the SDK's mode moves at
  once, but clodeck's `PreToolUse` hooks are fixed when the turn starts, so a switch bites on the next
  turn.
- README.finglish.md left as is — its header says `README.md` is the source of truth.
