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

// Control characters, zero-width and bidi tricks: they cannot be read, only used to dodge the filter
// or to flip the text around. Tab/newline become spaces first.
const INVISIBLE_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x001f], // C0 controls
  [0x007f, 0x009f], // DEL + C1 controls
  [0x00ad, 0x00ad], // soft hyphen
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180b, 0x180f],
  [0x200b, 0x200f], // zero-width space/joiners, direction marks
  [0x2028, 0x202f], // line/paragraph separators, bidi embeddings
  [0x205f, 0x206f],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f], // variation selectors
  [0xfeff, 0xfeff], // BOM / zero-width no-break space
  [0xfff9, 0xfffc],
];
const isInvisible = (c: string) => {
  const cp = c.codePointAt(0)!;
  return INVISIBLE_RANGES.some(([a, b]) => cp >= a && cp <= b);
};
const removeInvisible = (s: string) => chars(s).filter((c) => !isInvisible(c)).join("");
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
  const cleaned = removeInvisible(stripHtml(spaced)).replace(/ +/g, " ").trim();
  return limitMarks(cleaned);
}

// Look-alike symbols people use to slip past a filter
const LOOKALIKE: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i" };

function squeeze(s: string): string {
  // "fuuuuck" → "fuck", "เหี้ยยยย" → "เหี้ย" — runs of the same character become one
  return s.replace(/(.)\1+/gu, "$1");
}

// Every spelling the filter compares against: lower case, no marks-free tricks, no spaces
function compact(text: string): string {
  return squeeze(text.toLowerCase().replace(/[\s.,_\-*'"`~|/\\()[\]{}:;?+=^%&#]/g, ""));
}

const THAI_WORDS = THAI_SUBSTRING.map(compact);

// Links and phone numbers do not belong on a projector wall
const LINK = /(https?:|www\.|[a-z0-9-]+\.(com|net|org|co|th|io|me|link)\b|line\.me|@[a-z0-9_.]{3,})/i;
const LONG_NUMBER = /(\d[\s-]?){9,}/;

export function isBlocked(text: string): boolean {
  if (LINK.test(text) || LONG_NUMBER.test(text)) return true;

  const lower = text.toLowerCase();
  const flat = compact(lower);
  if (THAI_WORDS.some((w) => flat.includes(w))) return true;

  // Whole words, split on anything that is not a letter, so "ห่า" alone is caught but "ห่างไกล" is not
  const words = lower
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean);
  const wholeThai = new Set(THAI_WHOLE_WORD.map(compact));
  const english = new Set(ENGLISH_WORDS.map(compact));
  for (const w of words) {
    const c = squeeze(w);
    if (wholeThai.has(c) || english.has(c)) return true;
    const mapped = squeeze(w.replace(/[0-9@$!]/g, (ch) => LOOKALIKE[ch] ?? ch));
    if (mapped !== c && english.has(mapped)) return true;
  }
  // "f u c k" / "s.h.i.t": a run of single letters reads as one word. Only runs, so a Latin name such
  // as "Pornchai" (a common Thai name) is never cut open and searched for a rude word inside.
  let run = "";
  for (const w of [...words, ""]) {
    if (chars(w).length === 1) {
      run += w;
      continue;
    }
    if (run.length >= 3 && english.has(squeeze(run.replace(/[0-9@$!]/g, (ch) => LOOKALIKE[ch] ?? ch)))) return true;
    run = "";
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
