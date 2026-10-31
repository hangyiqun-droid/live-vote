// "The database has not had migration 0006 yet" — undefined_function / undefined_table /
// undefined_column. The lobby extras (counter, greetings) treat that as "off" instead of an error,
// so a deploy that lands before `pnpm prod:db` never takes the stage or the MC page down (fix9 R3).
export function isMissingSchema(e: unknown): boolean {
  const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
  return code === "42883" || code === "42P01" || code === "42703";
}
