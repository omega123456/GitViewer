import { ExternalLink, Pencil } from 'lucide-react';
import { perform } from '../../lib/query';
import type { ComponentProps } from 'react';
import { Button } from '../shared/Button';
import { CopyButton } from '../shared/CopyButton';
import { addedInk, removedInk } from '../shared/styles';
import type { ChangeCounts } from './useDiffFile';
const changeCount = 'shrink-0 font-mono text-badge';
export function openInSystem(repo: string, path: string) {
  return perform('system_open', { repo: repo, path: path });
}
export function CopyPathButton({ path }: { path: string }) {
  return (
    <CopyButton
      text={path}
      label="Copy file path"
      className="size-6 text-muted dark:text-muted-dark"
    />
  );
}
export function OpenInSystemButton({
  repo,
  path,
}: {
  repo: string;
  path: string;
}) {
  return (
    <Button
      title="Open in system application"
      onClick={() => void openInSystem(repo, path)}
    >
      <ExternalLink className="size-4" />
      <span>Open</span>
    </Button>
  );
}
export function EditButton({
  label,
  labelClassName,
  ...props
}: ComponentProps<typeof Button> & { label: string; labelClassName?: string }) {
  return (
    <Button {...props}>
      <Pencil className="size-4" />
      <span className={labelClassName}>{label}</span>
    </Button>
  );
}
export function ChangeCountBadges({ counts }: { counts: ChangeCounts }) {
  return (
    <>
      {Boolean(counts.added) && (
        <span className={`${changeCount} ${addedInk}`}>+{counts.added}</span>
      )}
      {Boolean(counts.removed) && (
        <span className={`${changeCount} ${removedInk}`}>
          −{counts.removed}
        </span>
      )}
    </>
  );
}
