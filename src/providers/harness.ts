/**
 * Shared utilities for harness-based providers (DuckHive, OpenClaude, etc.)
 *
 * Unlike Codex which has --output-schema for structured JSON output,
 * harness CLIs produce free-form text. These utilities handle extracting
 * structured JSON from conversational LLM output.
 */

import { runCommand } from "../exec.js";
import { ClawpatchError } from "../errors.js";

/**
 * Extract a JSON object from free-form LLM output.
 *
 * Handles common patterns:
 * - Raw JSON
 * - JSON wrapped in ```json ... ``` markdown fences
 * - JSON mixed with prose (finds first { ... } or [ ... ] block)
 */
export function extractJsonFromOutput(output: string): unknown {
  const trimmed = output.trim();

  // Try direct parse first
  const directParse = tryParse(trimmed);
  if (directParse !== undefined) {
    return directParse;
  }

  // Try extracting from markdown code fences
  const fenced = extractFromFences(trimmed);
  if (fenced !== undefined) {
    return fenced;
  }

  // Try finding the first JSON object/array in the text
  const extracted = extractFirstJsonObject(trimmed);
  if (extracted !== undefined) {
    return extracted;
  }

  throw new ClawpatchError(
    "harness provider produced output that could not be parsed as JSON",
    8,
    "malformed-output",
  );
}

function tryParse(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function extractFromFences(text: string): unknown | undefined {
  // Match ```json ... ``` or ``` ... ```
  const fencePattern = /```(?:json)?\s*\n?([\s\S]*?)```/gu;
  const matches = text.matchAll(fencePattern);
  for (const match of matches) {
    const inner = match[1]?.trim();
    if (inner !== undefined) {
      const parsed = tryParse(inner);
      if (parsed !== undefined) {
        return parsed;
      }
    }
  }
  return undefined;
}

function extractFirstJsonObject(text: string): unknown | undefined {
  // Find the first { or [ and try to parse from there
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{" || text[i] === "[") {
      // Try progressively smaller substrings from this position
      const rest = text.slice(i);
      // Find the matching closing bracket
      const closing = text[i] === "{" ? "}" : "]";
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let j = 0; j < rest.length; j++) {
        const ch = rest[j];
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === "\\") {
          escape = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (inString) {
          continue;
        }
        if (ch === text[i]) {
          depth++;
        } else if (ch === closing) {
          depth--;
          if (depth === 0) {
            const candidate = rest.slice(0, j + 1);
            const parsed = tryParse(candidate);
            if (parsed !== undefined) {
              return parsed;
            }
            break;
          }
        }
      }
    }
  }
  return undefined;
}

/**
 * Run a harness CLI command with a prompt and extract structured JSON from the output.
 *
 * @param command - The CLI command to run (e.g., "duckhive" or "openclaude")
 * @param root - Working directory
 * @param prompt - The prompt to send (piped via stdin or passed as argument)
 * @param args - Additional CLI arguments
 * @param inputMode - How to pass the prompt: "stdin" or "argument"
 */
export async function runHarnessJson(
  command: string,
  root: string,
  prompt: string,
  args: string[] = [],
  inputMode: "stdin" | "argument" = "argument",
): Promise<unknown> {
  const fullArgs = inputMode === "argument"
    ? [...args, JSON.stringify(prompt)].join(" ")
    : args.join(" ");
  const fullCommand = `${command} ${fullArgs}`.trim();

  const result = await runCommand(fullCommand, root, inputMode === "stdin" ? prompt : undefined);

  if (result.exitCode !== 0) {
    throw new ClawpatchError(
      `${command} provider failed: ${result.stderr || result.stdout}`,
      harnessExitCode(result.stderr),
      "provider-failure",
    );
  }

  const output = result.stdout.trim();
  if (output.length === 0) {
    throw new ClawpatchError(
      `${command} provider produced no output`,
      8,
      "malformed-output",
    );
  }

  return extractJsonFromOutput(output);
}

function harnessExitCode(stderr: string): number {
  if (/auth|login|api key/iu.test(stderr)) {
    return 4;
  }
  if (/quota|rate.?limit/iu.test(stderr)) {
    return 5;
  }
  return 1;
}

/**
 * Check if a CLI harness is available by running a version command.
 */
export async function checkHarness(
  harnessName: string,
  versionCommand: string,
  root: string,
): Promise<string> {
  const result = await runCommand(versionCommand, root);
  if (result.exitCode !== 0) {
    throw new ClawpatchError(
      `${harnessName} CLI not available`,
      4,
      "provider-auth",
    );
  }
  return result.stdout.trim();
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}
