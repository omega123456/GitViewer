import { memo } from 'react';
import type { Status } from '../../lib/types';
import {
  useLayout,
  useLayoutField,
  sectionHeightBounds,
} from '../../stores/layout';
import { Section } from '../shared/Section';
import { dynamic } from '../shared/styles';
import { SectionResizeHandle } from '../shell/ResizeHandle';
import { FilesTree } from './FileTree';
export const FilesSection = memo(function FilesSection({
  repo,
  status,
}: {
  repo: string;
  status: Status;
}) {
  const filesOpen = useLayoutField(repo, 'filesOpen');
  const filesHeight = useLayoutField(repo, 'filesHeight');
  return (
    <>
      {filesOpen && (
        <SectionResizeHandle
          label="Resize files section"
          bounds={sectionHeightBounds}
          value={filesHeight}
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
