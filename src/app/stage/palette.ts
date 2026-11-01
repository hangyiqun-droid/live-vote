import type { CSSProperties } from "react";
import type { Group } from "@/data/nominees";

// Stage palette per group on a dark background.
// [solid, bright end of the bar gradient]
export const PALETTE: Record<Group, [string, string]> = {
  AMBER: ["#b45309", "#f59e0b"],
  AZURE: ["#0369a1", "#38bdf8"],
  JADE: ["#047857", "#34d399"],
  RUBY: ["#b91c1c", "#fb7185"],
};

export function groupVars(g: Group): CSSProperties {
  const [a, b] = PALETTE[g];
  return { "--g": a, "--g2": b } as CSSProperties;
}
