import { keysOf } from './options';
import {
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
} from './file-types/media';
import {
  ARCHIVE_EXTENSIONS,
  DISC_EXTENSIONS,
  EXECUTABLE_EXTENSIONS,
} from './file-types/packages';
import {
  CODE_EXTENSIONS,
  WEB_EXTENSIONS,
  CONFIG_EXTENSIONS,
} from './file-types/source';
import {
  TEXT_EXTENSIONS,
  OFFICE_EXTENSIONS,
  FONT_EXTENSIONS,
  DATABASE_EXTENSIONS,
} from './file-types/documents';
export type FileCategory =
  | 'folder'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'disc'
  | 'code'
  | 'web'
  | 'config'
  | 'text'
  | 'office'
  | 'font'
  | 'database'
  | 'executable'
  | 'generic';

export type FolderGlyph = 'downloads' | 'git' | 'modules' | 'open' | 'closed';

type ClassifiedCategory = Exclude<FileCategory, 'folder' | 'generic'>;

const EXTENSIONS: Record<ClassifiedCategory, string[]> = {
  image: IMAGE_EXTENSIONS,
  video: VIDEO_EXTENSIONS,
  audio: AUDIO_EXTENSIONS,
  archive: ARCHIVE_EXTENSIONS,
  disc: DISC_EXTENSIONS,
  code: CODE_EXTENSIONS,
  web: WEB_EXTENSIONS,
  config: CONFIG_EXTENSIONS,
  text: TEXT_EXTENSIONS,
  office: OFFICE_EXTENSIONS,
  font: FONT_EXTENSIONS,
  database: DATABASE_EXTENSIONS,
  executable: EXECUTABLE_EXTENSIONS,
};

const SPECIAL_NAMES = new Map<string, FileCategory>([
  ['.gitignore', 'config'],
  ['.gitattributes', 'config'],
  ['.dockerignore', 'config'],
  ['.editorconfig', 'config'],
  ['dockerfile', 'config'],
]);

const BY_EXTENSION = new Map<string, FileCategory>(
  keysOf(EXTENSIONS).flatMap((category) =>
    EXTENSIONS[category].map((extension) => [extension, category] as const),
  ),
);

export function fileCategory(name: string, directory: boolean): FileCategory {
  if (directory) return 'folder';
  const lower = name.toLowerCase();
  const special = SPECIAL_NAMES.get(lower);
  if (special) return special;
  const dot = lower.lastIndexOf('.');
  if (dot <= 0) return 'generic';
  return BY_EXTENSION.get(lower.slice(dot + 1)) ?? 'generic';
}

export function folderGlyph(name: string, expanded: boolean): FolderGlyph {
  const lower = name.toLowerCase();
  if (lower === 'downloads') return 'downloads';
  if (lower === '.git') return 'git';
  if (lower === 'node_modules') return 'modules';
  return expanded ? 'open' : 'closed';
}
