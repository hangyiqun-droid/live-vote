// Fixed 1920×1080 stage canvas (SPEC 4.1, 5.1). The whole canvas is scaled to the window, so
// every position here is in design pixels and can be computed without measuring the DOM.
import { LANES } from "./race";

export const W = 1920;
export const H = 1080;
export const RACE_W = 1344; // left ~70%: race · right ~30%: QR panel
export const PAD = 56;

export const LANE_TOP = 168;
export const LANE_H = 88;
export const LANE_STEP = 94;

export const PHOTO_W = 66; // 3:4, shown from the 120 px file (SPEC 5.1)
export const PHOTO_H = 88;
export const PHOTO_X = 120;

export const BAR_X = 438;
export const BAR_W = 580;

export const STRIP_TOP = 940;
export const STRIP_SLOTS = 29 - LANES;
export const STRIP_STEP = (RACE_W - PAD * 2) / STRIP_SLOTS;
export const STRIP_PHOTO_W = 50;
export const STRIP_SCALE = STRIP_PHOTO_W / PHOTO_W;

export const QR_CENTER = { x: RACE_W + (W - RACE_W) / 2, y: 400 };

export const laneY = (slot: number) => LANE_TOP + slot * LANE_STEP;
export const stripX = (slot: number) => PAD + (slot - LANES) * STRIP_STEP + (STRIP_STEP - STRIP_PHOTO_W) / 2;

// Top-left of the photo plus its scale; lanes and strip share one element so it can fly between them
export function photoPlace(slot: number): { x: number; y: number; s: number } {
  if (slot < LANES) return { x: PHOTO_X, y: laneY(slot), s: 1 };
  return { x: stripX(slot), y: STRIP_TOP + 4, s: STRIP_SCALE };
}
