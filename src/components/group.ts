import type { Group } from "@/data/nominees";

// Full class strings so Tailwind can see them
export const groupStyle: Record<Group, { chip: string; soft: string; bar: string; frame: string }> = {
  AMBER: { chip: "bg-amber text-white", soft: "bg-amber-soft", bar: "bg-amber", frame: "border-amber" },
  AZURE: { chip: "bg-azure text-white", soft: "bg-azure-soft", bar: "bg-azure", frame: "border-azure" },
  JADE: { chip: "bg-jade text-white", soft: "bg-jade-soft", bar: "bg-jade", frame: "border-jade" },
  RUBY: { chip: "bg-ruby text-white", soft: "bg-ruby-soft", bar: "bg-ruby", frame: "border-ruby" },
};
