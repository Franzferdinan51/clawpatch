import { readFile, mkdtemp, writeFile } from "node:fs/promises";
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
 * DuckHive provider — "The Mega AI Coding Harness"
 *
 * Uses the `duckhive` CLI with structured prompts. DuckHive takes prompts
 * as positional arguments and outputs conversational text. We request strict
 * JSON in the prompt and extract it from the output.
 *
 * Supports environment variables:
 * - DUCKHIVE_NO_AUTO_TUI=1 (set automatically to prevent TUI launch)
 * - DUCKHIVE_AGENT_RUNTIME=auto|builtin
 * - DUCKHIVE_AGENT_HARNESS_FALLBACK=builtin|none
 */
export const duckhiveProvider: Provider = {
  name: "duckhive",

  async check(root: string): Promise<string> {
    return checkHarness("duckhive", "duckhive --version", root);
  },

  async review(root: string, prompt: string, model: string | null): Promise<ReviewOutput> {
    const output = await runDuckHive(root, prompt, model);
    const parsed = extractJsonFromOutput(output);
    return reviewOutputSchema.parse(parsed);
  },

  async fix(root: string, prompt: string, model: string | null): Promise<FixPlanOutput> {
    const output = await runDuckHive(root, prompt, model);
    const parsed = extractJsonFromOutput(output);
    return fixPlanOutputSchema.parse(parsed);
  },

  async revalidate(root: string, prompt: string, model: string | null): Promise<RevalidateOutput> {
    const output = await runDuckHive(root, prompt, model);
    const parsed = extractJsonFromOutput(output);
    return revalidateOutputSchema.parse(parsed);
  },
};

async function runDuckHive(
  root: string,
  prompt: string,
  model: string | null,
): Promise<string> {
  const modelArg = model !== null ? ` --model ${shellQuote(model)}` : "";

  // Write prompt to a temp file to avoid shell argument length limits
  const dir = await mkdtemp(join(tmpdir(), "clawpatch-duckhive-"));
  const promptPath = join(dir, "prompt.txt");
  await writeFile(promptPath, prompt, "utf8");

  // Use cat to pipe the prompt file content into duckhive
  // DUCKHIVE_NO_AUTO_TUI=1 prevents the Go TUI from launching
  const command = `cat ${shellQuote(promptPath)} | DUCKHIVE_NO_AUTO_TUI=1 duckhive${modelArg}`;
  const result = await runCommand(command, root);

  if (result.exitCode !== 0) {
    throw new ClawpatchError(
      `duckhive provider failed: ${result.stderr || result.stdout}`,
      duckhiveExitCode(result.stderr),
      "provider-failure",
    );
  }

  const output = result.stdout.trim();
  if (output.length === 0) {
    throw new ClawpatchError(
      "duckhive provider produced no output",
      8,
      "malformed-output",
    );
  }

  return output;
}

function duckhiveExitCode(stderr: string): number {
  if (/auth|login|api key/iu.test(stderr)) {
    return 4;
  }
  if (/quota|rate.?limit/iu.test(stderr)) {
    return 5;
  }
  return 1;
}
