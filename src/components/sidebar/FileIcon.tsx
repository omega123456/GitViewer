import {
  CodeXml,
  Database,
  Disc,
  File,
  FileArchive,
  FileCode2,
  FileImage,
  FileMusic,
  FileSliders,
  FileTerminal,
  FileText,
  FileType,
  FileVideo,
  Folder,
  FolderDown,
  FolderGit2,
  FolderOpen,
  Package,
  Type,
  type LucideIcon,
} from 'lucide-react';
import {
  fileCategory,
  folderGlyph,
  type FileCategory,
  type FolderGlyph,
} from '../../lib/file-type';

const glyphs: Record<Exclude<FileCategory, 'folder'>, LucideIcon> = {
  code: FileCode2,
  web: CodeXml,
  office: FileType,
  config: FileSliders,
  database: Database,
  image: FileImage,
  video: FileVideo,
  audio: FileMusic,
  font: Type,
  text: FileText,
  archive: FileArchive,
  disc: Disc,
  executable: FileTerminal,
  generic: File,
};

const folderGlyphs: Record<FolderGlyph, LucideIcon> = {
  downloads: FolderDown,
  git: FolderGit2,
  modules: Package,
  open: FolderOpen,
  closed: Folder,
};

const tints: Record<FileCategory, string> = {
  folder: 'text-folder dark:text-folder-dark',
  code: 'text-file-code dark:text-file-code-dark',
  web: 'text-file-web dark:text-file-web-dark',
  office: 'text-file-office dark:text-file-office-dark',
  config: 'text-file-config dark:text-file-config-dark',
  database: 'text-file-db dark:text-file-db-dark',
  image: 'text-file-image dark:text-file-image-dark',
  video: 'text-file-video dark:text-file-video-dark',
  audio: 'text-file-audio dark:text-file-audio-dark',
  font: 'text-file-font dark:text-file-font-dark',
  text: 'text-file-text dark:text-file-text-dark',
  archive: 'text-file-archive dark:text-file-archive-dark',
  disc: 'text-file-disc dark:text-file-disc-dark',
  executable: 'text-file-exec dark:text-file-exec-dark',
  generic: 'text-muted dark:text-muted-dark',
};

export function FileIcon({
  name,
  directory,
  expanded = false,
}: {
  name: string;
  directory: boolean;
  expanded?: boolean;
}) {
  const category = fileCategory(name, directory);
  const Glyph =
    category === 'folder'
      ? folderGlyphs[folderGlyph(name, expanded)]
      : glyphs[category];
  return <Glyph className={`size-3 shrink-0 ${tints[category]}`} />;
}
