// Seed data only: kept apart from nominees.ts so the phone bundle does not carry it.
// The seed never overwrites a title already in the DB (the MC can rename an award from the admin page).
const AWARD_TITLES = [
  "第一场辩论赛",
  "第二场辩论赛",
  "第三场辩论赛",
  "第四场辩论赛",
  "第五场辩论赛",
];

export const seedAwards = AWARD_TITLES.map((title, i) => ({
  id: i + 1,
  slug: `award-${i + 1}`,
  title,
  sortOrder: i + 1,
}));
