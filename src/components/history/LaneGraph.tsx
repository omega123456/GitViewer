import { useId } from 'react';
import type { Commit } from '../../lib/types';
const strokes = [
  'stroke-lane-1 dark:stroke-lane-1-dark',
  'stroke-lane-2 dark:stroke-lane-2-dark',
  'stroke-lane-3 dark:stroke-lane-3-dark',
  'stroke-lane-4 dark:stroke-lane-4-dark',
  'stroke-lane-5 dark:stroke-lane-5-dark',
  'stroke-lane-6 dark:stroke-lane-6-dark',
  'stroke-lane-7 dark:stroke-lane-7-dark',
  'stroke-lane-8 dark:stroke-lane-8-dark',
];
const fills = [
  'fill-lane-1 dark:fill-lane-1-dark',
  'fill-lane-2 dark:fill-lane-2-dark',
  'fill-lane-3 dark:fill-lane-3-dark',
  'fill-lane-4 dark:fill-lane-4-dark',
  'fill-lane-5 dark:fill-lane-5-dark',
  'fill-lane-6 dark:fill-lane-6-dark',
  'fill-lane-7 dark:fill-lane-7-dark',
  'fill-lane-8 dark:fill-lane-8-dark',
];
const visibleLanes = 6;
const fade = 10;
const x = (lane: number) => 14 + lane * 18;
export function laneCount(commits: Commit[]) {
  return commits.reduce(
    (count, commit) =>
      Math.max(
        count,
        commit.lane + 1,
        ...commit.segments.map(
          (segment) => Math.max(segment.from, segment.to) + 1,
        ),
      ),
    1,
  );
}
export function graphWidth(lanes: number) {
  return 28 + 18 * (Math.min(lanes, visibleLanes) - 1);
}
export function LaneGraph({
  commit,
  lanes,
  head,
}: {
  commit: Commit;
  lanes: number;
  head: boolean;
}) {
  const id = useId();
  const width = graphWidth(lanes);
  const overflow = lanes > visibleLanes;
  const centre = x(commit.lane);
  const merge = commit.parents.length > 1;
  return (
    <svg
      height={30}
      className="w-graph shrink-0"
      aria-label={`Lane ${commit.lane + 1}`}
      role="img"
    >
      {overflow && (
        <defs>
          <linearGradient id={`${id}fade`}>
            <stop offset={(width - fade) / width} stopColor="white" />
            <stop offset={1} stopColor="white" stopOpacity={0} />
          </linearGradient>
          <mask id={`${id}mask`}>
            <rect width={width} height={30} fill={`url(#${id}fade)`} />
          </mask>
        </defs>
      )}
      <g mask={overflow ? `url(#${id}mask)` : undefined}>
        {commit.entered && (
          <path
            d={`M ${centre} 0 L ${centre} 15`}
            className={strokes[commit.color]}
            strokeWidth={1.6}
            fill="none"
          />
        )}
        {commit.segments.map((segment, index) => (
          <path
            key={index}
            d={`${segment.from === commit.lane ? `M ${centre} 15` : `M ${x(segment.from)} 0 L ${x(segment.from)} 15`} L ${x(segment.to)} 30`}
            className={strokes[segment.color]}
            strokeWidth={1.6}
            fill="none"
          />
        ))}
      </g>
      {commit.lane >= visibleLanes ? (
        <path
          d={`M ${width - 7} 11 L ${width - 1} 15 L ${width - 7} 19 Z`}
          className={fills[commit.color]}
        />
      ) : (
        <>
          {head && (
            <circle
              cx={centre}
              cy={15}
              r={8}
              strokeWidth={1.6}
              opacity={0.55}
              fill="none"
              className={strokes[commit.color]}
            />
          )}
          {merge && !head ? (
            <circle
              cx={centre}
              cy={15}
              r={3.2}
              strokeWidth={1.6}
              className={`fill-sub dark:fill-sub-dark ${strokes[commit.color]}`}
            />
          ) : (
            <circle
              cx={centre}
              cy={15}
              r={head ? 5 : 4}
              className={fills[commit.color]}
            />
          )}
        </>
      )}
    </svg>
  );
}
