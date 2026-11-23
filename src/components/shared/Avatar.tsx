import { laneColours } from './lanes';
export function initials(author: string) {
  const words = author.trim().split(/\s+/).filter(Boolean);
  return (words[0]?.[0] ?? '?')
    .concat(words.length > 1 ? (words.at(-1)?.[0] ?? '') : '')
    .toUpperCase();
}
export function Avatar({ author, small }: { author: string; small?: boolean }) {
  const seed = [...author].reduce(
    (total, char) => total + char.charCodeAt(0),
    0,
  );
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full font-sans font-semibold text-white ${laneColours[seed % laneColours.length].background} ${small ? 'size-4' : 'size-5'} text-badge`}
    >
      {initials(author)}
    </span>
  );
}
