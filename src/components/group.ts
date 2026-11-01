import type { Group } from "@/data/nominees";

// Full class strings so Tailwind can see them
export const groupStyle: Record<Group, { chip: string; soft: string; bar: string; frame: string }> = {
  AMBER: { chip: "bg-amber-grp text-white", soft: "bg-amber-grp-soft", bar: "bg-amber-grp", frame: "border-amber-grp" },
  AZURE: { chip: "bg-azure-grp text-white", soft: "bg-azure-grp-soft", bar: "bg-azure-grp", frame: "border-azure-grp" },
  JADE: { chip: "bg-jade-grp text-white", soft: "bg-jade-grp-soft", bar: "bg-jade-grp", frame: "border-jade-grp" },
  RUBY: { chip: "bg-ruby-grp text-white", soft: "bg-ruby-grp-soft", bar: "bg-ruby-grp", frame: "border-ruby-grp" },
};
