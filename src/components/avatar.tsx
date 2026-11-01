import type { CSSProperties } from "react";
import type { Group, Nominee } from "@/data/nominees";

// A nominee's picture: a coloured circle with the first letter of the nickname. Pure CSS, so there is
// no image to download and nothing to break on a bad connection.
// [top-left, bottom-right] of the gradient — dark enough for a white letter
const AVATAR_COLORS: Record<Group, [string, string]> = {
  AMBER: ["#f59e0b", "#b45309"],
  AZURE: ["#0ea5e9", "#0369a1"],
  JADE: ["#10b981", "#047857"],
  RUBY: ["#f43f5e", "#b91c1c"],
};

// Thai nicknames can start with a vowel written before the consonant (เ แ โ ใ ไ): the initial is the consonant
export function initialOf(nickname: string): string {
  const first = Array.from(nickname.replace(/^[เแโใไ]+/, ""))[0] ?? "?";
  return first.toUpperCase();
}

// `size` is any CSS length. The letter scales with the circle through container units, so it works
// for "30px", "100%" and "min(100cqw, 100cqh)" alike (a tile that is as tall as the grid row allows).
export function Avatar({
  nominee: n,
  size,
  ring,
  ringPx = 3,
  className,
  style,
}: {
  nominee: Pick<Nominee, "nickname" | "group">;
  size: number | string;
  ring?: string; // colour of an inner ring, `ringPx` wide
  ringPx?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const [from, to] = AVATAR_COLORS[n.group];
  const d = typeof size === "number" ? `${size}px` : size;
  return (
    <span
      aria-hidden
      className={className}
      style={{
        display: "grid",
        placeItems: "center",
        flex: "none",
        width: d,
        height: d,
        borderRadius: "50%",
        containerType: "size",
        background: `linear-gradient(145deg, ${from}, ${to})`,
        boxShadow: ring ? `inset 0 0 0 ${ringPx}px ${ring}` : undefined,
        ...style,
      }}
    >
      <span style={{ fontSize: "52cqmin", fontWeight: 800, lineHeight: 1, color: "#fff", textShadow: "0 1px 3px rgb(0 0 0 / 0.3)" }}>
        {initialOf(n.nickname)}
      </span>
    </span>
  );
}
