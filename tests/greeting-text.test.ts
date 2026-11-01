// what a lobby greeting must pass before it may reach the screen
import { describe, expect, it } from "vitest";
import { cleanGreeting, isBlocked, sanitize } from "@/lib/greeting-text";
import { nominees } from "@/data/nominees";

const ok = (t: string) => cleanGreeting(t);

describe("length (checked on the server)", () => {
  it("60 characters pass, 61 are too long", () => {
    expect(ok("ก".repeat(60))).toEqual({ ok: true, text: "ก".repeat(60) });
    expect(ok("ก".repeat(61))).toEqual({ ok: false, reason: "too_long" });
  });

  it("counts characters, not UTF-16 units (an emoji is one)", () => {
    expect(ok("😀".repeat(60)).ok).toBe(true);
    expect(ok("😀".repeat(61))).toEqual({ ok: false, reason: "too_long" });
  });

  it("a huge body is refused outright", () => {
    expect(ok("a".repeat(5000))).toEqual({ ok: false, reason: "too_long" });
  });

  it("empty, blank and non-string input is refused", () => {
    expect(ok("")).toEqual({ ok: false, reason: "empty" });
    expect(ok("   \n\t ")).toEqual({ ok: false, reason: "empty" });
    expect(cleanGreeting(42)).toEqual({ ok: false, reason: "bad_type" });
    expect(cleanGreeting(undefined)).toEqual({ ok: false, reason: "bad_type" });
  });
});

describe("cleaning", () => {
  it("cuts HTML and stray angle brackets", () => {
    expect(sanitize("สวัสดี <b>ทุกคน</b>")).toBe("สวัสดี ทุกคน");
    expect(sanitize('<img src=x onerror="alert(1)">ว่าไง')).toBe("ว่าไง");
    expect(sanitize("a < b > c")).toBe("a c"); // "< b >" reads as a tag
    expect(sanitize("3 > 2 < 5")).toBe("3 2"); // an unclosed "<" swallows the rest: safer than guessing
    expect(sanitize("<script>alert(1)")).toBe("alert(1)");
  });

  it("drops control and invisible characters, flattens whitespace", () => {
    const messy = "ส\u0000วั​ส‮ดี\u0007\n\n  ครับ ทุกคน﻿";
    expect(sanitize(messy)).toBe("สวัสดี ครับ ทุกคน");
  });

  it("limits stacked combining marks (zalgo text)", () => {
    const zalgo = "a" + "́".repeat(40);
    expect(Array.from(sanitize(zalgo)).length).toBe(4);
    expect(sanitize("น้ำ")).toBe("น้ำ"); // real Thai is untouched
  });

  it("leaves ordinary Thai greetings as typed", () => {
    expect(sanitize("  สวัสดีชาว ABC ครับ  ")).toBe("สวัสดีชาว ABC ครับ");
  });
});

describe("swear-word filter (Thai + English)", () => {
  it.each([
    "ไอ้เหี้ย",
    "เหี้ยยยยย",
    "ควยยย",
    "ไอ้สัส",
    "เย็ดแม่",
    "ชิบหาย",
    "ฉิบหายแล้ว",
    "ห่า",
    "แม่ง",
    "เชี่ย",
    "fuck",
    "FUCK you",
    "fuuuuck",
    "f u c k",
    "f.u.c.k",
    "sh1t",
    "b1tch",
    "what the F-U-C-K",
    "asshole",
    "you are a Bastard",
  ])("blocks %s", (t) => {
    expect(cleanGreeting(t)).toEqual({ ok: false, reason: "blocked" });
  });

  it.each([
    "ยินดีต้อนรับทุกคนครับ",
    "ขอให้สนุกกับงานนี้",
    "เชี่ยวชาญมาก", // contains "เชี่ย"
    "กะหรี่ปั๊บอร่อย", // contains "กะหรี่"
    "สาดน้ำกันเลย", // contains "สาด"
    "ห่างไกลแต่ใจใกล้",
    "แม่งานเก่งมาก", // contains "แม่ง"
    "เสือกระดาษ",
    "Pornchai says hi", // a very common Thai name
    "peacock and cocktails",
    "Hello from Class 1",
    "Go AMBER!",
  ])("lets %s through", (t) => {
    expect(cleanGreeting(t).ok).toBe(true);
  });

  it("blocks links, handles and phone numbers", () => {
    for (const t of ["เข้ามาที่ https://x.co", "www.example.com", "ดูที่ shop.com", "ไลน์ @myshop", "โทร 081-234-5678", "0812345678"]) {
      expect(isBlocked(t), t).toBe(true);
    }
    expect(isBlocked("ปีนี้ 2569 สนุกมาก")).toBe(false);
  });
});

