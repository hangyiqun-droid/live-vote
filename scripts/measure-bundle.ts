// First-load weight of a page: HTML + every <script src> / stylesheet it references, gzip-compressed
// (SPEC 4.2 "≤ 150 KB"). Lazy chunks (Ably SDK) are not referenced by the HTML, so they are excluded.
// Usage: pnpm build && pnpm start -p 3156 &  then  pnpm bundle [baseUrl] [path...]
//   e.g. pnpm bundle http://localhost:3156 / /stage
import { gzipSync } from "node:zlib";

const base = (process.argv[2] ?? "http://localhost:3156").replace(/\/$/, "") + "";
const paths = process.argv.slice(3).length ? process.argv.slice(3) : ["/"];

const gz = (b: Buffer) => gzipSync(b, { level: 9 }).length;

async function measure(path: string) {
  const url = base + (path === "/" ? "" : path);
  const html = Buffer.from(await (await fetch(url)).arrayBuffer());
  const text = html.toString("utf8");
  const assets = new Set<string>();
  for (const m of text.matchAll(/<script[^>]+src="([^"]+)"/g)) assets.add(m[1]);
  for (const m of text.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)) assets.add(m[1]);
  for (const m of text.matchAll(/<link[^>]+href="([^"]+\.css[^"]*)"[^>]+rel="stylesheet"/g)) assets.add(m[1]);

  const origin = new URL(url).origin;
  let js = 0;
  let css = 0;
  for (const a of assets) {
    const body = Buffer.from(await (await fetch(new URL(a.replace(/&amp;/g, "&"), origin))).arrayBuffer());
    if (a.includes(".css")) css += gz(body);
    else js += gz(body);
  }
  const k = (n: number) => (n / 1024).toFixed(1);
  console.log(
    `${path.padEnd(8)} html ${k(gz(html))} KB · js ${k(js)} KB · css ${k(css)} KB · total ${k(gz(html) + js + css)} KB gzip (${assets.size} files)`,
  );
}

async function main() {
  for (const p of paths) await measure(p);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
