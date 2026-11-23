import { confirm } from '@tauri-apps/plugin-dialog';
const CANCEL_LABEL = 'Cancel';
export interface ConfirmPrompt {
  title: string;
  okLabel: string;
  kind?: 'info' | 'warning';
}
export function confirmAction(message: string, prompt: ConfirmPrompt) {
  return confirm(message, {
    title: prompt.title,
    kind: prompt.kind ?? 'warning',
    okLabel: prompt.okLabel,
    cancelLabel: CANCEL_LABEL,
  });
}