// More cases that used to slip through, written with escapes so no invisible
// character sits in this file. The filter is best effort and is not claimed to catch everything.
const cp = (...n: number[]) => String.fromCodePoint(...n);
const tag = (c: string) => cp(0xe0000 + c.charCodeAt(0)); // a Unicode "tag" letter: invisible

describe("filter probes", () => {
  it.each([
    ["fu.ck", "fu.ck"],
    ["sh!t", "sh!t"],
    ["สั้ส (tone mark between)", "สั" + cp(0x0e49) + "ส"],
    ["สัส with a thanthakhat", "สัส" + cp(0x0e4c)],
    ["ควย with an invisible tag letter inside", "ค" + tag("a") + "วย"],
    ["ควย with several tag letters", tag("x") + "ค" + tag("y") + tag("z") + "ว" + tag("q") + "ย"],
    ["fuck with a zero-width joiner", "fu" + cp(0x200d) + "ck"],
    ["fuck with a zero-width space", "fu" + cp(0x200b) + "ck"],
    ["fuck with a soft hyphen", "fu" + cp(0x00ad) + "ck"],
    ["fuck with a variation selector", "fu" + cp(0xfe0f) + "ck"],
    ["fuck with a Mongolian selector", "fu" + cp(0x180b) + "ck"],
    ["fuck with a Hangul filler", "fu" + cp(0x3164) + "ck"],
    ["fuck with a BOM", "fu" + cp(0xfeff) + "ck"],
    ["fuck with a right-to-left override", cp(0x202e) + "fuck"],
    ["full-width ｆｕｃｋ", "ｆｕｃｋ"],
    ["bold maths letters 𝐟𝐮𝐜𝐤", cp(0x1d41f, 0x1d42e, 0x1d41c, 0x1d424)],
    ["accented fúck", "f" + cp(0x00fa) + "ck"],
    ["fuck with a stray combining accent", "fu" + cp(0x0301) + "ck"],
    ["Cyrillic look-alikes fuсk", "fu" + cp(0x0441) + "k"],
    ["Greek look-alikes fυck", "f" + cp(0x03c5) + "ck"],
    ["f@ck", "f@ck"],
    ["f*ck", "f*ck"],
    ["fuuuuuck", "fuuuuuck"],
    ["f-u-c-k", "f-u-c-k"],
    ["f_u_c_k", "f_u_c_k"],
    ["fu ck", "fu ck"],
    ["s h i t", "s h i t"],
    ["sh1t", "sh1t"],
    ["a$$hole", "a$$hole"],
    ["b!tch", "b!tch"],
    ["ALL CAPS FUCK", "FUCK"],
    ["fuck!", "fuck!"],
    ["(fuck)", "(fuck)"],
    ["inside a sentence", "ขอบคุณมากครับ fuck เลย"],
    ["Thai with dots ค.ว.ย", "ค.ว.ย"],
    ["Thai with spaces เ หี้ ย", "เ หี้ ย"],
    ["Thai stretched เหี้ยยยยย", "เหี้ยยยยย"],
    ["Thai digits in a phone number ๐๘๑๒๓๔๕๖๗๘", "โทร ๐๘๑๒๓๔๕๖๗๘"],
  ])("blocks %s", (_name, text) => {
    expect(cleanGreeting(text), _name).toEqual({ ok: false, reason: "blocked" });
  });

  it("never lets an invisible character reach the screen", () => {
    const dirty = "สวัสดี" + tag("a") + tag("b") + cp(0x200b, 0x200d, 0x202e, 0x2066, 0xe000, 0x00ad, 0x180b) + "ครับ";
    const out = sanitize(dirty);
    expect(out).toBe("สวัสดีครับ");
    for (const c of Array.from(out)) expect(c.codePointAt(0)!).toBeLessThan(0xe000);
    expect(cleanGreeting(dirty)).toEqual({ ok: true, text: "สวัสดีครับ" });
  });

  it("ordinary words, names and food still pass", () => {
    for (const t of [
      "เชี่ยวชาญ",
      "กะหรี่ปั๊บ",
      "สาดน้ำ",
      "ห่างไกล",
      "แม่งานเก่ง",
      "เสือกระดาษ",
      "ส.ส. มาแล้ว",
      "ยินดีด้วยครับ 5555",
      "Pornchai & Sussex & Essex",
      "as soon as possible, pass the class",
      "Dickson, Cockburn and Hancock say hi",
      "Scunthorpe, peacock, cocktail",
      "Niger and Nigeria",
      "assistant",
      "Go AMBER! ❤️ " + cp(0x1f389),
    ]) {
      expect(cleanGreeting(t).ok, t).toBe(true);
    }
  });

  it("is honest about its limits: it is a list, not a promise", () => {
    // Spelled with a letter swapped for something this list does not know about, it gets through.
    // The MC switch "ข้อความทักทายขึ้นจอ" exists for exactly this.
    expect(cleanGreeting("phuck").ok).toBe(true);
  });
});

