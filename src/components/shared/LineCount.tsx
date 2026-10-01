import type { Lines } from '../../lib/types';
const compact = new Intl.NumberFormat('en', { notation: 'compact' });
const exact = new Intl.NumberFormat('en');
function short(value: number) {
  return compact.format(value).toLowerCase();
}
function describe([added, removed]: [number, number]) {
  return `${exact.format(added)} ${added === 1 ? 'line' : 'lines'} added, ${exact.format(removed)} removed`;
}
export function sumLines(
  lines: Record<string, Lines> | undefined,
  paths: Iterable<string>,
): Lines | undefined {
  if (!lines) return undefined;
  let added = 0;
  let removed = 0;
  for (const path of paths) {
    const own = lines[path];
    if (!own) continue;
    added += own[0];
    removed += own[1];
  }
  return [added, removed];
}
export function LineCount({
  lines,
  className = '',
}: {
  lines: Lines | undefined;
  className?: string;
}) {
  if (lines === undefined) return null;
  const base = `shrink-0 font-mono text-label font-normal tracking-normal normal-case tabular-nums @max-line-counts:hidden ${className}`;
  if (lines === null)
    return (
      <span
        className={`${base} text-faint dark:text-faint-dark`}
        title="Binary file"
      >
        bin
      </span>
    );
  const [added, removed] = lines;
  if (added === 0 && removed === 0) return null;
  const label = describe(lines);
  return (
    <span className={`flex gap-1 ${base}`} title={label}>
      <span className="sr-only">{label}</span>
      {added > 0 && (
        <span aria-hidden="true" className="text-added dark:text-added-dark">
          +{short(added)}
        </span>
      )}
      {removed > 0 && (
        <span
          aria-hidden="true"
          className="text-deleted dark:text-deleted-dark"
        >
          −{short(removed)}
        </span>
      )}
    </span>
  );
}
