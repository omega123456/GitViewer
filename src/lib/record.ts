export function withEntry<T>(
  record: Record<string, T>,
  key: string,
  value: T,
): Record<string, T> {
  return { ...record, [key]: value };
}
export function withoutWhere<T>(
  record: Record<string, T>,
  isRemoved: (key: string) => boolean,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !isRemoved(key)),
  );
}
export function withoutAll<T>(
  record: Record<string, T>,
  keys: readonly string[],
): Record<string, T> {
  return withoutWhere(record, (key) => keys.includes(key));
}
export function without<T>(
  record: Record<string, T>,
  key: string,
): Record<string, T> {
  return withoutAll(record, [key]);
}
