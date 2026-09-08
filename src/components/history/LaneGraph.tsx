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
export function LaneGraph({ commit, head }: { commit: Commit; head: boolean }) {
  const centre = 14 + commit.lane * 18;
  return (
    <svg
      width={78}
      height={30}
      className="shrink-0"
      aria-label={`Lane ${commit.lane + 1}`}
      role="img"
    >
      {commit.segments.map((segment, index) => (
        <path
          key={index}
          d={`M ${14 + segment.from * 18} 0 L ${14 + segment.from * 18} 15 L ${14 + segment.to * 18} 30`}
          className={strokes[segment.from % 8]}
          strokeWidth={1.6}
          fill="none"
        />
      ))}
      {head && (
        <circle
          cx={centre}
          cy={15}
          r={8}
          strokeWidth={1.6}
          opacity={0.55}
          fill="none"
          className={strokes[commit.lane % 8]}
        />
      )}
      <circle
        cx={centre}
        cy={15}
        r={head ? 5 : 4}
        className={fills[commit.lane % 8]}
      />
    </svg>
  );
}
