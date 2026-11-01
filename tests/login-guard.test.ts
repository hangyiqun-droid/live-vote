// a guest guessing the MC passcode on the venue Wi-Fi must never lock the MC out
import { beforeEach, describe, expect, it } from "vitest";
import {
  canTry,
  FREE_FAILS,
  IP_FLOOD_FAILS,
  mintTag,
  parseTag,
  recordFail,
  recordSuccess,
  resetLoginGuard,
  waitAfter,
} from "@/lib/server/login-guard";

const VENUE_IP = "203.0.113.7";
const tag = (now: number) => parseTag(mintTag(now))!;

describe("login tag cookie", () => {
  it("round-trips and rejects tampering", () => {
    const v = mintTag(1_000);
    expect(parseTag(v)).toEqual({ id: v.split(".").slice(0, 2).join("."), issuedAt: 1_000 });
    const [t, r, sig] = v.split(".");
    expect(parseTag(`0.${r}.${sig}`)).toBeNull(); // back-dating the tag breaks the signature
    expect(parseTag(`${t}.${r}.${sig.slice(1)}x`)).toBeNull();
    expect(parseTag("junk")).toBeNull();
    expect(parseTag(undefined)).toBeNull();
  });
});

describe("login guard", () => {
  beforeEach(() => resetLoginGuard());

  it("lets a few typos through, then slows the same browser down step by step", () => {
    expect(waitAfter(FREE_FAILS - 1)).toBe(0);
    expect(waitAfter(FREE_FAILS)).toBe(15_000);
    expect(waitAfter(FREE_FAILS + 1)).toBe(30_000);
    expect(waitAfter(50)).toBe(5 * 60_000);

    const now = 1_000_000;
    const guest = tag(now);
    for (let i = 1; i < FREE_FAILS; i++) expect(recordFail(VENUE_IP, guest, now)).toBe(0);
    expect(canTry(VENUE_IP, guest, now).ok).toBe(true);
    expect(recordFail(VENUE_IP, guest, now)).toBe(15_000);
    expect(canTry(VENUE_IP, guest, now + 1_000)).toEqual({ ok: false, retryAfter: 14 });
    expect(canTry(VENUE_IP, guest, now + 15_001).ok).toBe(true);
  });

  it("a guest locked out on the shared Wi-Fi does not lock the MC on the same IP", () => {
    const now = 2_000_000;
    const mc = tag(now - 60_000);
    const guest = tag(now);
    for (let i = 0; i < 10; i++) recordFail(VENUE_IP, guest, now);
    expect(canTry(VENUE_IP, guest, now).ok).toBe(false);
    expect(canTry(VENUE_IP, mc, now).ok).toBe(true);
  });

  it("a script minting fresh browsers is refused, but a browser opened before the flood still gets in", () => {
    const now = 3_000_000;
    const mc = tag(now - 5_000);
    for (let i = 0; i < IP_FLOOD_FAILS; i++) recordFail(VENUE_IP, tag(now + i), now + i);
    const fresh = tag(now + 100);
    const gate = canTry(VENUE_IP, fresh, now + 100);
    expect(gate.ok).toBe(false);
    expect(canTry(VENUE_IP, mc, now + 100).ok).toBe(true);
    // Another IP (MC on mobile data) is untouched
    expect(canTry("198.51.100.1", fresh, now + 100).ok).toBe(true);
    // Ten quiet minutes later the venue is open again
    expect(canTry(VENUE_IP, tag(now + 11 * 60_000), now + 11 * 60_000).ok).toBe(true);
  });

  it("a right passcode clears that browser's record", () => {
    const now = 4_000_000;
    const mc = tag(now);
    for (let i = 0; i < FREE_FAILS - 1; i++) recordFail(VENUE_IP, mc, now);
    recordSuccess(mc);
    expect(recordFail(VENUE_IP, mc, now)).toBe(0);
  });
});
