import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { Marked, type Tokens } from 'marked';
import { highlight } from '../../lib/highlight';
import { useDark } from '../../stores/theme';
const extensions = ['md', 'markdown'];
export function isMarkdown(path: string) {
  return extensions.includes(path.split('.').pop()?.toLowerCase() ?? '');
}
function escape(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
async function highlightFence(code: string, language: string, dark: boolean) {
  const lines = await highlight(code, `fence.${language}`, dark);
  return lines
    .map((line) =>
      line
        .map((token) =>
          token.color
            ? `<span style="color:${token.color}">${escape(token.content)}</span>`
            : escape(token.content),
        )
        .join(''),
    )
    .join('\n');
}
export async function renderMarkdown(markdown: string, dark: boolean) {
  const marked = new Marked({ gfm: true, async: true });
  marked.use({
    async walkTokens(token) {
      if (token.type !== 'code') return;
      const fence = token as Tokens.Code;
      fence.text = await highlightFence(fence.text, fence.lang ?? '', dark);
      fence.escaped = true;
    },
  });
  return DOMPurify.sanitize(await marked.parse(markdown));
}
export function MarkdownView({
  markdown,
  deleted,
}: {
  markdown: string;
  deleted: boolean;
}) {
  const dark = useDark();
  const [html, setHtml] = useState('');
  useEffect(() => {
    let cancelled = false;
    void renderMarkdown(markdown, dark)
      .then((result) => {
        if (!cancelled) setHtml(result);
      })
      .catch(() => {
        if (!cancelled) setHtml('');
      });
    return () => {
      cancelled = true;
    };
  }, [markdown, dark]);
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {deleted && (
        <p className="border-b border-line bg-remove px-4 py-2 text-xs text-remove-ink dark:border-line-dark dark:bg-remove-dark dark:text-remove-ink-dark">
          This file was deleted. You are reading its last version.
        </p>
      )}
      <article
        className="prose prose-sm max-w-none px-6 py-5 prose-code:before:content-none prose-code:after:content-none prose-pre:border prose-pre:border-line prose-pre:bg-sub prose-pre:text-ink dark:prose-invert dark:prose-pre:border-line-dark dark:prose-pre:bg-sub-dark dark:prose-pre:text-ink-dark"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
