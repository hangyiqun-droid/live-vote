import type { Group } from "@/data/nominees";

// Full class strings so Tailwind can see them
export const groupStyle: Record<Group, { chip: string; soft: string; text: string; bar: string }> = {
  AMBER: { chip: "bg-amber text-white", soft: "bg-amber-soft", text: "text-amber", bar: "bg-amber" },
  AZURE: { chip: "bg-azure text-white", soft: "bg-azure-soft", text: "text-azure", bar: "bg-azure" },
  JADE: { chip: "bg-jade text-white", soft: "bg-jade-soft", text: "text-jade", bar: "bg-jade" },
  RUBY: { chip: "bg-ruby text-white", soft: "bg-ruby-soft", text: "text-ruby", bar: "bg-ruby" },
};
