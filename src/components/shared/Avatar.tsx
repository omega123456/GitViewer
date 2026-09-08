const palette = [
  'bg-lane-1',
  'bg-lane-2',
  'bg-lane-3',
  'bg-lane-4',
  'bg-lane-5',
  'bg-lane-6',
  'bg-lane-7',
  'bg-lane-8',
];
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
      className={`flex shrink-0 items-center justify-center rounded-full font-sans font-semibold text-white ${palette[seed % palette.length]} ${small ? 'size-4 text-label' : 'size-5 text-label'}`}
    >
      {initials(author)}
    </span>
  );
}
