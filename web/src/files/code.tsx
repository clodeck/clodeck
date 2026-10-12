import type { ReactElement } from 'react';

import { assertNever } from './reducer';

/**
 * The code view: a line-number gutter and the prototype's deliberately rough
 * syntax colouring (`common.js:97-119`), for reading a file's source in. It sits
 * beside `markdown.tsx` as the other way a file's bytes can be *shown*, and it is
 * the only viewer that draws them line by line.
 *
 * **The colouring is not a parser, and it is not an injection point.** Both
 * halves of the tokenizer are pure — a line and a language in, a list of segments
 * out — and the segments are rendered as React text nodes, so a file's markup is
 * content here exactly as it is in the plain `<pre>` this replaces. The prototype
 * built `<span class="c-kw">` strings and set them with `innerHTML`; nothing in
 * this module builds a string of markup at all, which is what `spec-04` pins.
 */

/** The two colouring passes the prototype has — see {@link LANGUAGES}. */
export type Language = 'markdown' | 'code';

/** What one run of a line is: the four colour classes, or nothing claimed. */
export type SegmentKind = 'plain' | 'comment' | 'string' | 'keyword' | 'number';

/** One run of a line, as text. Rendering is the caller's; this carries no markup. */
export interface Segment {
  readonly text: string;
  readonly kind: SegmentKind;
}

/**
 * Extension → the pass that colours it. There are only two, because the
 * prototype's `langFor` ids never changed what `highlight` did beyond `md`: every
 * code language got the same one rough pass. So the map carries the *pass*, not
 * the language name.
 *
 * **An extension that is not listed renders plain.** That is the one place this
 * goes past its reference, whose `langFor` fell back to TypeScript and so tinted
 * every extensionless file (`Makefile`, `LICENSE`, a `.txt`) as though it were
 * code. Mostly a file with no extension has no colour to claim.
 */
const LANGUAGES: Record<string, Language> = {
  ts: 'code',
  tsx: 'code',
  js: 'code',
  jsx: 'code',
  json: 'code',
  css: 'code',
  html: 'code',
  sh: 'code',
  py: 'code',
  yml: 'code',
  yaml: 'code',
  md: 'markdown',
  markdown: 'markdown',
};

/**
 * The pass a file gets from its name, or `null` for one nothing claims — which
 * is the plain render, gutter and all. The last dotted segment decides, so
 * `a.test.ts` is TypeScript and a dotfile (`~/.bashrc`) claims nothing.
 */
export function languageOf(name: string): Language | null {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return null;
  return LANGUAGES[name.slice(dot + 1).toLowerCase()] ?? null;
}

/** The prototype's keyword list verbatim (`common.js:98`), including its `describe`/`it`/`expect`. */
const KEYWORDS =
  'const|let|var|function|return|if|else|for|of|in|await|async|new|class|import|from|export|default|type|interface|extends|implements|try|catch|throw|typeof|null|true|false|undefined|this|as|void|describe|it|expect';

/**
 * The prototype's one code pass, as named alternations: a `//` comment runs to
 * the end of the line, a string is a quoted run (backtick, single or double
 * quotes), a keyword is one of {@link KEYWORDS}, and a number is a run of digits
 * with at most one decimal point. Order is the prototype's and it matters — the
 * scan tries a comment first, so `// "quotes"` is a comment, and a string before
 * a keyword, so `"return"` is a string.
 */
const CODE = new RegExp(
  '(?<comment>\\/\\/.*$)' +
    "|(?<string>`[^`]*`|'[^']*'|\"[^\"]*\")" +
    `|\\b(?<keyword>${KEYWORDS})\\b` +
    '|\\b(?<number>\\d+(?:\\.\\d+)?)\\b',
  'g',
);

/** Which colour each of {@link CODE}'s alternations claims. */
const CODE_KINDS: Record<string, SegmentKind> = {
  comment: 'comment',
  string: 'string',
  keyword: 'keyword',
  number: 'number',
};

/** A markdown bold run — the prototype's second markdown rule. */
const BOLD = /(?<bold>\*\*[^*]+\*\*)/g;

/** A markdown heading, and a markdown blockquote: the prototype's other two rules. */
const HEADING = /^#{1,6} /;
const QUOTE = /^> /;

