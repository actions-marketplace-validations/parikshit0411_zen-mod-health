/**
 * Suggest the closest existing name for one that disappeared — catches
 * renames (`translation-button` → `translations-button`) and typos
 * (`menupopu` → `menupopup`).
 */

/** Levenshtein distance, bailing out early once it exceeds `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

export class Suggester {
  private byLength = new Map<number, string[]>();

  constructor(tokens: Iterable<string>) {
    for (const t of tokens) {
      if (t.length < 4) continue;
      let bucket = this.byLength.get(t.length);
      if (!bucket) this.byLength.set(t.length, (bucket = []));
      bucket.push(t);
    }
  }

  suggest(name: string): string | undefined {
    // Allow ~1 edit per 8 chars, at most 3; short names need an exact-ish match.
    const max = Math.min(3, Math.max(1, Math.floor(name.length / 8)));
    let best: string | undefined;
    let bestScore = Infinity;
    for (let len = name.length - max; len <= name.length + max; len++) {
      for (const t of this.byLength.get(len) ?? []) {
        const d = editDistance(name, t, max);
        if (d > max) continue;
        // Prefer same first character and shared prefix to break ties.
        const score = d * 10 + (t[0] === name[0] ? 0 : 5) + (t.startsWith(name.slice(0, 4)) ? 0 : 2);
        if (score < bestScore) [best, bestScore] = [t, score];
      }
    }
    return best;
  }
}
