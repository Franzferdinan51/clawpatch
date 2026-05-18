import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { runCommand } from "./exec.js";
import { ClawpatchError } from "./errors.js";

export type GitInfo = {
  root: string | null;
  remoteUrl: string | null;
  defaultBranch: string | null;
  currentBranch: string | null;
  headSha: string | null;
  dirty: boolean;
};

export async function discoverGit(cwd: string): Promise<GitInfo> {
  const root = await gitLine(cwd, "git rev-parse --show-toplevel");
  if (root === null) {
    return {
      root: null,
      remoteUrl: null,
      defaultBranch: null,
      currentBranch: null,
      headSha: null,
      dirty: false,
    };
  }
  const [remoteUrl, currentBranch, headSha, statusOutput, originHead] = await Promise.all([
    gitLine(root, "git config --get remote.origin.url"),
    gitLine(root, "git branch --show-current"),
    gitLine(root, "git rev-parse HEAD"),
    gitText(root, "git status --porcelain"),
    gitLine(root, "git symbolic-ref refs/remotes/origin/HEAD"),
  ]);
  return {
    root,
    remoteUrl,
    defaultBranch: originHead?.replace("refs/remotes/origin/", "") ?? null,
    currentBranch,
    headSha,
    dirty: statusOutput.trim().length > 0,
  };
}

export async function findProjectRoot(cwd: string, explicitRoot?: string): Promise<string> {
  if (explicitRoot !== undefined) {
    const info = await stat(explicitRoot).catch(() => null);
    if (info === null || !info.isDirectory()) {
      throw new ClawpatchError(`root not found: ${explicitRoot}`, 2, "invalid-root");
    }
    return explicitRoot;
  }
  const git = await discoverGit(cwd);
  return git.root ?? cwd;
}

export function projectNameFromRoot(root: string, remoteUrl: string | null): string {
  if (remoteUrl !== null) {
    const withoutGit = remoteUrl.replace(/\.git$/u, "");
    const last = withoutGit.split(/[/:]/u).at(-1);
    if (last !== undefined && last.length > 0) {
      return last;
    }
  }
  return basename(root);
}

async function gitLine(cwd: string, command: string): Promise<string | null> {
  const result = await runCommand(command, cwd);
  if (result.exitCode !== 0) {
    return null;
  }
  const line = result.stdout.trim();
  return line.length > 0 ? line : null;
}

async function gitText(cwd: string, command: string): Promise<string> {
  const result = await runCommand(command, cwd);
  return result.exitCode === 0 ? result.stdout : "";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

export async function commitChanges(
  root: string,
  message: string,
): Promise<{ sha: string | null; success: boolean }> {
  await runCommand("git add -A", root);
  const result = await runCommand(
    `git -c commit.gpgsign=false commit -m ${shellQuote(message)}`,
    root,
  );
  if (result.exitCode !== 0) {
    return { sha: null, success: false };
  }
  const shaResult = await runCommand("git rev-parse HEAD", root);
  return {
    sha: shaResult.exitCode === 0 ? shaResult.stdout.trim() : null,
    success: true,
  };
}

export async function createPullRequest(
  root: string,
  options: { title: string; body: string; base?: string },
): Promise<{ url: string | null; success: boolean; error?: string }> {
  const branchName = `clawpatch/fix-${Date.now()}`;
  const checkoutResult = await runCommand(`git checkout -b ${branchName}`, root);
  if (checkoutResult.exitCode !== 0) {
    return { url: null, success: false, error: "failed to create branch" };
  }
  const ghResult = await runCommand(
    `gh pr create --title ${shellQuote(options.title)} --body ${shellQuote(options.body)}${options.base ? ` --base ${options.base}` : ""}`,
    root,
  );
  if (ghResult.exitCode === 0) {
    const url = ghResult.stdout.trim();
    return { url: url.length > 0 ? url : null, success: true };
  }
  return { url: null, success: false, error: ghResult.stderr || "gh pr create failed" };
}
