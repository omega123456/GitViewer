import {
  createHighlighter,
  bundledLanguages,
  type BundledLanguage,
} from 'shiki';
const aliases: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  rs: 'rust',
  py: 'python',
  md: 'markdown',
  yml: 'yaml',
  sh: 'bash',
};
let highlighter: ReturnType<typeof createHighlighter> | undefined;
export async function highlight(content: string, path: string, dark: boolean) {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  const language = aliases[extension] ?? extension;
  if (!(language in bundledLanguages))
    return content
      .split('\n')
      .map((line) => [{ content: line, color: undefined }]);
  highlighter ??= createHighlighter({
    themes: ['github-light', 'github-dark'],
    langs: [],
  });
  const engine = await highlighter;
  if (!engine.getLoadedLanguages().includes(language))
    await engine.loadLanguage(language as BundledLanguage);
  return engine.codeToTokens(content, {
    lang: language as BundledLanguage,
    theme: dark ? 'github-dark' : 'github-light',
  }).tokens;
}

export function markedTokens(
  tokens: { content: string; color?: string }[],
  marks: { text: string; changed: boolean }[],
) {
  let markIndex = 0;
  let remaining = marks[0]?.text.length ?? Infinity;
  const result: { content: string; color?: string; changed: boolean }[] = [];
  for (const token of tokens) {
    let offset = 0;
    while (offset < token.content.length) {
      if (remaining === 0) {
        markIndex++;
        remaining = marks[markIndex]?.text.length ?? Infinity;
      }
      const length = Math.min(token.content.length - offset, remaining);
      result.push({
        content: token.content.slice(offset, offset + length),
        color: token.color,
        changed: marks[markIndex]?.changed ?? false,
      });
      offset += length;
      remaining -= length;
    }
  }
  return result;
}
