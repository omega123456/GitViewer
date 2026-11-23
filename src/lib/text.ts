const PLURAL_SUFFIX = 's';
const OVERFLOW_WORD = 'and';
export interface ListLayout {
  limit: number;
  separator: string;
  overflowSeparator: string;
}
export function pluralWord(
  count: number,
  singular: string,
  plural = `${singular}${PLURAL_SUFFIX}`,
) {
  return count === 1 ? singular : plural;
}
export function plural(count: number, singular: string, pluralForm?: string) {
  return `${count} ${pluralWord(count, singular, pluralForm)}`;
}
export function truncateList(items: string[], layout: ListLayout) {
  const shown = items.slice(0, layout.limit).join(layout.separator);
  const hidden = items.length - layout.limit;
  if (hidden <= 0) return shown;
  return `${shown}${layout.overflowSeparator}${OVERFLOW_WORD} ${hidden} more`;
}
