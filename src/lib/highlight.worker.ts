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
export interface FailedReply {
  id: number;
  failed: true;
}
export type Reply =
  { id: number; start: number; lines: Token[][]; done: boolean } | FailedReply;
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
  return isBundledLanguage(language) ? language : null;
}
function isBundledLanguage(language: string): language is BundledLanguage {
  return language in bundledLanguages;
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
interface Engine {
  loading?: Promise<Highlighter>;
  ready?: Highlighter;
}
async function loadedHighlighter(engine: Engine, language: BundledLanguage) {
  engine.loading ??= createHighlighter({
    themes: ['github-light', 'github-dark'],
    langs: [],
  });
  const ready = await engine.loading;
  engine.ready = ready;
  if (!ready.getLoadedLanguages().includes(language))
    await ready.loadLanguage(language);
  return ready;
}
function plainToken(content: string, color?: string): Token {
  return color ? { content: content, color: color } : { content: content };
}
async function tokenizeChunk(engine: Engine, job: Running) {
  const lines = job.lines.slice(job.start, job.start + chunkLines);
  if (!job.language) return lines.map((content) => [{ content }]);
  const ready = await loadedHighlighter(engine, job.language);
  const result = ready.codeToTokens(lines.join('\n'), {
    lang: job.language,
    theme: job.dark ? 'github-dark' : 'github-light',
    grammarState: job.state,
    tokenizeMaxLineLength: longestLine + 1,
  });
  job.state = result.grammarState;
  return result.tokens.map((line) =>
    line.map((token) => plainToken(token.content, token.color)),
  );
}
function removeQueued(queue: Running[], id: number) {
  const index = queue.findIndex((job) => job.id === id);
  if (index >= 0) queue.splice(index, 1);
}
export function highlightWorker(reply: (message: Reply) => void) {
  const engine: Engine = {};
  const queue: Running[] = [];
  const live = new Set<number>();
  let busy = false;
  async function advance(job: Running) {
    const lines = await tokenizeChunk(engine, job);
    if (!live.has(job.id)) return;
    const start = job.start;
    job.start += chunkLines;
    const done = job.start >= job.lines.length;
    reply({ id: job.id, start: start, lines: lines, done: done });
    if (done) {
      live.delete(job.id);
      return;
    }
    queue.push(job);
  }
  async function process(job: Running) {
    try {
      await advance(job);
    } catch {
      if (live.delete(job.id)) reply({ id: job.id, failed: true });
    }
  }
  async function pump() {
    busy = true;
    let job = queue.shift();
    while (job) {
      await process(job);
      await pause();
      job = queue.shift();
    }
    busy = false;
  }
  return {
    receive(message: Request) {
      if (message.type === 'cancel') {
        live.delete(message.id);
        removeQueued(queue, message.id);
        return;
      }
      live.add(message.id);
      queue.push({ ...message, language: languageOf(message.path), start: 0 });
      if (!busy) void pump();
    },
    languages() {
      return engine.ready?.getLoadedLanguages() ?? [];
    },
  };
}
if (typeof window === 'undefined') {
  const worker = highlightWorker((message) => self.postMessage(message));
  self.onmessage = (event: MessageEvent<Request>) => worker.receive(event.data);
}
