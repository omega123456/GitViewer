import { TextArea } from '../shared/TextArea';
import { DropdownMenu } from 'radix-ui';
import {
  Check,
  ChevronDown,
  GitCommitHorizontal,
  Loader2,
  Sparkles,
} from 'lucide-react';
import type {
  GeneratedMessage,
  SettingsResponse,
  Status,
} from '../../lib/types';
import { shortcutLabel } from '../../lib/keyboard';
import { perform } from '../../lib/query';
import { useCommit, useCommitState } from '../../stores/commit';
import { useGenerate, useGenerateState } from '../../stores/generate';
import { useLayout, useTabLayout } from '../../stores/layout';
import {
  type CommitMode,
  useCommitMode,
  useMessage,
  useTabs,
} from '../../stores/tabs';
import { Button } from '../shared/Button';
import { dynamic, field, focus } from '../shared/styles';
import { ResizeHandle } from '../shell/ResizeHandle';
export function aiConfigured(settings: SettingsResponse) {
  return Boolean(
    settings.ai.enabled && settings.ai.baseUrl && settings.ai.model,
  );
}
export function sourceNotice(result: GeneratedMessage) {
  const parts = [
    ...(result.source === 'workingTree'
      ? ['summarized the unstaged working tree']
      : []),
    ...(result.detail === 'summary' ? ['used the file summary'] : []),
  ];
  return parts.length ? `Generation ${parts.join(' and ')}.` : null;
}
const modes: Record<CommitMode, { label: string; key: string }> = {
  commit: { label: 'Commit', key: 'Mod+Enter' },
  commitPush: { label: 'Commit & Push', key: 'Mod+Shift+Enter' },
};
export function commitLabel(
  status: Status,
  mode: CommitMode,
  smartCommit: boolean,
) {
  const verb = mode === 'commitPush' ? 'Commit & push' : 'Commit';
  const staged = status.entries.filter(
    (entry) => entry.index !== '.' && entry.index !== '?',
  ).length;
  if (staged === 0 && smartCommit && status.entries.length > 0)
    return `${verb} all ${status.entries.length} ${status.entries.length === 1 ? 'change' : 'changes'} to ${status.branch}`;
  return `${verb} ${staged} ${staged === 1 ? 'file' : 'files'} to ${status.branch}`;
}
export function CommitFooter({
  repo,
  status,
  settings,
  disabled,
  pushable,
  commit,
}: {
  repo: string;
  status: Status;
  settings: SettingsResponse;
  disabled: boolean;
  pushable: boolean;
  commit: (mode: CommitMode) => void;
}) {
  const message = useMessage(repo);
  const mode = useCommitMode(repo);
  const generate = useGenerateState(repo);
  const flow = useCommitState(repo);
  const notice =
    generate.applied && generate.applied.message === message
      ? sourceNotice(generate.applied)
      : null;
  const changes = status.entries.map((entry) => entry.path);
  const active = pushable ? mode : 'commit';
  const label =
    flow.phase === 'committing'
      ? 'Committing…'
      : flow.phase === 'pushing'
        ? `Pushing to ${status.upstream ?? status.branch}`
        : commitLabel(status, active, settings.smartCommit !== 'never');
  const stageAll = (always: boolean) => {
    const pending = flow.prompt ?? 'commit';
    if (always)
      void perform('settings_set', { ...settings, smartCommit: 'always' });
    void useCommit.getState().run(repo, {
      message,
      mode: pending,
      stage: changes,
    });
  };
  const { messageHeight } = useTabLayout(repo);
  return (
    <section
      aria-label="Commit"
      className="flex shrink-0 flex-col border-t border-line bg-sub dark:border-line-dark dark:bg-sub-dark"
    >
      <div className="flex flex-col gap-2 p-2">
        {aiConfigured(settings) && (
          <div className="flex justify-end">
            <Button
              disabled={generate.busy}
              onClick={() => void useGenerate.getState().generate(repo)}
            >
              {generate.busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              {generate.busy ? 'Generating' : 'Generate'}
            </Button>
          </div>
        )}
        <div className="relative">
          <ResizeHandle
            label="Resize commit message"
            orientation="vertical"
            min={40}
            max={400}
            step={10}
            value={messageHeight}
            className="absolute inset-x-0 top-0 z-10 h-2 cursor-row-resize rounded-t focus-visible:bg-accent"
            measure={(event) =>
              event.currentTarget.nextElementSibling!.getBoundingClientRect()
                .bottom - event.clientY
            }
            onChange={(next) =>
              useLayout.getState().update(repo, { messageHeight: next })
            }
          />
          <TextArea
            aria-label="Commit message"
            placeholder="Commit message"
            value={message}
            className={`${field} h-message resize-none`}
            style={dynamic({ '--message-height': `${messageHeight}px` })}
            onChange={(event) =>
              useTabs.getState().setMessage(repo, event.target.value)
            }
          />
        </div>
        {generate.error && (
          <p
            role="alert"
            className="text-label text-remove-ink dark:text-remove-ink-dark"
          >
            {generate.error}
          </p>
        )}
        {notice && (
          <p className="text-label text-muted dark:text-muted-dark">{notice}</p>
        )}
        {generate.pending && (
          <div className="flex flex-col gap-2 rounded border border-line bg-surface p-2 dark:border-line-dark dark:bg-surface-dark">
            <p className="text-label text-muted dark:text-muted-dark">
              Replace your draft with the generated message?
            </p>
            <div className="flex justify-end gap-1.5">
              <Button onClick={() => useGenerate.getState().dismiss(repo)}>
                Keep draft
              </Button>
              <Button
                variant="primary"
                onClick={() => useGenerate.getState().confirm(repo)}
              >
                Replace
              </Button>
            </div>
          </div>
        )}
        {flow.prompt && (
          <div
            role="group"
            aria-label="Stage all and commit"
            className="flex flex-col gap-2 rounded border border-line bg-surface p-2 dark:border-line-dark dark:bg-surface-dark"
          >
            <p className="text-label text-muted dark:text-muted-dark">
              Nothing is staged. Stage all {changes.length}{' '}
              {changes.length === 1 ? 'change' : 'changes'} and commit?
            </p>
            <div className="flex justify-end gap-1.5">
              <Button onClick={() => useCommit.getState().dismiss(repo)}>
                Not now
              </Button>
              <Button onClick={() => stageAll(true)}>Always</Button>
              <Button variant="primary" onClick={() => stageAll(false)}>
                Stage all &amp; commit
              </Button>
            </div>
          </div>
        )}
        {flow.notice && (
          <p
            role="alert"
            className="text-label text-remove-ink dark:text-remove-ink-dark"
          >
            {flow.notice}
          </p>
        )}
        {status.branch === '(detached)' && (
          <p className="text-label text-modified">
            This commit will be created on detached HEAD.
          </p>
        )}
        <div className="flex">
          <Button
            disabled={disabled}
            variant="primary"
            className="min-w-0 flex-1 rounded-r-none"
            onClick={() => commit(active)}
          >
            {flow.phase === 'idle' ? (
              <GitCommitHorizontal className="size-3.5" />
            ) : (
              <Loader2 className="size-3.5 animate-spin" />
            )}
            <span className="truncate">{label}</span>
          </Button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button
                disabled={disabled || !pushable}
                variant="primary"
                aria-label="Commit options"
                className="rounded-l-none border-l border-white/30 px-1.5 dark:border-surface-dark/30"
              >
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                side="top"
                sideOffset={4}
                className="z-30 flex w-48 flex-col rounded-md border border-line bg-surface p-1 text-ink shadow-lg dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
              >
                <DropdownMenu.RadioGroup
                  value={active}
                  onValueChange={(value) =>
                    useTabs.getState().setCommitMode(repo, value as CommitMode)
                  }
                >
                  {(Object.keys(modes) as CommitMode[]).map((option) => (
                    <DropdownMenu.RadioItem
                      key={option}
                      value={option}
                      className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs outline-none data-highlighted:bg-hover dark:data-highlighted:bg-hover-dark ${focus}`}
                    >
                      <span className="flex size-3 items-center justify-center">
                        <DropdownMenu.ItemIndicator>
                          <Check className="size-3" />
                        </DropdownMenu.ItemIndicator>
                      </span>
                      <span className="flex-1">{modes[option].label}</span>
                      <span className="text-label text-muted dark:text-muted-dark">
                        {shortcutLabel(modes[option].key)}
                      </span>
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
    </section>
  );
}
