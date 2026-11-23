import { formatDistanceToNowStrict, fromUnixTime } from 'date-fns';
export function relativeTime(timestamp: number) {
  return formatDistanceToNowStrict(fromUnixTime(timestamp), {
    addSuffix: true,
  });
}
export function elapsedTime(timestamp: number) {
  return formatDistanceToNowStrict(fromUnixTime(timestamp));
}