// More separators, the braille blank, and Thai words the list used to hit by accident
describe("recheck: separators and invisible blanks", () => {
  it.each([
    ["f,u,c,k", "f,u,c,k"],
    ["f:u:c:k", "f:u:c:k"],
    ["f·uck (middle dot)", "f" + cp(0x00b7) + "uck"],
    ["f·u·c·k", ["f", "u", "c", "k"].join(cp(0x00b7))],
    ["fuck,you (comma, no space)", "fuck,you"],
    ["fuck: (colon after)", "fuck:"],
    ["fuck + braille blank", "fuck" + cp(0x2800)],
    ["fu + braille blank + ck", "fu" + cp(0x2800) + "ck"],
    ["only braille blanks between letters", ["f", "u", "c", "k"].join(cp(0x2800))],
  ])("blocks %s", (_n, text) => {
    expect(cleanGreeting(text), _n).toEqual({ ok: false, reason: "blocked" });
  });

  it("the braille blank never reaches the screen", () => {
    expect(sanitize("สวัสดี" + cp(0x2800) + "ครับ")).toBe("สวัสดีครับ");
  });
});

describe("recheck: ordinary Thai the list used to hit by accident", () => {
  it.each([
    "จิม",
    "จิมมี่",
    "พี่จิมสู้ๆ",
    "จิมทอมป์สัน",
    "สัสดี",
    "ทหารสัสดี",
    "ขี้หมากฝรั่ง",
    "เคี้ยวขี้หมากฝรั่งอยู่",
    "โหดเหี้ยม",
    "เหี้ยม",
    "ดอกทองหลาง",
  ])("lets %s through", (t) => {
    expect(cleanGreeting(t).ok, t).toBe(true);
  });

  it("still blocks every rude word and QA probe those words sit next to", () => {
    for (const t of [
      "จิ๋ม",
      "สัส",
      "สั" + cp(0x0e49) + "ส",
      "ไอ้สัส",
      "สัสสส",
      "เหี้ย",
      "ไอ้เหี้ย",
      "เหี้ยยยย",
      "เหี้ยมึง", // "เหี้ยม" is only allowed as a word of its own
      "ขี้หมา",
      "ไอ้ขี้หมา",
      "ดอกทอง",
      "ควย",
      "ค" + tag("a") + "วย",
      "fu.ck",
      "sh!t",
      "f u c k",
    ]) {
      expect(cleanGreeting(t), t).toEqual({ ok: false, reason: "blocked" });
    }
  });

  it("no nickname or first name of the 29 nominees is blocked, alone or in a sentence", () => {
    expect(nominees).toHaveLength(29);
    for (const n of nominees) {
      for (const name of [n.nickname, n.firstName]) {
        for (const text of [name, `ยินดีด้วยนะ ${name}`, `${name}สู้ๆ`, `Go ${name} ${n.group}!`, `${name},${name}`]) {
          expect(cleanGreeting(text).ok, text).toBe(true);
        }
      }
    }
  });
});
