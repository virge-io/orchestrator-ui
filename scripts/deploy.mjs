#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { confirm, input, select } from '@inquirer/prompts';

const SUBMODULE_PATH = 'apps/wfo-ui';
const PACKAGE_PREFIX = '@orchestrator-ui/orchestrator-ui-components@';
const COMMIT_MESSAGE = (version) =>
  `Deploy version ${version}: remove submodule ${SUBMODULE_PATH} and add its content directly`;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(scriptDir, '..');

process.chdir(repoDir);

function run(command, args, options = {}) {
  const { capture = false, allowFailure = false, cwd = repoDir } = options;
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0 && !allowFailure) {
    const description = [command, ...args].join(' ');
    throw new Error(`Command failed: ${description}`);
  }

  if (capture) {
    return {
      status: result.status ?? 0,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    };
  }

  return {
    status: result.status ?? 0,
  };
}

function git(args, options) {
  return run('git', args, options);
}

function logStep(message) {
  console.log(`\n==> ${message}`);
}

function isPromptExit(error) {
  return error && typeof error === 'object' && error.name === 'ExitPromptError';
}

function ensureInteractiveTerminal() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('This deploy command must be run in an interactive terminal.');
  }
}

async function ensureCleanWorkingTree() {
  const { stdout } = git(['status', '--porcelain'], { capture: true });

  if (!stdout) {
    return;
  }

  const shouldContinue = await confirm({
    message: 'Your working tree is not clean. Continue anyway?',
    default: false,
  });

  if (!shouldContinue) {
    throw new Error('Aborting because the working tree is not clean.');
  }
}

function listVersionTags() {
  const { stdout } = git(['tag', '--list', `${PACKAGE_PREFIX}*`, '--sort=-v:refname'], { capture: true });

  return stdout ? stdout.split('\n').filter(Boolean) : [];
}

function listBranchNames() {
  const { stdout } = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes/origin'], {
    capture: true,
  });

  const names = new Set();

  for (const rawBranch of stdout.split('\n')) {
    if (!rawBranch || rawBranch === 'origin/HEAD') {
      continue;
    }

    const branch = rawBranch.startsWith('origin/') ? rawBranch.slice('origin/'.length) : rawBranch;

    if (branch) {
      names.add(branch);
    }
  }

  return [...names].sort((left, right) => left.localeCompare(right));
}

async function validateBranchName(branch) {
  if (!branch.trim()) {
    return 'Branch name is required.';
  }

  const result = git(['check-ref-format', '--branch', branch], { capture: true, allowFailure: true });

  if (result.status !== 0) {
    return 'Enter a valid git branch name.';
  }

  return true;
}

async function promptForVersionTag() {
  const tags = listVersionTags();

  if (tags.length === 0) {
    throw new Error(`No tags found matching ${PACKAGE_PREFIX}*`);
  }

  return select({
    message: 'Select the package version tag to deploy',
    pageSize: 15,
    choices: tags.map((tag) => ({
      name: tag,
      value: tag,
    })),
  });
}

async function promptForTargetBranch(defaultBranch) {
  const branchMode = await select({
    message: 'Choose the output branch',
    choices: [
      {
        name: `Use suggested branch (${defaultBranch})`,
        value: 'default',
      },
      {
        name: 'Pick an existing branch',
        value: 'existing',
      },
      {
        name: 'Create a new branch',
        value: 'new',
      },
    ],
  });

  if (branchMode === 'default') {
    return defaultBranch;
  }

  if (branchMode === 'existing') {
    const branches = listBranchNames();

    if (branches.length === 0) {
      throw new Error('No local or origin branches are available to choose from.');
    }

    return select({
      message: 'Select the output branch',
      pageSize: 15,
      choices: branches.map((branch) => ({
        name: branch,
        value: branch,
      })),
    });
  }

  return input({
    message: 'Enter the new branch name',
    default: defaultBranch,
    validate: validateBranchName,
  });
}

function snapshotSubmodule(tempDir) {
  const submodulePath = path.join(repoDir, SUBMODULE_PATH);
  const snapshotPath = path.join(tempDir, 'submodule-content');
  const entries = readdirSync(submodulePath);

  if (entries.length === 0) {
    throw new Error(`Submodule ${SUBMODULE_PATH} is empty after update.`);
  }

  mkdirSync(snapshotPath, { recursive: true });

  for (const entry of entries) {
    if (entry === '.git') {
      continue;
    }

    cpSync(path.join(submodulePath, entry), path.join(snapshotPath, entry), {
      recursive: true,
      force: true,
      dereference: true,
    });
  }

  return snapshotPath;
}

function stripGitMetadata(targetPath) {
  if (!existsSync(targetPath)) {
    return;
  }

  for (const entry of readdirSync(targetPath, { withFileTypes: true })) {
    const entryPath = path.join(targetPath, entry.name);

    if (entry.name === '.git') {
      rmSync(entryPath, { recursive: true, force: true });
      continue;
    }

    if (entry.isDirectory()) {
      stripGitMetadata(entryPath);
    }
  }
}

