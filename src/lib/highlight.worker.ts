import {
  bundledLanguages,
  createHighlighter,
  type BundledLanguage,
  type GrammarState,
  type Highlighter,
} from 'shiki';
export interface Token {
  content: string;
  color?: string;
}
export interface Job {
  type: 'job';
  id: number;
  path: string;
  dark: boolean;
  lines: string[];
}
export type Request = Job | { type: 'cancel'; id: number };
export type Reply =
  | { id: number; start: number; lines: Token[][]; done: boolean }
  | { id: number; failed: true };
export const chunkLines = 500;
export const longestLine = 2000;
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
function languageOf(path: string) {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  const language = aliases[extension] ?? extension;
  return language in bundledLanguages ? (language as BundledLanguage) : null;
}
interface Running extends Job {
  language: BundledLanguage | null;
  start: number;
  state?: GrammarState;
}
function pause() {
  return new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}
export function highlightWorker(reply: (message: Reply) => void) {
  let engine: Promise<Highlighter> | undefined;
  let ready: Highlighter | undefined;
  const queue: Running[] = [];
  const live = new Set<number>();
  let busy = false;
  async function tokenize(job: Running) {
    const lines = job.lines.slice(job.start, job.start + chunkLines);
    if (!job.language) return lines.map((content) => [{ content }]);
    engine ??= createHighlighter({
      themes: ['github-light', 'github-dark'],
      langs: [],
    });
    ready = await engine;
    if (!ready.getLoadedLanguages().includes(job.language))
      await ready.loadLanguage(job.language);
    const result = ready.codeToTokens(lines.join('\n'), {
      lang: job.language,
      theme: job.dark ? 'github-dark' : 'github-light',
      grammarState: job.state,
      tokenizeMaxLineLength: longestLine + 1,
    });
    job.state = result.grammarState;
    return result.tokens.map((line) =>
      line.map((token): Token =>
        token.color
          ? { content: token.content, color: token.color }
          : { content: token.content },
      ),
    );
  }
  async function pump() {
    busy = true;
    while (queue.length) {
      const job = queue.shift()!;
      try {
        const lines = await tokenize(job);
        if (live.has(job.id)) {
          const start = job.start;
          job.start += chunkLines;
          const done = job.start >= job.lines.length;
          reply({ id: job.id, start, lines, done });
          if (done) live.delete(job.id);
          else queue.push(job);
        }
      } catch {
        if (live.delete(job.id)) reply({ id: job.id, failed: true });
      }
      await pause();
    }
    busy = false;
  }
  return {
    receive(message: Request) {
      if (message.type === 'cancel') {
        live.delete(message.id);
        const index = queue.findIndex((job) => job.id === message.id);
        if (index >= 0) queue.splice(index, 1);
        return;
      }
      live.add(message.id);
      queue.push({ ...message, language: languageOf(message.path), start: 0 });
      if (!busy) void pump();
    },
    languages: () => ready?.getLoadedLanguages() ?? [],
  };
}
if (typeof window === 'undefined') {
  const worker = highlightWorker((message) => self.postMessage(message));
  self.onmessage = (event: MessageEvent<Request>) => worker.receive(event.data);
}
