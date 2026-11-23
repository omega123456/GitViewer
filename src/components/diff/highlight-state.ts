import type { Diff } from '../../lib/types';
export type Tokens = Record<string, { content: string; color?: string }[]>;
export interface HighlightInputs {
  data?: Diff;
  oldText?: string;
  newText?: string;
  path: string;
  dark: boolean;
}
export interface Highlighted {
  inputs: HighlightInputs;
  done: boolean;
  tokens: Tokens;
}
export const noTokens: Tokens = {};
export function sameInputs(left: HighlightInputs, right: HighlightInputs) {
  return (
    left.data === right.data &&
    left.oldText === right.oldText &&
    left.newText === right.newText &&
    left.path === right.path &&
    left.dark === right.dark
  );
}
export function idleHighlight(path: string, dark: boolean): Highlighted {
  return {
    inputs: { path: path, dark: dark },
    done: false,
    tokens: noTokens,
  };
}
export function highlighted(
  inputs: HighlightInputs,
  tokens: Tokens,
  done: boolean,
): Highlighted {
  return { inputs: inputs, done: done, tokens: tokens };
}
