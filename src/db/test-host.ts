// Scripts and tests that write to the database only run against the one host named in TEST_DB_HOST —
// the first label of the test database's hostname (e.g. "ep-cool-name-123456"). The check is on the
// *host* of the URL, never a substring, so a URL that only mentions the name in a query string,
// a user name or a path cannot pass for the test database.

// "ep-…-123456.c-3.ap-southeast-1.aws.neon.tech" → the first label must equal `expected` exactly
// (a pooled "-pooler" host is a different label and is not accepted here)
export function isTestHost(url: string | undefined, expected: string | undefined = process.env.TEST_DB_HOST): boolean {
  if (!url || !expected) return false;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  const [first, ...rest] = host.toLowerCase().split(".");
  return first === expected.toLowerCase() && rest.length > 0;
}
