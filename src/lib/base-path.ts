// Must match `basePath` in next.config.ts. <Link>/router add it automatically;
// fetch(), <img src>, audio files and Ably authUrl do not — use withBase().
export const BASE_PATH = "";

export function withBase(path: string): string {
  if (!path.startsWith("/")) path = `/${path}`;
  return `${BASE_PATH}${path}`;
}
