import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const STORE_INDEX =
  "https://raw.githubusercontent.com/zen-browser/theme-store/main/themes.json";

export interface StoreMod {
  id: string;
  name: string;
  description: string;
  style: string;
  homepage?: string;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface FetchOptions {
  cacheDir: string;
  /** Use only cached files; never hit the network. */
  offline?: boolean;
  concurrency?: number;
}

async function cachedText(url: string, opts: FetchOptions): Promise<string> {
  mkdirSync(opts.cacheDir, { recursive: true });
  const file = join(opts.cacheDir, createHash("sha1").update(url).digest("hex"));
  if (opts.offline) {
    if (!existsSync(file)) throw new Error(`not in cache (offline): ${url}`);
    return readFileSync(file, "utf8");
  }
  const res = await fetch(url, { headers: { "User-Agent": "zen-mod-health" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();
  writeFileSync(file, text);
  return text;
}

export async function fetchStore(opts: FetchOptions): Promise<StoreMod[]> {
  const index = JSON.parse(await cachedText(STORE_INDEX, opts)) as Record<string, StoreMod>;
  return Object.values(index).sort((a, b) => a.name.localeCompare(b.name));
}

/** Run `fn` over `items` with bounded parallelism, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export function fetchModCss(mod: StoreMod, opts: FetchOptions): Promise<string> {
  return cachedText(mod.style, opts);
}
