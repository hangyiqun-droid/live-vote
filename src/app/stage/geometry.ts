// Fixed 1920×1080 stage canvas. The whole canvas is scaled to the window, so
// every position here is in design pixels and can be computed without measuring the DOM.
import { LANES } from "./race";

export const W = 1920;
export const H = 1080;
export const RACE_W = 1344; // left ~70%: race · right ~30%: vote panel
export const PAD = 56;

export const LANE_TOP = 168;
export const LANE_H = 88;
export const LANE_STEP = 94;

export const PHOTO_W = 76; // the avatar circle's diameter
export const PHOTO_H = 76;
export const PHOTO_X = 114;

export const BAR_X = 438;
export const BAR_W = 580;

export const STRIP_TOP = 940;
export const STRIP_SLOTS = 29 - LANES;
export const STRIP_STEP = (RACE_W - PAD * 2) / STRIP_SLOTS;
export const STRIP_PHOTO_W = 50;
export const STRIP_SCALE = STRIP_PHOTO_W / PHOTO_W;

// Where the vote dots start: the running total in the right panel
export const VOTE_ORIGIN = { x: RACE_W + (W - RACE_W) / 2, y: 400 };

export const laneY = (slot: number) => LANE_TOP + slot * LANE_STEP;
export const stripX = (slot: number) => PAD + (slot - LANES) * STRIP_STEP + (STRIP_STEP - STRIP_PHOTO_W) / 2;

// Top-left of the avatar plus its scale; lanes and strip share one element so it can fly between them
export function photoPlace(slot: number): { x: number; y: number; s: number } {
  if (slot < LANES) return { x: PHOTO_X, y: laneY(slot) + (LANE_H - PHOTO_H) / 2, s: 1 };
  return { x: stripX(slot), y: STRIP_TOP + 4, s: STRIP_SCALE };
}
