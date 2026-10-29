// pg v8 treats sslmode=require as verify-full and prints a warning; spell out verify-full.
export function pgUrl(url: string | undefined): string {
  if (!url) throw new Error("database url is not set");
  return url.replace(/sslmode=(require|prefer|verify-ca)/, "sslmode=verify-full");
}
