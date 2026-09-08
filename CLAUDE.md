# GitViewer2 conventions


**Architecture**

- Rust owns data, process control, persistence and business logic. React owns presentation and interaction state.
- TanStack Query owns anything from Rust. Zustand owns anything the user did that Rust does not know about. Rust events reach Query through one bridge layer, and nothing invalidates by hand outside it.
- One generic invoke function keyed on a central command map. Adding a command means a map entry and a Rust handler, never a per-command wrapper. Events are named `domain://event`.
- A permission error almost always means a missing entry in the capabilities file or a name mismatch with the registered Rust command.

**Code**

- **No comments and no docblocks.** Do not write `//`, `/* */`, `///`, `//!`, `#`, JSDoc, TSDoc or Rust doc comments in any production or test file. Names, types and small functions carry the meaning instead. If something needs explaining, rename it or split it until it does not. Rationale and rejected alternatives belong in the commit message, the pull request, or an ADR under `.agent/adr/`, never in the source. This applies to new code and to any code touched during a change. The only exceptions are machine-read directives that must be in the file to work: `#!` shebangs, `#[...]` and `@ts-*` attributes, and license headers where they are legally required.
- **All date and time work goes through the date library.** Use `date-fns` in TypeScript and `chrono` in Rust, in production code **and** in tests, with no exception for simple cases. Forbidden: manual millisecond or second arithmetic, hand-rolled formatting from date parts, ad hoc parsing of date strings, and hand-written relative-time or duration logic. This rule matters here because history rows, blame blocks and stash rows all render relative timestamps, which is exactly the path it guards.

**Styling**

- Pure Tailwind utility classes. No custom CSS rules, no `@apply`, no bracket values. Every custom value is a named `@theme` token.
- `index.css` holds only the Tailwind import, the dark variant, and the `@theme` block.
- The sole exception is an inline CSS custom property for a genuinely dynamic value.
- **The radius scale is redefined**, matching the sibling project: `--radius` is `0.5rem` and `--radius-md` is `0.75rem`, alongside the named product radii. This matters because the plan permits only named tokens, so a component cannot reach for an arbitrary radius.

**Testing**

- **Coverage gates, stated per side because the tools measure different things.** Vitest: 90% lines, 90% functions, 90% statements. `cargo-llvm-cov`: 90% lines, 90% functions, 80% regions — it exposes no statements metric, so asking for one is unverifiable. Excluding functions or files from coverage is prohibited on both sides: no ignore comments, no coverage include or exclude tweaks that skip production code, and no configuration attribute used to dodge the gate.
- Every test lives in a dedicated test root. Production files contain only shipping code.
- Never embed a test attribute or a test module inside `src-tauri/src/`. All Rust tests live in `src-tauri/tests/`.
- All Rust integration tests compile into one binary through a single module list, because each additional test target relinks the whole dependency graph.
- Rust tests run with a test-utils feature. Any code path that can touch machine-global state compiles to a fake or returns an unsupported result under it.
- Vitest IPC mocking is centralized in one shared harness. Ad hoc per-test mocks are prohibited, and the intentional unmocked-command failure is part of the contract.
- **Vitest must run without React `act(...)` warnings.** Treat any `act(...)` output as unfinished work and fix the test, rather than ignoring the warning. The default reporter hides console output for passing tests, so a run can look clean while warnings still fire. Surface them with the verbose reporter and search the error stream for `not wrapped in act`. A common source is a test calling a Zustand store setter directly while a component from that test is still mounted and subscribed.
- **Tests must never hit real machine-global state.** Any code path that can touch the user's own git configuration, credential helpers or global OS settings compiles to a fake or returns an unsupported result under the test-utils feature. No test may accept "the real thing succeeded" as a passing branch.
- No fixed delay over five seconds in any test. Each unit suite completes in under one second, and each screenshot in under two.
- Playwright screenshot tolerance is never increased to make a test pass. Any regenerated baseline is inspected before it is accepted.

**Process**

- `pnpm` only.
- Every change works on both macOS and Windows.
- Lint is genuinely clean, with no suppressions.

Manual credential smoke check: pending; automated tests use isolated local repositories and a bare remote.
