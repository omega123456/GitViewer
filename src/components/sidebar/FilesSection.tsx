import type { Status } from '../../lib/types';
import { Section } from '../shared/Section';
import { FilesTree } from './FileTree';
export function FilesSection({
  repo,
  status,
}: {
  repo: string;
  status: Status;
}) {
  return (
    <Section title="Files">
      <FilesTree repo={repo} status={status} />
    </Section>
  );
}
