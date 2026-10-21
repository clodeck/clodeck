# 88: A confirmation that needs the name typed

**What to build:** Yek prefactor, bedoone hich delete. Dialog-e esm-e mojood yek hāl-e jadid migirad ke
tāyid kardan rā be **tāyp kardan-e esm** vābaste mikonad: tā vaghti meghdār-e vāred-shode daghighan va
**case-sensitive** bā esm-e khāsté yeksān nashode, dokme-e tāyid qāfel ast. Dialog hamchenin yek khat-e
**masir** va yek warning-e "in kār bargasht-napazir ast" neshoon midahad.

In ticket vojood dārad tā 90 dar morede **flow** bāshad, na dar morede yek primitive-e jadid:
"Make the change easy, then make the easy change."

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] Vāgh-ti dialog bā yek esm-e lazemi sākhte mishavad, dokme-e tāyid bā meghdār-e khāli, nāqes, yā bā
      horuf-e koochak/bozorg-e eshtebāh **qāfel** ast; bā match-e daghigh **fā'āl** mishavad.
- [x] Dialog mitavānad dar kenār-e field yek khat-e masir va yek warning-e bargasht-napazir neshoon
      bedahad; masir vojud nadashte bāshad khat ham nist.
- [x] Cancel dar har hāl mojood ast va hich kāri nemikonad; component hich request-i be network nemifrestad.
- [x] Estefāde-hā-ye mojood-e dialog-e esm-e bāghi **bedoone taghir** kar mikonand (mode-e typed-name
      opt-in ast).
- [x] Test-ha dar suite-e dialog: qāfel → tāyp → fā'āl (ba harf-e bozorg eshtebāh qāfel mimānad), va
      masir/cancel.
- [x] `npm run typecheck` and `npm test` pass.
