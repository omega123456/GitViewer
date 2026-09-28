import { memo } from 'react';
import type { Status } from '../../lib/types';
import { useLayout, useLayoutFields } from '../../stores/layout';
import { Section } from '../shared/Section';
import { dynamic } from '../shared/styles';
import { percentBelow, ResizeHandle } from '../shell/ResizeHandle';
import { FilesTree } from './FileTree';
export const FilesSection = memo(function FilesSection({
  repo,
  status,
}: {
  repo: string;
  status: Status;
}) {
  const { filesOpen, filesHeight } = useLayoutFields(
    repo,
    'filesOpen',
    'filesHeight',
  );
  return (
    <>
      {filesOpen && (
        <ResizeHandle
          label="Resize files section"
          orientation="vertical"
          min={20}
          max={60}
          step={2}
          value={filesHeight}
          className="h-1.5 shrink-0 cursor-row-resize border-y border-line hover:bg-accent focus-visible:bg-accent dark:border-line-dark"
          measure={percentBelow}
          onChange={(next) =>
            useLayout.getState().update(repo, { filesHeight: next })
          }
        />
      )}
      <div
        className={
          filesOpen ? 'flex h-files min-h-0 flex-col' : 'flex flex-col'
        }
        style={dynamic({ '--files-height': `${filesHeight}%` })}
      >
        <Section
          title="Files"
          open={filesOpen}
          onOpenChange={(next) =>
            useLayout.getState().update(repo, { filesOpen: next })
          }
        >
          <FilesTree repo={repo} status={status} />
        </Section>
      </div>
    </>
  );
});
