// Lobby greetings (fix9): cleaning, length and the swear-word filter. Pure functions, no I/O, so the
// server route and the unit tests share one set of rules. The server is the one that decides.
import { ENGLISH_WORDS, THAI_SUBSTRING, THAI_WHOLE_WORD } from "@/lib/server/profanity-words";
import { GREETING_MAX_CHARS } from "@/lib/types";

// Anything longer than this is not a typing slip — refuse before doing any work on it
const RAW_LIMIT = 400;
// Real Thai stacks at most consonant + vowel + tone mark; more is "zalgo" text that overflows its bubble
const MAX_MARKS_IN_A_ROW = 3;

export type Cleaned =
  | { ok: true; text: string }
  | { ok: false; reason: "empty" | "too_long" | "blocked" | "bad_type" };

const chars = (s: string) => Array.from(s);

// Characters nobody can read: only used to dodge the filter or to flip the text around. Everything
// Unicode files under "other" (controls Cc, format Cf — zero-width, bidi, the U+E0000 tag block, BOM —,
// private use, surrogates, unassigned) plus the few invisible fillers/selectors that are filed as
// letters or marks. Written as code-point ranges, never as literal characters in this file.
const OTHER = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Cn}]/gu;
const INVISIBLE_RANGES: readonly (readonly [number, number])[] = [
  [0x034f, 0x034f], // combining grapheme joiner
  [0x115f, 0x1160], // Hangul fillers
  [0x17b4, 0x17b5], // Khmer inherent vowels
  [0x180b, 0x180f], // Mongolian free variation selectors
  [0x2028, 0x202f], // line/paragraph separators, bidi embeddings, narrow no-break space
  [0x205f, 0x206f],
  [0x3164, 0x3164], // Hangul filler
  [0xfe00, 0xfe0f], // variation selectors
  [0xffa0, 0xffa0], // halfwidth Hangul filler
  [0xe0100, 0xe01ef], // variation selectors supplement
];
const isInvisible = (c: string) => {
  const cp = c.codePointAt(0)!;
  return INVISIBLE_RANGES.some(([a, b]) => cp >= a && cp <= b);
};
const removeInvisible = (s: string) => chars(s.replace(OTHER, "")).filter((c) => !isInvisible(c)).join("");
const MARK = /\p{M}/u;

function limitMarks(s: string): string {
  let run = 0;
  let out = "";
  for (const c of chars(s)) {
    run = MARK.test(c) ? run + 1 : 0;
    if (run <= MAX_MARKS_IN_A_ROW) out += c;
  }
  return out;
}

// Cut tags, then any stray angle bracket: the stage renders text nodes only, this is the second lock
export function stripHtml(s: string): string {
  return s.replace(/<[^>]*>?/g, " ").replace(/[<>]/g, " ");
}

export function sanitize(raw: string): string {
  // Every kind of whitespace (tab, newline, U+2028…) becomes a plain space before the invisible
  // characters are dropped, so words never glue together
  const spaced = raw.normalize("NFC").replace(/\s/g, " ");
  const cleaned = stripHtml(removeInvisible(spaced)).replace(/ +/g, " ").trim();
  return limitMarks(cleaned);
}

// ---- the swear-word filter ----
// It compares a *folded copy* of the text; what is shown is the sanitised text above, untouched.
// This is a best-effort filter, not a guarantee: people are inventive, Thai has no spaces between
// words, and a list can only hold what someone thought of. The MC switch is the real safety net.

// Letters that look like Latin ones (Cyrillic/Greek) — the usual way to slip "fuck" past a list
const LOOKALIKE_LETTERS: Record<string, string> = {
  а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x", і: "i", ї: "i", ј: "j", ѕ: "s",
  α: "a", β: "b", ε: "e", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x",
};
const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";

// NFKC (full-width, ligatures, styled letters), lower case, accents off Latin letters, look-alike
// letters mapped, Thai digits to ASCII
function fold(raw: string): string {
  let out = "";
  let prevLatin = false;
  for (const ch of chars(raw.normalize("NFKC"))) {
    if (/\p{Script=Latin}/u.test(ch)) {
      out += ch.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
      prevLatin = true;
      continue;
    }
    if (MARK.test(ch) && prevLatin) continue; // a stray accent after a Latin letter
    prevLatin = false;
    const lower = ch.toLowerCase();
    const digit = THAI_DIGITS.indexOf(ch);
    out += digit >= 0 ? String(digit) : (LOOKALIKE_LETTERS[lower] ?? lower);
  }
  return out;
}

