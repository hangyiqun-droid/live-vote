// Award names can be long ("Most Inspiring Founder of the Year"): a title spends at most
// `room` px of text at `max` px, then shrinks. Pure — unit-tested in tests/title-fit.test.ts.
const EM_PER_CHAR = 0.56; // bold Noto Sans Thai, Latin average — slightly generous

export const fitTitle = (title: string, max: number, room: number) =>
  Math.min(max, Math.floor(room / (Math.max(title.length, 1) * EM_PER_CHAR)));
