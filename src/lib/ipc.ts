import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { appScope, useErrors } from '../stores/errors';
import type { Commands, GitError } from './types';
export async function invoke<K extends keyof Commands>(
  command: K,
  args: Commands[K]['args'],
): Promise<Commands[K]['result']> {
  try {
    return await tauriInvoke<Commands[K]['result']>('execute', {
      command,
      args,
    });
  } catch (error) {
    throw normalizeError(error);
  }
}
export function normalizeError(error: unknown): GitError {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return {
      category: 'category' in error ? String(error.category) : 'unexpected',
      message: String(error.message),
    };
  }
  return { category: 'unexpected', message: String(error) };
}
export function reportAppError(error: unknown) {
  useErrors.getState().report(appScope, normalizeError(error));
}
