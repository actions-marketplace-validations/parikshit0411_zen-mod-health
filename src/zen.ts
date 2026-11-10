import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const RELEASES_API = "https://api.github.com/repos/zen-browser/desktop/releases";
const ASSET = "zen.linux-x86_64.tar.xz";
/** Only these files are needed from the ~110 MB release archive. */
const NEEDED = ["zen/application.ini", "zen/omni.ja", "zen/browser/omni.ja"];

export const DEFAULT_INSTALL_DIRS: Record<string, string[]> = {
  win32: ["C:\\Program Files\\Zen Browser", join(process.env.LOCALAPPDATA ?? "", "Zen Browser")],
  darwin: ["/Applications/Zen.app/Contents/Resources", "/Applications/Zen Browser.app/Contents/Resources"],
  linux: ["/opt/zen", "/usr/lib/zen", "/usr/lib/zen-browser", join(homedir(), ".local/share/zen")],
};

export function defaultCacheDir(): string {
  if (process.env.ZEN_MOD_HEALTH_CACHE) return process.env.ZEN_MOD_HEALTH_CACHE;
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA ?? homedir(), "zen-mod-health", "cache");
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "zen-mod-health");
}

export function findInstalledZen(): string | undefined {
  return (DEFAULT_INSTALL_DIRS[process.platform] ?? []).find((d) => existsSync(join(d, "omni.ja")));
}

function githubHeaders(): Record<string, string> {
  const h: Record<string, string> = { "User-Agent": "zen-mod-health", Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

/** Resolve "latest" or a version like "1.24.1b" to a release tag. */
async function resolveTag(version: string): Promise<string> {
  if (version !== "latest") return version;
  const res = await fetch(`${RELEASES_API}/latest`, { headers: githubHeaders() });
  if (!res.ok) throw new Error(`Could not look up the latest Zen release (HTTP ${res.status})`);
  return ((await res.json()) as { tag_name: string }).tag_name;
}

/**
 * Download a Zen Linux release and extract just the UI archives.
 * Cached per version, so repeat runs are instant.
 */
export async function downloadZen(version: string, cacheDir: string, log = console.log): Promise<string> {
  const tag = await resolveTag(version);
  const dir = join(cacheDir, `zen-${tag}`);
  if (existsSync(join(dir, "zen", "browser", "omni.ja"))) return join(dir, "zen");

  mkdirSync(dir, { recursive: true });
  const archive = join(dir, ASSET);
  const url = `https://github.com/zen-browser/desktop/releases/download/${tag}/${ASSET}`;
  log(`Downloading Zen ${tag} (~110 MB, cached for next time) …`);
  const res = await fetch(url, { headers: { "User-Agent": "zen-mod-health" } });
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(archive + ".part"));
  renameSync(archive + ".part", archive);

  try {
    execFileSync("tar", ["-xJf", ASSET, ...NEEDED], { cwd: dir, stdio: "pipe" });
  } catch (e) {
    throw new Error(
      `Could not extract ${archive} with tar (needs xz support). ` +
        `Install Zen locally and pass --zen instead.\n${(e as { stderr?: Buffer }).stderr ?? e}`,
    );
  }
  rmSync(archive);
  return join(dir, "zen");
}
