// Lobby scene geometry on the fixed 1920×1080 stage canvas (fix9). One source for the component
// styles and for tests/lobby-layout.test.ts, so "bubbles never cover a face or the QR" is checked by
// arithmetic, and scripts/shot-fix9.ts re-checks it against the real DOM.
import { GROUPS, nominees } from "@/data/nominees";
import { H, W } from "./geometry";

export type Rect = { x: number; y: number; w: number; h: number };

export const RIGHT_W = 620; // QR column
export const LEFT_W = W - RIGHT_W; // title, faces, bubble zone

export const TITLE_TOP = 34;
export const ROWS_TOP = 196;
export const FACE_W = 96;
export const FACE_H = 128;
export const FACE_GAP = 22;
export const ROW_GAP = 16;
export const GROUP_LABEL_W = 150;
export const FLOAT = 7; // faces drift ±7 px (stage.module.css `float`)

// Right column, top to bottom
export const COUNT_TOP = 34;
export const COUNT_H = 236;
export const QR_PX = 360; // at least this wide (SPEC 4.1): readable from the back of the room
export const QR_MAX_PX = 400; // whole-module rounding may add up to one module's width (≈ 11 px); layout reserves this
export const QR_PAD = 18;
export const QR_TOP = 290;
export const QR_BOX = QR_MAX_PX + QR_PAD * 2;
export const URL_ROOM = 560; // the address must stay on one line inside this width
export const RIGHT_TEXT_LEFT = 1340; // the QR column's text (hint, address, wait line) never starts left of this; bubbles end 18 px short of it

// Bubble zone: 3 columns × 2 rows of fixed slots under the faces (fix10: each slot is a speech bubble
// of BUBBLE_BODY_H plus a tail of BUBBLE_TAIL_H pointing down; the tail is part of the slot)
export const BUBBLE_COLS = 3;
export const BUBBLE_ROWS = 2;
export const BUBBLE_W = 410;
export const BUBBLE_TAIL_H = 12;
export const BUBBLE_BODY_H = 124;
export const BUBBLE_H = BUBBLE_BODY_H + BUBBLE_TAIL_H;
export const BUBBLE_GAP_X = 26;
export const BUBBLE_GAP_Y = 2;
export const BUBBLE_ZONE_LEFT = 36;
export const BUBBLE_ZONE_TOP = 790;
export const BUBBLE_SLOTS = BUBBLE_COLS * BUBBLE_ROWS;
// How far a bubble drifts up over its life: the top row has the faces above it, the bottom row the tails of the top row
export const BUBBLE_RISE = [14, 14, 14, 4, 4, 4] as const;

export const bubbleSlot = (i: number): Rect => ({
  x: BUBBLE_ZONE_LEFT + (i % BUBBLE_COLS) * (BUBBLE_W + BUBBLE_GAP_X),
  y: BUBBLE_ZONE_TOP + Math.floor(i / BUBBLE_COLS) * (BUBBLE_H + BUBBLE_GAP_Y),
  w: BUBBLE_W,
  h: BUBBLE_H,
});

export const bubbleZone = (): Rect => {
  const last = bubbleSlot(BUBBLE_SLOTS - 1);
  return { x: BUBBLE_ZONE_LEFT, y: BUBBLE_ZONE_TOP, w: last.x + last.w - BUBBLE_ZONE_LEFT, h: last.y + last.h - BUBBLE_ZONE_TOP };
};

// Every face box, drift included (rows are centred inside the left area)
export function faceRects(): Rect[] {
  const out: Rect[] = [];
  GROUPS.forEach((g, row) => {
    const n = nominees.filter((x) => x.group === g).length;
    const width = GROUP_LABEL_W + FACE_GAP + n * FACE_W + (n - 1) * FACE_GAP;
    const left = (LEFT_W - width) / 2 + GROUP_LABEL_W + FACE_GAP;
    const top = ROWS_TOP + row * (FACE_H + ROW_GAP);
    for (let i = 0; i < n; i++) {
      out.push({ x: left + i * (FACE_W + FACE_GAP), y: top - FLOAT, w: FACE_W, h: FACE_H + FLOAT * 2 });
    }
  });
  return out;
}

export const qrRect = (): Rect => ({ x: LEFT_W + (RIGHT_W - QR_BOX) / 2, y: QR_TOP, w: QR_BOX, h: QR_BOX });

export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const inside = (a: Rect, bounds: Rect) => a.x >= bounds.x && a.y >= bounds.y && a.x + a.w <= bounds.x + bounds.w && a.y + a.h <= bounds.y + bounds.h;
export const canvasRect = (): Rect => ({ x: 0, y: 0, w: W, h: H });