// Thai: also without tone marks / thanthakhat / the other U+0E47–0E4E marks ("สั้ส" = "สัส"), and
// without anything that is not a letter or digit — the text is compared as one run, because Thai
// has no spaces to cut words on
const flatKey = (s: string) => fold(s).replace(/[\u0E47-\u0E4E]/g, "").replace(/[^\p{L}\p{N}\p{M}]/gu, "");

// Every character may be repeated: "เหี้ยยยย", "fuuuck". Written as a pattern so "ass" never turns
// into "as" (squeezing both sides would block the ordinary word)
const repeated = (key: string) => chars(key).map((c) => `${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}+`).join("");
const THAI_SUBSTRING_RE = THAI_SUBSTRING.map((w) => new RegExp(repeated(flatKey(w))));
const THAI_WHOLE_RE = new RegExp(`^(?:${THAI_WHOLE_WORD.map((w) => repeated(flatKey(w))).join("|")})$`);

// English letters and what people write instead: f@ck, sh!t, a$$, b1tch, f*ck
const CLASS: Record<string, string> = {
  a: "[a4@*]", e: "[e3*]", i: "[i1!|*]", o: "[o0*]", u: "[uv@*]", s: "[s5$]", t: "[t7+]", l: "[l1|]", b: "[b8]", g: "[g9]",
};
const englishRe = (w: string) => new RegExp(`^${chars(w).map((c) => `${CLASS[c] ?? c}+`).join("")}$`);
const ENGLISH_RE = ENGLISH_WORDS.map(englishRe);
const matchesEnglish = (token: string) => {
  const t = token.replace(/[._\-'`~/\\]/g, "").replace(/^[!?,;:"()[\]{}]+|[!?,;:"()[\]{}]+$/g, "");
  return t.length > 0 && ENGLISH_RE.some((re) => re.test(t));
};

// Links and phone numbers do not belong on a projector wall
const LINK = /(https?:|www\.|[a-z0-9-]+\.(com|net|org|co|th|io|me|link)\b|line\.me|@[a-z0-9_.]{3,})/i;
const LONG_NUMBER = /(\d[\s-]?){9,}/;

export function isBlocked(text: string): boolean {
  const folded = fold(text);
  if (LINK.test(folded) || LONG_NUMBER.test(folded)) return true;

  // Thai (and anything else written without spaces): rude words anywhere inside the run …
  const flat = flatKey(text);
  if (THAI_SUBSTRING_RE.some((re) => re.test(flat))) return true;
  // … short ones only as a whole word, so "เชี่ยวชาญ" or "สาดน้ำ" stay fine
  const tokens = folded.split(/\s+/).filter(Boolean);
  if (tokens.some((t) => THAI_WHOLE_RE.test(flatKey(t)))) return true;

  // English: whole words, written plainly or dressed up, then runs of short pieces read as one word
  // ("f u c k", "fu ck", "sh it") — only pieces of up to 3 characters, so ordinary names never merge
  if (tokens.some(matchesEnglish)) return true;
  for (let i = 0; i < tokens.length; i++) {
    let joined = "";
    for (let j = i; j < Math.min(tokens.length, i + 6); j++) {
      if (chars(tokens[j]).length > 3) break;
      joined += tokens[j];
      if (j > i && matchesEnglish(joined)) return true;
    }
  }
  return false;
}

// What /api/greeting does with the text before anything is published
export function cleanGreeting(input: unknown): Cleaned {
  if (typeof input !== "string") return { ok: false, reason: "bad_type" };
  if (input.length > RAW_LIMIT) return { ok: false, reason: "too_long" };
  const text = sanitize(input);
  if (text.length === 0) return { ok: false, reason: "empty" };
  if (chars(text).length > GREETING_MAX_CHARS) return { ok: false, reason: "too_long" };
  if (isBlocked(text)) return { ok: false, reason: "blocked" };
  return { ok: true, text };
}
