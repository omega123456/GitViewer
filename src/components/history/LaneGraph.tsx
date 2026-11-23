import { useId } from 'react';
import { middleOf } from '../../lib/geometry';
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
const LANE_MARGIN = 14;
const LANE_SPACING = 18;
const laneCentre = (lane: number) => LANE_MARGIN + lane * LANE_SPACING;
const rowHeight = 44;
const middle = middleOf(rowHeight);
const LINE_WIDTH = 1.6;
const DOT_RADIUS = 4;
const HEAD_DOT_RADIUS = 5;
const MERGE_DOT_RADIUS = 3.2;
const HEAD_RING_RADIUS = 8;
const HEAD_RING_OPACITY = 0.55;
const ARROW_BASE_INSET = 7;
const ARROW_TIP_INSET = 1;
const ARROW_HALF_HEIGHT = 4;
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
  return laneCentre(Math.min(lanes, visibleLanes) - 1) + LANE_MARGIN;
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
  const centre = laneCentre(commit.lane);
  const merge = commit.parents.length > 1;
  return (
    <svg
      height={rowHeight}
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
            <rect width={width} height={rowHeight} fill={`url(#${id}fade)`} />
          </mask>
        </defs>
      )}
      <g mask={overflow ? `url(#${id}mask)` : undefined}>
        {commit.entered && (
          <path
            d={`M ${centre} 0 L ${centre} ${middle}`}
            className={strokes[commit.color]}
            strokeWidth={LINE_WIDTH}
            fill="none"
          />
        )}
        {commit.segments.map((segment, index) => (
          <path
            key={index}
            d={`${segment.from === commit.lane ? `M ${centre} ${middle}` : `M ${laneCentre(segment.from)} 0 L ${laneCentre(segment.from)} ${middle}`} L ${laneCentre(segment.to)} ${rowHeight}`}
            className={strokes[segment.color]}
            strokeWidth={LINE_WIDTH}
            fill="none"
          />
        ))}
      </g>
      {commit.lane >= visibleLanes ? (
        <path
          d={`M ${width - ARROW_BASE_INSET} ${middle - ARROW_HALF_HEIGHT} L ${width - ARROW_TIP_INSET} ${middle} L ${width - ARROW_BASE_INSET} ${middle + ARROW_HALF_HEIGHT} Z`}
          className={fills[commit.color]}
        />
      ) : (
        <>
          {head && (
            <circle
              cx={centre}
              cy={middle}
              r={HEAD_RING_RADIUS}
              strokeWidth={LINE_WIDTH}
              opacity={HEAD_RING_OPACITY}
              fill="none"
              className={strokes[commit.color]}
            />
          )}
          {merge && !head ? (
            <circle
              cx={centre}
              cy={middle}
              r={MERGE_DOT_RADIUS}
              strokeWidth={LINE_WIDTH}
              className={`fill-sub dark:fill-sub-dark ${strokes[commit.color]}`}
            />
          ) : (
            <circle
              cx={centre}
              cy={middle}
              r={head ? HEAD_DOT_RADIUS : DOT_RADIUS}
              className={fills[commit.color]}
            />
          )}
        </>
      )}
    </svg>
  );
}
