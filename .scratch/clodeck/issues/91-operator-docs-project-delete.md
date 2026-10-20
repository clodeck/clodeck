# 91: Operator docs for deleting a project

**What to build:** Operator documentation barāy-e hazf-e project, kenār-e chiz-hā-i ke barāy-e sākhtan-e
project az ghabl neveshte shode. In ticket hich raftāri rā avaz nemikonad; bayān mikonad ke product chi
kār mikonad va che residue-i jā migozārad.

**Blocked by:** 89 (the route), 90 (the sidebar flow)

**Status:** ready-for-agent

- [ ] Docs migooyand ke hazf az sidebar (row menu → `Delete…`) **vāghean** directory rā pāk mikonad:
      recursive, bedoone trash va bedoone undo.
- [ ] Docs migooyand ke yek run-e zende yā yek terminal-e attached hazf rā bā `409` rad mikonad, va kārbār
      bāyad avval stop konad; `409` hich chiz rā kill nemikonad.
- [ ] Docs migooyand ke project-i ke az tarigh-e symlink resid mishavad hazf nashavad va chera.
- [ ] Docs migooyand ke transcript-hā-ye SDK zir-e `~/.claude/projects` bāqi mimānanad va clodeck ānhā rā
      pāk nemikonad — yani disk-e yek project-e hazf-shode kamel āzād nemishavad.
- [ ] Docs migooyand ke project-i ke bā hamān esm dobāre sākhte mishavad momken ast session-hā-ye ghadimi rā
      dar History neshoon bedahad, vali awwalin send tāze shoru mishavad (resume faghat bā dokme).
- [ ] `npm run typecheck` and `npm test` pass.
