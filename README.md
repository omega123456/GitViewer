# GitViewer

GitViewer is a diff-first desktop Git client for macOS and Windows. It puts the file tree and the current changes before the commit graph.

The application uses the Git installation on your computer. This keeps your credential helpers, hooks, Git LFS filters, and repository settings in use.

## Highlights

- Browse the full working tree, including untracked and ignored files.
- Review text changes in split or unified views with syntax and word-level highlighting.
- Compare images side by side, with a swipe control, or with an onion-skin blend.
- Stage, unstage, or discard files and individual hunks.
- Edit working-tree text files with version-checked saves.
- Create commits, push changes, and generate commit messages with an optional OpenAI-compatible endpoint.
- Create, switch, compare, merge, and delete branches.
- Fetch, pull, push, inspect history, read blame, and manage stashes.
- Keep multiple repositories and files open in tabs.
- Use a command palette, keyboard shortcuts, light and dark themes, and compact or comfortable layouts.

GitViewer opens existing local repositories. It does not clone repositories or provide specialized workflows for rebase, cherry-pick, tags, submodules, or worktrees.

## How it works

GitViewer is a [Tauri 2](https://v2.tauri.app/) application. React and TypeScript render the interface, while Rust owns Git operations, file access, persistence, and process control.

The frontend sends all backend requests through one typed IPC command. Rust routes each request and runs the system `git` executable with machine-readable output.

TanStack Query stores backend data. Zustand stores interface state. Rust events tell the query layer when repository data changes.

## Requirements

- macOS or Windows
- Git 2.38 or newer
- Node.js 24
- pnpm 11.25.0
- Rust 1.85 or newer
- The [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system

## Run from source

```sh
git clone https://github.com/omega123456/GitViewer.git
cd GitViewer
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` starts the native desktop application. Use `pnpm dev:web` only for interface work because repository operations require the Tauri runtime.

## Development commands

| Command              | Purpose                                                    |
| -------------------- | ---------------------------------------------------------- |
| `pnpm dev`           | Start the desktop application                              |
| `pnpm dev:web`       | Start the frontend without native repository operations    |
| `pnpm typecheck`     | Check TypeScript types                                     |
| `pnpm lint`          | Run ESLint                                                 |
| `pnpm run format`    | Check formatting                                           |
| `pnpm clippy`        | Check Rust production and test builds                      |
| `pnpm test`          | Run frontend tests                                         |
| `pnpm test:rust`     | Run Rust integration tests                                 |
| `pnpm test:e2e`      | Run Playwright tests                                       |
| `pnpm test:all`      | Run frontend coverage, Rust coverage, and Playwright tests |
| `pnpm build:desktop` | Build the desktop application                              |

Install Chromium before the first end-to-end test:

```sh
pnpm exec playwright install chromium
```

Rust coverage requires `cargo-nextest`, `cargo-llvm-cov`, and the `llvm-tools-preview` Rust component. The screenshot baselines are macOS captures.

For a production build without test-only features, run:

```sh
cargo build --manifest-path src-tauri/Cargo.toml --no-default-features
```

## Project structure

```text
src/                    React interface, stores, providers, and frontend tests
src-tauri/src/          Rust backend and Tauri integration
src-tauri/tests/        Rust integration tests
e2e/                    Playwright tests and visual baselines
.agent/adr/             Append-only architecture decisions
.agent/plans/           Implementation plans
```

The central command map is in `src/lib/types.ts`. The Rust dispatcher is in `src-tauri/src/ipc.rs`, and the query event bridge is in `src/lib/query.ts`.

## Local data

GitViewer saves settings and session data in the operating system application-data directory. Debug and release builds use separate application identifiers.

Application logs rotate daily and remain for seven days:

- macOS: `~/Library/Logs/<identifier>`
- Windows: `%LOCALAPPDATA%/<identifier>/logs`

The optional AI API key stays in the operating system credential store. GitViewer sends change material only to the endpoint that you configure.

## Releases

The release workflow builds signed updater packages for Apple silicon macOS and x64 Windows. A version tag starts the workflow and publishes the verified files through GitHub Releases.

macOS releases use a self-signed identity and are not notarized. Gatekeeper can show a warning when you open the application for the first time.

## Project status

GitViewer is under active development. The automated suites and native build are verified locally on macOS. The GitHub Actions build matrix also builds the Windows target.
