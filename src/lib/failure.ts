import type { GitError } from './types';
export type FailureKind = 'network' | 'authentication' | 'alert';
export type Recovery = 'retry' | 'pull' | null;
export interface Described {
  title: string;
  summary: string;
  kind: FailureKind;
  recovery: Recovery;
}
const headlines: Record<string, string> = {
  refused: 'Git refused the request',
  authentication: 'Sign-in to the remote failed',
  network: 'Could not reach the remote',
};
const prefix = /^(fatal|error):\s*/i;
export function summarize(message: string) {
  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const text = (
    lines.find((line) => prefix.test(line)) ??
    lines[0] ??
    ''
  ).replace(prefix, '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
export function describe(error: GitError): Described {
  if (
    error.message.includes('[rejected]') &&
    error.message.includes('failed to push')
  )
    return {
      title: 'Push rejected',
      summary:
        'The remote has commits that you do not have. Pull, then push again.',
      kind: 'alert',
      recovery: 'pull',
    };
  return {
    title: headlines[error.category] ?? 'Something went wrong',
    summary: summarize(error.message),
    kind:
      error.category === 'network' || error.category === 'authentication'
        ? error.category
        : 'alert',
    recovery: error.category === 'network' ? 'retry' : null,
  };
}
export function overwrittenPaths(message: string) {
  return message
    .split('\n')
    .filter((line) => /^\s+\S/.test(line))
    .map((line) => line.trim());
}
