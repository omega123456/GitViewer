# GitViewer2

A Tauri 2 Git client for macOS and Windows with lazy file browsing, text and image diffs, file and hunk staging, branches, synchronization, history, blame, and stashes.

## Development

Install Node.js with pnpm 11.25.0, a current Rust toolchain, and Git 2.38 or newer. Native development also requires the platform's Tauri build prerequisites.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev:web` starts the presentation layer only. Repository operations require the desktop runtime.

## Verification

```sh
pnpm lint
pnpm typecheck
pnpm run format
cargo fmt --manifest-path src-tauri/Cargo.toml --check
pnpm clippy
pnpm test:coverage
pnpm test:rust:coverage
pnpm test:e2e
pnpm build
cargo build --manifest-path src-tauri/Cargo.toml --no-default-features
```

Rust coverage requires `cargo-llvm-cov` and `llvm-tools-preview`. Browser tests require `pnpm exec playwright install chromium`. Native filesystem events and Chromium startup need normal macOS process permissions; a restrictive process sandbox can prevent those tests from running.

Clippy checks both production and test features. CI also builds the production desktop binary: the `test-utils` feature deliberately replaces OS-opening and global-settings operations, so testing that feature alone cannot verify the shipping application.

## Implementation notes

Hunk actions re-read the diff using its displayed context and compare the patch before applying it. CRLF bytes and missing-final-newline markers survive patch construction. Expanded context can combine nearby changes into one displayed hunk; applying that hunk applies all changes shown in it.

Text limits can be overridden per selection. The 20 MB image ceiling also applies at the custom protocol endpoint; oversized images can be opened in the system application.

Ordinary working-tree edits preserve history pagination. HEAD and reference changes invalidate it. Closing a repository removes its frontend cache and drops its backend watcher and history process.

Changes-tree directory checkboxes are indeterminate when a descendant is partly staged. Tree identifiers support filenames such as `root`, `constructor`, and `__proto__` without colliding with internal nodes.

## Remaining platform verification

The automated suites and native build have been verified locally on macOS. The CI matrix includes Windows, but a Windows run has not been verified from this workspace. Windows-specific Playwright screenshot baselines still need to be captured and visually reviewed on Windows; the checked-in baselines are macOS captures. No screenshot tolerance was increased.

The live-credential smoke check remains pending in `CLAUDE.md`. Automated Git tests use isolated repositories and local bare remotes, without the user's credential helpers or global Git configuration.
