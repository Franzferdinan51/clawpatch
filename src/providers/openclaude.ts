import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../exec.js";
import { ClawpatchError } from "../errors.js";
import type { Provider } from "../provider.js";
import type { FixPlanOutput, ReviewOutput, RevalidateOutput } from "../types.js";
import {
  fixPlanOutputSchema,
  reviewOutputSchema,
  revalidateOutputSchema,
} from "../types.js";
import {
  checkHarness,
  extractJsonFromOutput,
  shellQuote,
} from "./harness.js";

/**
 * OpenClaude provider — open-source coding-agent CLI
 *
 * Wraps the `openclaude` CLI. Uses -p flag for non-interactive print mode
 * (same as Claude Code). Falls back to stdin piping if -p is not supported.
 *
 * Supports environment variables:
 * - CLAUDE_CODE_USE_OPENAI=1 (OpenAI-compatible mode)
 * - OPENAI_API_KEY, OPENAI_MODEL, OPENAI_BASE_URL
 * - GRPC_PORT / GRPC_HOST (for headless gRPC server mode)
 */
export const openclaudeProvider: Provider = {
  name: "openclaude",

  async check(root: string): Promise<string> {
    return checkHarness("openclaude", "openclaude --version", root);
  },

  async review(root: string, prompt: string, model: string | null): Promise<ReviewOutput> {
    const output = await runOpenClaude(root, prompt, model);
    const parsed = extractJsonFromOutput(output);
    return reviewOutputSchema.parse(parsed);
  },

  async fix(root: string, prompt: string, model: string | null): Promise<FixPlanOutput> {
    const output = await runOpenClaude(root, prompt, model);
    const parsed = extractJsonFromOutput(output);
    return fixPlanOutputSchema.parse(parsed);
  },

  async revalidate(root: string, prompt: string, model: string | null): Promise<RevalidateOutput> {
    const output = await runOpenClaude(root, prompt, model);
    const parsed = extractJsonFromOutput(output);
    return revalidateOutputSchema.parse(parsed);
  },
};

async function runOpenClaude(
  root: string,
  prompt: string,
  model: string | null,
): Promise<string> {
  const modelArg = model !== null ? ` --model ${shellQuote(model)}` : "";

  // Write prompt to temp file to avoid shell argument length limits
  const dir = await mkdtemp(join(tmpdir(), "clawpatch-openclaude-"));
  const promptPath = join(dir, "prompt.txt");
  await writeFile(promptPath, prompt, "utf8");

  // Pipe prompt via stdin using cat, like the duckhive provider.
  // DUCKHIVE_NO_AUTO_TUI-style env vars can be added here if needed.
  const command = `cat ${shellQuote(promptPath)} | openclaude -p${modelArg}`;
  const result = await runCommand(command, root);

  if (result.exitCode !== 0) {
    throw new ClawpatchError(
      `openclaude provider failed: ${result.stderr || result.stdout}`,
      openclaudeExitCode(result.stderr),
      "provider-failure",
    );
  }

  const output = result.stdout.trim();
  if (output.length === 0) {
    throw new ClawpatchError(
      "openclaude provider produced no output",
      8,
      "malformed-output",
    );
  }

  return output;
}

function openclaudeExitCode(stderr: string): number {
  if (/auth|login|api key/iu.test(stderr)) {
    return 4;
  }
  if (/quota|rate.?limit/iu.test(stderr)) {
    return 5;
  }
  return 1;
}
