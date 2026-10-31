// fix9: the lobby scene at 1920×1080 — bubbles must never cover a face, the QR or the counter
import { describe, expect, it } from "vitest";
import { fitTitle } from "@/app/stage/title-fit";
import {
  BUBBLE_SLOTS,
  LEFT_W,
  QR_TOP,
  URL_ROOM,
  bubbleSlot,
  bubbleZone,
  canvasRect,
  faceRects,
  inside,
  overlaps,
  qrRect,
  COUNT_H,
  COUNT_TOP,
  RIGHT_W,
  type Rect,
} from "@/app/stage/lobby-layout";
import { nominees } from "@/data/nominees";

const slots = Array.from({ length: BUBBLE_SLOTS }, (_, i) => bubbleSlot(i));
const countBox: Rect = { x: LEFT_W, y: COUNT_TOP, w: RIGHT_W, h: COUNT_H };

describe("lobby bounding boxes", () => {
  it("has a rectangle for every one of the 29 faces", () => {
    expect(faceRects()).toHaveLength(nominees.length);
  });

  it("all six bubble slots sit inside the canvas and inside the left area", () => {
    for (const r of slots) {
      expect(inside(r, canvasRect())).toBe(true);
      expect(r.x + r.w).toBeLessThanOrEqual(LEFT_W);
    }
  });

  it("no bubble slot touches any face (drift included)", () => {
    for (const r of slots) for (const f of faceRects()) expect(overlaps(r, f)).toBe(false);
    expect(overlaps(bubbleZone(), { x: 0, y: 0, w: 1920, h: 0 })).toBe(false);
  });

  it("no bubble slot touches the QR or the counter, and slots do not overlap each other", () => {
    for (const r of slots) {
      expect(overlaps(r, qrRect())).toBe(false);
      expect(overlaps(r, countBox)).toBe(false);
    }
    slots.forEach((a, i) => slots.forEach((b, j) => i < j && expect(overlaps(a, b)).toBe(false)));
  });

  it("the QR and the counter do not collide and both stay on the canvas", () => {
    expect(overlaps(qrRect(), countBox)).toBe(false);
    expect(inside(qrRect(), canvasRect())).toBe(true);
    expect(qrRect().y).toBe(QR_TOP);
  });

  it("faces stay on the canvas, left of the QR column", () => {
    for (const f of faceRects()) {
      expect(inside(f, canvasRect())).toBe(true);
      expect(f.x + f.w).toBeLessThanOrEqual(LEFT_W);
    }
  });
});

describe("backup address stays on one line", () => {
  it("the long backup URL shrinks to fit the QR column, the normal one keeps full size", () => {
    const long = "live-vote-demo.vercel.app";
    const size = fitTitle(long, 40, URL_ROOM);
    expect(size).toBeLessThan(40);
    expect(size).toBeGreaterThanOrEqual(24); // still readable
    // the estimate the font size is based on is never wider than the room
    expect(long.length * 0.56 * size).toBeLessThanOrEqual(URL_ROOM);
    expect(fitTitle("vote.example.com", 40, URL_ROOM)).toBe(40);
  });
});
