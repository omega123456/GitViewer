import { laneColours } from './lanes';
export function initials(author: string) {
  const words = author.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0];
  if (!first) return '?';
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}
function colourFor(author: string) {
  let total = 0;
  for (const character of author) total += character.charCodeAt(0);
  return laneColours[total % laneColours.length].background;
}
export function Avatar({ author, small }: { author: string; small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full font-sans font-semibold text-white ${colourFor(author)} ${small ? 'size-4' : 'size-5'} text-badge`}
    >
      {initials(author)}
    </span>
  );
}
