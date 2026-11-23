/**
 * Example 3: cache, quota and an explicit fallback in front of a metered API.
 *
 * Generic illustration written for this repository. The provider is simulated
 * with a function; there is no network call and no product code.
 *
 * Demonstrates: a time to live per key, a per-minute window and a per-day cap
 * counted locally, a fallback that is returned with a label and a reason, and
 * a failed call that degrades instead of throwing.
 *
 * Run with one dependency, no install step beyond it:
 *   npx tsx enrichment_cache.ts
 */

type Source = "cache" | "live" | "fallback";

interface Outcome<T> {
  value: T;
  source: Source;
  warning?: string;
}

interface Limits {
  ttlMs: number;
  perMinute: number;
  perDay: number;
}
class MeteredCache<T> {
  private entries = new Map<string, { value: T; expiresAt: number }>();
  private minuteWindow: number[] = [];
  private usedToday = 0;
  private limits: Limits;
  private fetchFresh: (key: string) => Promise<T>;
  private fallback: (key: string) => T;

  constructor(limits: Limits, fetchFresh: (key: string) => Promise<T>, fallback: (key: string) => T) {
    this.limits = limits;
    this.fetchFresh = fetchFresh;
    this.fallback = fallback;
  }

  async get(key: string): Promise<Outcome<T>> {
    const now = Date.now();
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > now) {
      return { value: cached.value, source: "cache" };
    }

    const windowStart = now - 60_000;
    this.minuteWindow = this.minuteWindow.filter((at) => at > windowStart);

    if (this.usedToday >= this.limits.perDay) {
      return { value: this.fallback(key), source: "fallback", warning: "daily quota reached" };
    }
    if (this.minuteWindow.length >= this.limits.perMinute) {
      return { value: this.fallback(key), source: "fallback", warning: "per-minute limit reached" };
    }

    this.minuteWindow.push(now);
    this.usedToday += 1;

    try {
      const value = await this.fetchFresh(key);
      this.entries.set(key, { value, expiresAt: now + this.limits.ttlMs });
      return { value, source: "live" };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      return { value: this.fallback(key), source: "fallback", warning: `source failed: ${reason}` };
    }
  }
}

const cache = new MeteredCache<string>(
  { ttlMs: 60_000, perMinute: 3, perDay: 10 },
  async (key) => {
    if (key === "broken") throw new Error("upstream 503");
    return `record for ${key}`;
  },
  (key) => `demonstration record for ${key}`,
);

async function main(): Promise<void> {
  for (const key of ["alpha", "alpha", "broken", "beta", "gamma", "delta"]) {
    const outcome = await cache.get(key);
    const note = outcome.warning ? ` (${outcome.warning})` : "";
    console.log(`${key.padEnd(6)} ${outcome.source.padEnd(8)} ${outcome.value}${note}`);
  }
}

main();
