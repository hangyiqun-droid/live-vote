// The seeded award names must fit every stage scene
import { describe, expect, it } from "vitest";
import { seedAwards } from "@/data/awards";
import { fitTitle } from "@/app/stage/title-fit";

describe("award names", () => {
  it("are the five seeded awards", () => {
    expect(seedAwards.map((a) => a.title)).toEqual([
      "Best Pitch",
      "Rising Star",
      "Community Champion",
      "Most Inspiring Founder of the Year",
      "Best Party Starter",
    ]);
  });

  it("short names keep the full size, the longest one still reads from the back of the room", () => {
    expect(fitTitle("รางวัลที่ 1", 124, 1780)).toBe(124);
    const long = "Most Inspiring Founder of the Year";
    expect(fitTitle(long, 124, 1780)).toBeGreaterThanOrEqual(72);
    expect(fitTitle(long, 110, 1640)).toBeGreaterThanOrEqual(70);
  });
});
