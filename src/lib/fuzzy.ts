const separator = /[/._\-\s]/;
export function fuzzyScore(query: string, text: string): number | null {
  const lower = text.toLowerCase();
  let score = 0;
  let last = -1;
  for (const char of query.toLowerCase()) {
    const at = lower.indexOf(char, last + 1);
    if (at === -1) return null;
    const boundary =
      at === 0 || separator.test(lower[at - 1]) || text[at] !== lower[at];
    score += at === last + 1 ? 3 : boundary ? 2 : 0;
    last = at;
  }
  return score;
}
export function fuzzyFilter<T>(
  query: string,
  items: T[],
  key: (item: T) => string,
): T[] {
  if (!query) return items;
  return items
    .map((item) => ({ item, score: fuzzyScore(query, key(item)) }))
    .filter(
      (entry): entry is { item: T; score: number } => entry.score !== null,
    )
    .sort(
      (a, b) => b.score - a.score || key(a.item).length - key(b.item).length,
    )
    .map((entry) => entry.item);
}
