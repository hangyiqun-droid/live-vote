// Must match `basePath` in next.config.ts. Both read NEXT_PUBLIC_BASE_PATH (empty by default, e.g.
// "/vote" when the app is served under a sub-path). <Link>/router add it automatically;
// fetch(), <img src>, audio files and Ably authUrl do not — use withBase().
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// Cookies need a real path: "/" when the app lives at the root
export const COOKIE_PATH = BASE_PATH || "/";

export function withBase(path: string): string {
  if (!path.startsWith("/")) path = `/${path}`;
  return `${BASE_PATH}${path}`;
}
