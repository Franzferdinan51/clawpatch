---
title: Providers
description: "AI provider configuration and model selection"
---

# Providers

clawpatch is an orchestration tool that hands off AI work to external harness CLIs.
It builds prompts, manages state, and parses structured JSON output — but the actual
AI analysis is done by the harness binary.

```bash
clawpatch doctor
```

Available providers:

- `codex`: shells out to `codex exec` (default)
- `duckhive`: shells out to `duckhive` CLI
- `openclaude`: shells out to `openclaude -p` (print mode)
- `mock`: deterministic provider for tests and fixtures
- `mock-fail`: failure provider for tests

## How providers work

1. clawpatch builds a detailed prompt
2. The provider runs the CLI binary via `child_process.spawn`
3. The CLI handles all AI interaction (API calls, model selection, etc.)
4. The CLI returns structured JSON
5. clawpatch validates and persists the results

## Codex provider

- review: read-only sandbox
- revalidate: read-only sandbox
- fix: workspace-write sandbox
- output: strict JSON schema via `--output-schema`
- final message capture: `--output-last-message`

## DuckHive provider

- Pipes prompt via stdin: `cat prompt.txt | duckhive`
- Sets `DUCKHIVE_NO_AUTO_TUI=1` to prevent TUI launch
- Extracts JSON from conversational output

## OpenClaude provider

- Uses print mode: `cat prompt.txt | openclaude -p`
- Extracts JSON from conversational output

## Model selection

```bash
clawpatch review --model <model>
CLAWPATCH_MODEL=<model> clawpatch review
```

## Provider selection

```bash
clawpatch review --provider duckhive
CLAWPATCH_PROVIDER=duckhive clawpatch review
```

Precedence: CLI flag > env var > config file > default (`codex`).
