import fuzzysort, { type KeysResult } from 'fuzzysort';
import { fileName } from './paths';

const anyMatch = 0;
const unlimited = 0;
const noPositions: ReadonlySet<number> = new Set();
export interface FuzzyMatch<T> {
  item: T;
  positions: ReadonlySet<number>;
}
export function fuzzySearch<T>(
  query: string,
  items: T[],
  key: (item: T) => string,
): FuzzyMatch<T>[] {
  const trimmed = query.trim();
  if (!trimmed)
    return items.map((item) => ({ item: item, positions: noPositions }));
  const results = fuzzysort.go(trimmed, items, {
    keys: [(item: T) => fileName(key(item)), key],
    threshold: anyMatch,
    limit: unlimited,
  });
  return results.map((result) => ({
    item: result.obj,
    positions: matchedPositions(result, key(result.obj)),
  }));
}
export function fuzzyFilter<T>(
  query: string,
  items: T[],
  key: (item: T) => string,
): T[] {
  return fuzzySearch(query, items, key).map((match) => match.item);
}
function matchedPositions<T>(
  result: KeysResult<T>,
  text: string,
): ReadonlySet<number> {
  const [nameResult, textResult] = result;
  const nameScoredBest = nameResult.score >= textResult.score;
  if (!nameScoredBest) return new Set(textResult.indexes);
  const nameStart = text.length - nameResult.target.length;
  return new Set(nameResult.indexes.map((index) => nameStart + index));
}
