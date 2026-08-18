export async function mapLimit<T, R>(items: T[], limit: number, operation: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let failure: unknown;
  async function worker(): Promise<void> {
    while (cursor < items.length && failure === undefined) {
      const index = cursor;
      cursor += 1;
      try { results[index] = await operation(items[index]!); }
      catch (error) { failure = error; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => worker()));
  if (failure !== undefined) throw failure;
  return results;
}
