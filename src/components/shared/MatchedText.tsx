import { Fragment } from 'react';

interface Run {
  text: string;
  matched: boolean;
}
export function MatchedText({
  text,
  start = 0,
  positions,
}: {
  text: string;
  start?: number;
  positions: ReadonlySet<number>;
}) {
  return matchRuns(text, start, positions).map((run, index) =>
    run.matched ? (
      <mark
        key={index}
        className="bg-transparent font-semibold text-accent dark:text-accent-dark"
      >
        {run.text}
      </mark>
    ) : (
      <Fragment key={index}>{run.text}</Fragment>
    ),
  );
}
function matchRuns(
  text: string,
  start: number,
  positions: ReadonlySet<number>,
): Run[] {
  const runs: Run[] = [];
  for (let index = 0; index < text.length; index++) {
    const matched = positions.has(start + index);
    const current = runs.at(-1);
    const startsRun = current === undefined || current.matched !== matched;
    if (startsRun) {
      runs.push({ text: text[index], matched: matched });
      continue;
    }
    current.text += text[index];
  }
  return runs;
}