function restoreSubmoduleContent(snapshotPath) {
  const submodulePath = path.join(repoDir, SUBMODULE_PATH);

  mkdirSync(submodulePath, { recursive: true });

  for (const entry of readdirSync(snapshotPath)) {
    cpSync(path.join(snapshotPath, entry), path.join(submodulePath, entry), {
      recursive: true,
      force: true,
      dereference: true,
    });
  }

  stripGitMetadata(submodulePath);
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function getSubmodulePackageJsonPath() {
  return path.join(repoDir, SUBMODULE_PATH, 'package.json');
}

function getSuggestedCopilotRuntimeVersion(appPackage) {
  const dependencies = appPackage.dependencies ?? {};

  return (
    dependencies['@copilotkit/runtime']
    ?? dependencies['@copilotkit/react-core']
    ?? dependencies['@copilotkit/react-ui']
    ?? dependencies['@copilotkit/react-textarea']
    ?? null
  );
}

async function maybeAddCopilotRuntime() {
  const appPackageJsonPath = getSubmodulePackageJsonPath();

  if (!existsSync(appPackageJsonPath)) {
    return;
  }

  const appPackage = readJsonFile(appPackageJsonPath);
  const existingVersion = appPackage.dependencies?.['@copilotkit/runtime'];

  if (existingVersion) {
    console.log(`==> ${SUBMODULE_PATH} already depends on @copilotkit/runtime@${existingVersion}`);
    return;
  }

  const suggestedVersion = getSuggestedCopilotRuntimeVersion(appPackage);

  const shouldAddRuntime = await confirm({
    message:
      suggestedVersion ?
        `Add @copilotkit/runtime@${suggestedVersion} to ${SUBMODULE_PATH}?`
      : `Add @copilotkit/runtime to ${SUBMODULE_PATH}?`,
    default: false,
  });

  if (!shouldAddRuntime) {
    return;
  }

  const runtimeVersion =
    suggestedVersion
    ?? (
      await input({
        message: 'Enter the @copilotkit/runtime version to install',
        validate: (value) => (value.trim() ? true : 'Version is required.'),
      })
    ).trim();

  logStep(`Adding @copilotkit/runtime@${runtimeVersion} to ${SUBMODULE_PATH}`);
  run(
    'npm',
    ['install', '--package-lock-only', '--ignore-scripts', '--save-exact', `@copilotkit/runtime@${runtimeVersion}`],
    {
      cwd: path.join(repoDir, SUBMODULE_PATH),
    },
  );
}

function cleanupSubmoduleConfig() {
  const gitDir = git(['rev-parse', '--git-dir'], { capture: true }).stdout;
  const modulesPath = path.resolve(repoDir, gitDir, 'modules', SUBMODULE_PATH);

  rmSync(modulesPath, { recursive: true, force: true });
  git(['config', '--remove-section', `submodule.${SUBMODULE_PATH}`], { allowFailure: true });

  if (existsSync(path.join(repoDir, '.gitmodules'))) {
    git(['config', '-f', '.gitmodules', '--remove-section', `submodule.${SUBMODULE_PATH}`], { allowFailure: true });
  }
}

function prepareSubmoduleForInit() {
  const gitDir = git(['rev-parse', '--git-dir'], { capture: true }).stdout;
  const submodulePath = path.join(repoDir, SUBMODULE_PATH);
  const modulesPath = path.resolve(repoDir, gitDir, 'modules', SUBMODULE_PATH);

  git(['submodule', 'deinit', '-f', '--', SUBMODULE_PATH], { allowFailure: true });
  rmSync(submodulePath, { recursive: true, force: true });
  rmSync(modulesPath, { recursive: true, force: true });
}

function pushBranch(branch, forcePush) {
  const args = ['push'];

  if (forcePush) {
    args.push('--force-with-lease');
  }

  args.push('--set-upstream', 'origin', branch);
  git(args);
}

async function main() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'orchestrator-ui-deploy-'));

  try {
    ensureInteractiveTerminal();
    await ensureCleanWorkingTree();

    logStep('Fetching tags and branches from origin');
    git(['fetch', 'origin', '--tags', '--prune']);

    const versionTag = await promptForVersionTag();
    const version = versionTag.slice(PACKAGE_PREFIX.length);
    const defaultBranch = `deploy-${version}`;
    const branch = await promptForTargetBranch(defaultBranch);
    const forcePush = await confirm({
      message: 'Force push to origin?',
      default: false,
    });

    console.log(`\nSelected tag: ${versionTag}`);
    console.log(`Target branch: ${branch}`);
    console.log(`Force push: ${forcePush ? 'yes' : 'no'}`);

    logStep(`Checking out package tag ${versionTag}`);
    git(['switch', '--detach', versionTag]);

    logStep(`Creating or resetting branch ${branch}`);
    git(['switch', '-C', branch]);

    logStep(`Preparing ${SUBMODULE_PATH} for submodule checkout`);
    prepareSubmoduleForInit();

    logStep('Initializing and updating submodules');
    git(['submodule', 'update', '--init', '--remote']);

    const submodulePath = path.join(repoDir, SUBMODULE_PATH);

    if (!existsSync(submodulePath)) {
      throw new Error(`Submodule ${SUBMODULE_PATH} failed to initialize.`);
    }

    logStep(`Snapshotting ${SUBMODULE_PATH}`);
    const snapshotPath = snapshotSubmodule(tempDir);

    logStep(`Removing submodule ${SUBMODULE_PATH}`);
    git(['rm', '-f', SUBMODULE_PATH]);
    rmSync(submodulePath, { recursive: true, force: true });

    logStep('Restoring submodule content as regular files');
    restoreSubmoduleContent(snapshotPath);

    await maybeAddCopilotRuntime();

    logStep('Cleaning up submodule config');
    cleanupSubmoduleConfig();

    logStep('Staging final state');
    git(['add', '-A']);

    logStep('Committing changes');
    git(['commit', '-m', COMMIT_MESSAGE(version), '--no-verify']);

    logStep(`Pushing branch ${branch}`);
    pushBranch(branch, forcePush);

    console.log(`\n==> Done. Deployed version ${version} on branch ${branch}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  if (isPromptExit(error)) {
    console.error('\nDeployment cancelled.');
    process.exitCode = 1;
  } else {
    console.error(`\nError: ${error.message}`);
    process.exitCode = 1;
  }
});
