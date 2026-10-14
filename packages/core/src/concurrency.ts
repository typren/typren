/** `Promise.all(items.map(fn))` with at most `limit` calls to `fn` in flight
 *  at once, preserving input order in the result. A full `Promise.all` fan-out
 *  over a store's slugs/locales can open hundreds of concurrent adapter calls
 *  (GitHub/Notion rate limits, fs file descriptors); this caps it without a
 *  dependency (no new dep for ~10 lines). Results settle in the SAME order as
 *  `items`, regardless of which one finishes first. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