/**
 * One line of a file, as segments. `null` (nothing claims the extension) is one
 * plain segment, so the gutter row is the only thing that changes for it.
 */
export function highlightLine(line: string, language: Language | null): Segment[] {
  switch (language) {
    case null:
      return [{ text: line, kind: 'plain' }];
    case 'markdown': {
      // The prototype's three markdown rules run in sequence over an escaped
      // string, but only one of them can start a line — a heading never also
      // opens `>`. So the line's *base* is whichever of them owns its first
      // character, and bold — the only rule that matches mid-line — becomes the
      // override on top of it, which is what the prototype's nesting did too.
      const base: SegmentKind = HEADING.test(line) ? 'keyword' : QUOTE.test(line) ? 'comment' : 'plain';
      return split(line, BOLD, { bold: 'string' }, base);
    }
    case 'code':
      return split(line, CODE, CODE_KINDS, 'plain');
    default:
      return assertNever(language);
  }
}

/**
 * Split a line at every match of `pattern`, each match taking the kind its group
 * names in `kinds`; whatever lies between matches keeps `base`. Both languages
 * above are this one scan with a different pattern, which is the whole of what
 * "colouring" means here — and it never rewrites the line, so the segments join
 * back up into exactly the file's own bytes.
 */
function split(line: string, pattern: RegExp, kinds: Record<string, SegmentKind>, base: SegmentKind): Segment[] {
  const segments: Segment[] = [];
  let end = 0;

  for (const match of line.matchAll(pattern)) {
    const at = match.index;
    if (at > end) segments.push({ text: line.slice(end, at), kind: base });
    segments.push({ text: match[0], kind: kindOf(match.groups, kinds, base) });
    end = at + match[0].length;
  }

  // The tail — and an empty line, which is a plain segment holding nothing
  // rather than no segment at all, so the row is still a row.
  if (end < line.length || segments.length === 0) segments.push({ text: line.slice(end), kind: base });
  return segments;
}

/** Which alternation matched: the first group that took part, named by `kinds`. */
function kindOf(
  groups: Record<string, string | undefined> | undefined,
  kinds: Record<string, SegmentKind>,
  base: SegmentKind,
): SegmentKind {
  for (const [name, value] of Object.entries(groups ?? {})) {
    if (value !== undefined) return kinds[name] ?? base;
  }
  return base;
}

/**
 * The colour of each segment kind, as the palette tokens `index.css` adds beside
 * its own (`text-code-*`). No hex lives here: the tokens are the one place these
 * colours are written down, so the view and the palette cannot drift apart.
 */
const TONE: Record<SegmentKind, string> = {
  plain: '',
  comment: 'text-code-com italic',
  string: 'text-code-str',
  keyword: 'text-code-kw',
  number: 'text-code-num',
};

/**
 * The source of a text file, one line per row: its number in a gutter, then the
 * line itself, coloured segment by segment.
 *
 * Three things about the layout are the point rather than the styling:
 *
 * - The gutter is `select-none` and `aria-hidden`, so a copy or a selection
 *   takes the file's bytes and not its line numbers.
 * - It scrolls **with** the content — it is part of the row, not a sticky column
 *   beside a viewport — and its width is fixed from the line count, so the code
 *   starts at the same x on line 9 as on line 10.
 * - Nothing soft-wraps: a long line overflows and the column scrolls sideways,
 *   which is what keeps a row's number next to the row's own text.
 */
export function CodeView({ content, name }: { content: string; name: string }): ReactElement {
  const language = languageOf(name);
  const lines = content.split('\n');

  return (
    <ol aria-label="Source" className="list-none p-2 font-mono text-[11px] leading-relaxed text-ink">
      {lines.map((line, index) => (
        <li key={index} className="flex">
          <span
            aria-hidden="true"
            className="shrink-0 select-none pr-3 text-right text-code-ln"
            style={{ width: `${String(lines.length).length}ch` }}
          >
            {index + 1}
          </span>
          <span className="whitespace-pre">
            {highlightLine(line, language).map((segment, at) => (
              <span key={at} className={TONE[segment.kind]}>
                {segment.text}
              </span>
            ))}
          </span>
        </li>
      ))}
    </ol>
  );
}
