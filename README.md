# 🩹 clawpatch

Automated code review that lands fixes.

`clawpatch` maps a repo into semantic feature slices, reviews each slice with a
provider, persists findings, and can run an explicit fix loop for one finding at
a time.

Current status: early CLI. Review/report/state are implemented; patching exists
behind `clawpatch fix --finding <id>` and still requires manual review of the
resulting worktree changes.

## Install

```bash
pnpm add -g clawpatch
```

From source:

```bash
pnpm install
pnpm build
pnpm link --global
```

## Workflow

```bash
clawpatch init
clawpatch map
clawpatch review --limit 3 --jobs 3
clawpatch report
clawpatch next
clawpatch show --finding <id>
clawpatch triage --finding <id> --status false-positive --note "covered by tests"
clawpatch fix --finding <id>
clawpatch revalidate --finding <id>
clawpatch revalidate --all --status open
```

`fix` does not commit, push, open PRs, or land changes. It runs configured
validation commands and records a patch attempt under `.clawpatch/`.

## What It Maps Today

- npm package bins
- selected package scripts: `start`, `build`, `test`, `lint`, `typecheck`,
  `format`
- Next.js `app/` and `pages/` routes
- Go package slices from `go list ./...`, including command packages
- Go package tests and same-repo imports as review context
- Rust `src/main.rs`, `src/bin/*.rs`, `src/lib.rs`, `crates/*`, and
  `tests/*.rs`
- SwiftPM `Sources/*` targets and `Tests/*` suites
- common project config files

Deeper framework mappers and agent-assisted enrichment are next steps.

## Providers (Harnesses)

clawpatch is an orchestration tool that hands off AI work to external harness CLIs.
It builds prompts, manages state, and parses structured JSON output — but the actual
AI analysis is done by the harness binary.

| Name | CLI | Notes |
|------|-----|-------|
| `codex` | `codex exec` | Structured JSON via `--output-schema`. Default. |
| `duckhive` | `duckhive` | DuckHive AI harness. Pipes prompt via stdin. |
| `openclaude` | `openclaude` | OpenClaude open-source agent. Uses `-p` print mode. |
| `mock` | — | Test fixture. |
| `mock-fail` | — | Test fixture (always fails). |

### How providers work

Each provider shells out to a CLI binary:

1. clawpatch builds a detailed prompt
2. The provider runs the CLI binary via `child_process.spawn`
3. The CLI handles all AI interaction (API calls, model selection, etc.)
4. The CLI returns structured JSON
5. clawpatch validates and persists the results

This means you need the corresponding CLI installed for each provider.

### Switching providers

Config file (`clawpatch.config.json`):

```json
{
  "provider": { "name": "duckhive", "model": null }
}
```

Environment variables:

```bash
CLAWPATCH_PROVIDER=duckhive
CLAWPATCH_MODEL=your-model-name
```

CLI flag (per-command):

```bash
clawpatch review --provider duckhive --limit 3
clawpatch fix --finding <id> --provider openclaude
clawpatch revalidate --all --provider codex
```

Precedence: CLI flag > env var > config file > default (`codex`).

Check provider availability:

```bash
clawpatch doctor
```

All providers honour `--model <name>` on `review`, `fix`, and `revalidate`.

## Commands

- `clawpatch init`: create `.clawpatch/`, detect project basics, write config
- `clawpatch map`: write feature records
- `clawpatch status`: show project, dirty state, feature/finding counts
- `clawpatch review`: review pending or selected features
- `clawpatch report`: print or write a Markdown findings report
- `clawpatch next`: print the next actionable finding
- `clawpatch show --finding <id>`: inspect one finding with evidence and suggested validation
- `clawpatch triage --finding <id> --status <status>`: mark a finding with optional history note
- `clawpatch fix --finding <id>`: run the explicit patch loop for one finding
- `clawpatch revalidate --finding <id>`: re-check one finding
- `clawpatch revalidate --all`: re-check open findings with report-style filters
- `clawpatch doctor`: check provider availability
- `clawpatch clean-locks`: clear feature locks

Useful flags:

- `--root <path>`
- `--state-dir <path>`
- `--config <path>`
- `--json`
- `--plain`
- `--limit <n>`
- `--jobs <n>`
- `--feature <id>`
- `--finding <id>`
- `--status <status>`
- `--severity <severity>`
- `--provider <name>`
- `--model <name>`
- `--output <path>` / `-o <path>`
- `--dry-run`
- `--force`

Unknown flags fail fast.

## State

State is project-local by default:

```text
.clawpatch/
  config.json
  project.json
  features/*.json
  findings/*.json
  patches/*.json
  reports/*.md
  runs/*.json
```

Feature records are the durable work units. Findings and patch attempts link back
to features so runs can resume and be audited.

## Safety

- Review does not edit files.
- Fix is explicit and selected by finding ID.
- Fix refuses a dirty source worktree by default.
- Clawpatch never commits, pushes, opens PRs, or lands changes today.
- Provider output is parsed through strict schemas.
- Symlinked directories and generated build output are skipped during mapping.

See `docs/spec.md` for the longer product and implementation spec.
