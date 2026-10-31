// fix9: what a lobby greeting must pass before it may reach the screen
import { describe, expect, it } from "vitest";
import { cleanGreeting, isBlocked, sanitize } from "@/lib/greeting-text";

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
    expect(sanitize("  สวัสดีชาว EVENT ครับ  ")).toBe("สวัสดีชาว EVENT ครับ");
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
