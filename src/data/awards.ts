// Seed data only: kept apart from nominees.ts so the phone bundle does not carry it.
// The seed never overwrites a title already in the DB (the MC can rename an award from the admin page).
const AWARD_TITLES = [
  "Best Pitch",
  "Rising Star",
  "Community Champion",
  "Most Inspiring Founder of the Year",
  "Best Party Starter",
];

export const seedAwards = AWARD_TITLES.map((title, i) => ({
  id: i + 1,
  slug: `award-${i + 1}`,
  title,
  sortOrder: i + 1,
}));
