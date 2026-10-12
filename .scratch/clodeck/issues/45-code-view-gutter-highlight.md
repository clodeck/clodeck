# 45: The code view gets line numbers and rough colour

**What to build:** A file renders as a wall of monochrome `<pre>` text. Bring back the prototype's code
view: a line-number gutter and the rough syntax colouring that made the prototype readable — the
finishing piece that makes download (42) and preview (43) feel like a real viewer.

**Blocked by:** 36

**Status:** resolved

- [x] A line-number gutter runs down the code column, aligned to the text, out of the selection, and it
      scrolls with the content rather than staying fixed to the viewport.
- [x] Source mode stops soft-wrapping: lines that overflow scroll horizontally, which is what keeps the
      gutter aligned with a line's content.
- [x] Lines are coloured by language from the extension (a small extension→language map; unknown
      extensions render plain), colouring comments, strings, keywords and numbers — the prototype's
      deliberately rough pass, not a parser.
- [x] The highlight colours are palette tokens added to `index.css` beside the existing ones, taken from
      the prototype's class set, not literals scattered in the component.
- [x] **Colouring must not become an HTML injection point.** Escaping happens first and the coloured
      segments are React elements; nothing in the viewer sets `innerHTML` or
      `dangerouslySetInnerHTML` — `spec-04` pins file content to text-node rendering, and that pin is
      not weakened by prettier output.
- [x] A truncated file is highlighted as far as it goes, with today's truncation note still shown.
- [x] If 43 has landed, the gutter and colouring apply only to source mode — preview is formatted
      markdown, which has no line numbers.
- [x] Tests: the highlighter is pure (`line + language → segments`) and unit-tested over a comment /
      string / keyword / number sample plus an input containing markdown-ish or script-ish text that must
      come out escaped; a rendered test asserts a gutter line count matching the file.

**Landed as:** `web/src/files/code.tsx` — `languageOf(name)` (extension → the one of two colouring
passes the prototype really has), the pure `highlightLine(line, language) → Segment[]`, and the
`CodeView` that draws it: an `<ol aria-label="Source">` with one row per line, the number in a gutter
whose width comes from the line count (`${String(lines.length).length}ch`, so it is one column whatever
the digits, and the code starts at the same x on line 9 as on line 10), `select-none` and `aria-hidden`
so a copy takes the file's bytes and not its numbers, with the line beside it in `whitespace-pre`. Five
tokens joined the palette in `index.css`
(`--color-code-kw/-str/-com/-num/-ln`, the prototype's `.c-kw`/`.c-str`/`.c-com`/`.c-num`/`.ln` values),
and the `npm run build` bundle emits both them and their `text-code-*` utilities. Seen in the browser:
`evidence/45-code-view.png`.

**Two interpretations worth naming:**

1. **"Unknown extensions render plain" is a deliberate departure** from the reference: its `langFor`
   fell back to `ts`, so `Makefile`, `LICENSE` and every `.txt` were tinted as though they were code.
   Here an extension the map does not list gets the gutter and one plain segment.
2. **The prototype's three markdown rules collapse into one line shape plus an override.** They ran in
   sequence over an escaped string and nested their spans; here the line's base kind is whichever rule
   owns its first character (heading → keyword, quote → comment) and a bold run overrides it — the same
   colours the nesting produced, without spans inside spans.

## Reference

Prototype: `prototype/common.js:97-119` (`highlight`, `KW`) and the line gutter at `:99-119`;
`prototype/styles.css` class set (`.c-com`, `.c-str`, `.c-kw`, `.c-num`). Parity item: P2 #24 — the only
P2 item selected for ticketing.
