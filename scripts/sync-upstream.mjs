#!/usr/bin/env node

/**
 * Align this fork with upstream workfloworchestrator/orchestrator-ui-library and
 * leave the target branch as a single, directly deployable tree.
 *
 * Upstream keeps the example GUI (apps/wfo-ui) as a git submodule. Vercel does not
 * check out submodules, so this script rebuilds the branch from a published
 * `@orchestrator-ui/orchestrator-ui-components@X.Y.Z` tag with the submodule
 * materialized as ordinary tracked files.
 *
 * The fork's own files (see FORK_OWNED_PATHS and PACKAGE_JSON_OVERLAY) are carried
 * across every sync, so this script can regenerate the branch it lives on. Edits to
 * upstream files are kept as patches in FORK_PATCHES_DIR and re-applied on top.
 *
 * Usage: node scripts/sync-upstream.mjs [options]   (or: npm run sync:upstream)
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const UPSTREAM_REMOTE = 'upstream';
const UPSTREAM_URL = 'https://github.com/workfloworchestrator/orchestrator-ui-library.git';
const UPSTREAM_REPO_SLUG = 'workfloworchestrator/orchestrator-ui-library';
const PACKAGE_PREFIX = '@orchestrator-ui/orchestrator-ui-components@';
const SUBMODULE_PATH = 'apps/wfo-ui';
const FALLBACK_SUBMODULE_URL = 'https://github.com/workfloworchestrator/example-orchestrator-ui.git';

/**
 * Paths owned by this fork. They are taken from the current branch and re-applied
 * after the upstream tree is laid down, so they survive every sync.
 */
const FORK_OWNED_PATHS = [
  'scripts',
  'DEPLOY.md',
  'UPGRADING.md',
  '.github/workflows/block-deploy-to-main.yml',
  'fork-patches',
  // Cognito group policy (admins / shopvirge-msp); wired into upstream files by fork-patches/.
  'apps/wfo-ui/policy',
  'apps/wfo-ui/components/WfoGroupAuth',
];

/**
 * Edits to upstream files, as `git diff` patches against the upstream version. After the
 * upstream tree and the fork-owned paths are laid down, every *.patch in this directory is
 * applied in name order. A patch that no longer applies stops the sync (see UPGRADING.md).
 */
const FORK_PATCHES_DIR = 'fork-patches';

/**
 * Merged into the upstream package.json after each sync.
 */
const PACKAGE_JSON_OVERLAY = {
  scripts: {
    deploy: 'node scripts/deploy.mjs',
    'deploy:quick': 'node scripts/deploy.mjs --quick',
    'sync:upstream': 'node scripts/sync-upstream.mjs',
  },
  devDependencies: {
    '@inquirer/prompts': '^7.10.1',
  },
};

/**
 * Upstream's workflows act on behalf of the upstream project: publish-to-npm.yml
 * runs on every push to main and tries to publish the packages to npm, and
 * tag-example-ui.yml writes tags into workfloworchestrator/example-orchestrator-ui.
 * Neither should ever run from this fork, so the whole directory is dropped and
 * only the fork's own workflows (via FORK_OWNED_PATHS) are put back.
 */
const WORKFLOWS_DIR = '.github/workflows';

/**
 * Excluded from the --dry-run comparison: build output and other untracked noise, plus
 * package-lock.json, which at this point still holds upstream's version because the overlay's
 * lockfile refresh only runs during a real sync.
 */
const DRY_RUN_EXCLUDES = ['.git', 'node_modules', '.next', '.turbo', 'dist', '_', 'package-lock.json'];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(scriptDir, '..');

process.chdir(repoDir);

function parseCliArgs(argv) {
  const options = {
    tag: null,
    branch: null,
    submoduleRef: null,
    push: false,
    dryRun: false,
    skipLockfile: false,
    skipPatches: false,
    allowDirty: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const readValue = (name) => {
      const value = argv[index + 1];

      if (!value || value.startsWith('-')) {
        throw new Error(`Option ${name} requires a value.`);
      }

      index += 1;
      return value;
    };

    switch (arg) {
      case '--tag':
        options.tag = readValue('--tag');
        break;
      case '--version':
        options.tag = `${PACKAGE_PREFIX}${readValue('--version')}`;
        break;
      case '--branch':
        options.branch = readValue('--branch');
        break;
      case '--submodule-ref':
        options.submoduleRef = readValue('--submodule-ref');
        break;
      case '--push':
        options.push = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--skip-lockfile':
        options.skipLockfile = true;
        break;
      case '--skip-patches':
        options.skipPatches = true;
        break;
      case '--allow-dirty':
        options.allowDirty = true;
        break;
      case '--help':
      case '-h':
        console.log(`Usage: node scripts/sync-upstream.mjs [options]

Rebuilds the current branch from an upstream release tag with ${SUBMODULE_PATH}
flattened from a submodule into ordinary tracked files.

Options:
  --version X.Y.Z     Sync to this orchestrator-ui-components version (default: latest)
  --tag <tag>         Sync to this exact upstream tag (overrides --version)
  --branch <name>     Switch to this branch before syncing (default: current branch)
  --submodule-ref <r> Take ${SUBMODULE_PATH} from this ref of the example repo
                      instead of the commit pinned by the tag (e.g. main)
  --push              Push the branch to origin when done
  --dry-run           Report what would change, then restore the branch untouched
  --skip-lockfile     Do not run "npm install --package-lock-only" afterwards
  --skip-patches      Do not apply ${FORK_PATCHES_DIR}/*.patch (to redo a patch that no longer applies)
  --allow-dirty       Proceed even though the working tree is not clean
  -h, --help          Show this message`);
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

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
    throw new Error(
      `Command failed: ${[command, ...args].join(' ')}${result.stderr ? `\n${result.stderr.trim()}` : ''}`,
    );
  }

  return {
    status: result.status ?? 0,
    stdout: capture ? result.stdout.trim() : '',
    stderr: capture ? result.stderr.trim() : '',
  };
}

function git(args, options) {
  return run('git', args, options);
}

function logStep(message) {
  console.log(`\n==> ${message}`);
}

function normalizeGitHubRepo(url) {
  if (!url) {
    return null;
  }

  const trimmed = url.trim();
  const scpLike = trimmed.match(/^(?:[^@]+@)?github\.com:(.+)$/i);
  const pathPart = scpLike ? scpLike[1] : trimmed.replace(/^https?:\/\/(?:www\.)?github\.com\//i, '');

  if (pathPart === trimmed && !scpLike) {
    return null;
  }

  return pathPart
    .replace(/\/$/, '')
    .replace(/\.git$/i, '')
    .toLowerCase();
}

function ensureUpstreamRemote() {
  const remotes = git(['remote'], { capture: true }).stdout.split('\n').filter(Boolean);

  if (!remotes.includes(UPSTREAM_REMOTE)) {
    logStep(`Adding remote ${UPSTREAM_REMOTE} -> ${UPSTREAM_URL}`);
    git(['remote', 'add', UPSTREAM_REMOTE, UPSTREAM_URL]);
    return;
  }

  const url = git(['remote', 'get-url', UPSTREAM_REMOTE], { capture: true }).stdout;

  if (normalizeGitHubRepo(url) !== UPSTREAM_REPO_SLUG) {
    throw new Error(
      `Remote ${UPSTREAM_REMOTE} points at ${url}, expected ${UPSTREAM_REPO_SLUG}. Fix it with: git remote set-url ${UPSTREAM_REMOTE} ${UPSTREAM_URL}`,
    );
  }
}

/**
 * Guards against rebuilding the upstream repository itself: this script rewrites a
 * branch wholesale and must only ever do that inside a fork.
 */
function ensureNotUpstreamCheckout() {
  const originUrl = git(['remote', 'get-url', 'origin'], { capture: true, allowFailure: true }).stdout;

  if (originUrl && normalizeGitHubRepo(originUrl) === UPSTREAM_REPO_SLUG) {
    throw new Error(`Refusing to run: origin is the upstream repository (${originUrl}). Run this from your fork.`);
  }
}

function ensureCleanWorkingTree(allowDirty) {
  const status = git(['status', '--porcelain'], { capture: true }).stdout;

  if (!status) {
    return;
  }

  if (allowDirty) {
    console.warn('Warning: working tree is not clean; continuing because --allow-dirty was given.');
    return;
  }

  throw new Error(`Working tree is not clean. Commit or stash first, or pass --allow-dirty.\n${status}`);
}

function compareVersions(left, right) {
  const [leftCore, leftPre] = left.split(/-(.+)/);
  const [rightCore, rightPre] = right.split(/-(.+)/);
  const leftParts = leftCore.split('.').map(Number);
  const rightParts = rightCore.split('.').map(Number);

  for (let index = 0; index < 3; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);

    if (diff !== 0) {
      return diff;
    }
  }

  if (leftPre && !rightPre) return -1;
  if (!leftPre && rightPre) return 1;
  if (leftPre && rightPre) return leftPre.localeCompare(rightPre, undefined, { numeric: true });

  return 0;
}

function listVersionTags() {
  const tags = git(['tag', '--list', `${PACKAGE_PREFIX}*`], { capture: true })
    .stdout.split('\n')
    .filter(Boolean);

  return tags.sort((left, right) =>
    compareVersions(left.slice(PACKAGE_PREFIX.length), right.slice(PACKAGE_PREFIX.length)),
  );
}

function resolveTag(requestedTag) {
  if (requestedTag) {
    const exists = git(['rev-parse', '--verify', '--quiet', `${requestedTag}^{commit}`], {
      capture: true,
      allowFailure: true,
    });

    if (exists.status !== 0) {
      throw new Error(`Tag ${requestedTag} was not found after fetching ${UPSTREAM_REMOTE}.`);
    }

    return requestedTag;
  }

  const tags = listVersionTags();

  if (tags.length === 0) {
    throw new Error(`No tags matching ${PACKAGE_PREFIX}* were found.`);
  }

  return tags[tags.length - 1];
}

/**
 * Reads the example-app repository URL out of the tag's own .gitmodules so the
 * script keeps working if upstream ever moves the submodule.
 */
function readSubmoduleUrl(tag) {
  const gitmodules = git(['show', `${tag}:.gitmodules`], { capture: true, allowFailure: true });

  if (gitmodules.status !== 0) {
    return FALLBACK_SUBMODULE_URL;
  }

  const match = gitmodules.stdout.match(/^\s*url\s*=\s*(.+)$/m);
  const slug = match ? normalizeGitHubRepo(match[1]) : null;

  return slug ? `https://github.com/${slug}.git` : FALLBACK_SUBMODULE_URL;
}

function readSubmodulePin(tag) {
  const entry = git(['ls-tree', tag, SUBMODULE_PATH], { capture: true }).stdout;
  const match = entry.match(/^160000 commit ([0-9a-f]{40})\t/);

  if (!match) {
    throw new Error(`${SUBMODULE_PATH} is not a submodule at ${tag}; nothing to flatten.`);
  }

  return match[1];
}

function extractArchive(archiveArgs, targetDir, tempDir, label, cwd = repoDir) {
  const tarPath = path.join(tempDir, `${label}.tar`);

  mkdirSync(targetDir, { recursive: true });
  run('git', ['archive', '--format=tar', '-o', tarPath, ...archiveArgs], { cwd });
  run('tar', ['-xf', tarPath, '-C', targetDir]);
  rmSync(tarPath, { force: true });
}

/**
 * Fetches the example app at `ref` into a throwaway repository and unpacks its
 * content, so no submodule machinery (and no nested .git) ever touches the result.
 */
function materializeSubmodule(submoduleUrl, ref, targetDir, tempDir) {
  const cloneDir = path.join(tempDir, 'submodule-repo');

  mkdirSync(cloneDir, { recursive: true });
  run('git', ['init', '--quiet'], { cwd: cloneDir });
  run('git', ['remote', 'add', 'origin', submoduleUrl], { cwd: cloneDir });
  run('git', ['fetch', '--depth', '1', '--quiet', 'origin', ref], { cwd: cloneDir });

  const sha = run('git', ['rev-parse', 'FETCH_HEAD'], { capture: true, cwd: cloneDir }).stdout;

  extractArchive(['FETCH_HEAD'], targetDir, tempDir, 'submodule', cloneDir);

  if (readdirSync(targetDir).length === 0) {
    throw new Error(`${SUBMODULE_PATH} is empty after extracting ${ref}.`);
  }

  return sha;
}

function copyForkOwnedPaths(fromDir, toDir) {
  const copied = [];

  for (const relativePath of FORK_OWNED_PATHS) {
    const source = path.join(fromDir, relativePath);

    if (!existsSync(source)) {
      continue;
    }

    const target = path.join(toDir, relativePath);

    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(source, target, { recursive: true, force: true, dereference: true });
    copied.push(relativePath);
  }

  return copied;
}

/**
 * Applies the fork's patches to the generated tree. The tree is no git repository, so
 * `git apply` works as a plain, exact patch tool here: no fuzz, all-or-nothing per patch.
 */
function applyForkPatches(treeDir) {
  const patchesDir = path.join(treeDir, FORK_PATCHES_DIR);

  if (!existsSync(patchesDir)) {
    return [];
  }

  const patches = readdirSync(patchesDir)
    .filter((name) => name.endsWith('.patch'))
    .sort();

  for (const name of patches) {
    const patchPath = path.join(patchesDir, name);
    const check = run('git', ['apply', '--check', patchPath], { capture: true, allowFailure: true, cwd: treeDir });

    if (check.status !== 0) {
      throw new Error(
        `${FORK_PATCHES_DIR}/${name} no longer applies to this upstream release:\n${check.stderr}\n`
          + 'Sync with --skip-patches, redo the change by hand and regenerate the patch (UPGRADING.md, "Keeping a local change").',
      );
    }

    run('git', ['apply', patchPath], { cwd: treeDir });
  }

  return patches;
}

function sortObjectKeys(object) {
  return Object.fromEntries(Object.entries(object).sort(([left], [right]) => left.localeCompare(right)));
}

function applyPackageJsonOverlay(treeDir) {
  const packageJsonPath = path.join(treeDir, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

  packageJson.scripts = { ...packageJson.scripts, ...PACKAGE_JSON_OVERLAY.scripts };
  packageJson.devDependencies = sortObjectKeys({
    ...packageJson.devDependencies,
    ...PACKAGE_JSON_OVERLAY.devDependencies,
  });

  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

/**
 * Removes every tracked file, leaving untracked/ignored paths such as node_modules
 * and .env in place so a sync does not force a full reinstall.
 */
function removeTrackedFiles() {
  const tracked = git(['ls-files', '-z'], { capture: true }).stdout.split('\0').filter(Boolean);
  const directories = new Set();

  for (const relativePath of tracked) {
    rmSync(path.join(repoDir, relativePath), { force: true });

    let parent = path.dirname(relativePath);

    while (parent && parent !== '.') {
      directories.add(parent);
      parent = path.dirname(parent);
    }
  }

  for (const directory of [...directories].sort((left, right) => right.length - left.length)) {
    try {
      rmdirSync(path.join(repoDir, directory));
    } catch {
      // Directory still holds untracked files (node_modules, .next, ...); keep it.
    }
  }
}

function copyTreeInto(treeDir, targetDir) {
  for (const entry of readdirSync(treeDir)) {
    cpSync(path.join(treeDir, entry), path.join(targetDir, entry), {
      recursive: true,
      force: true,
      dereference: true,
    });
  }
}

function currentBranch() {
  const result = git(['symbolic-ref', '--short', 'HEAD'], { capture: true, allowFailure: true });

  if (result.status !== 0) {
    throw new Error('HEAD is detached. Check out a branch, or pass --branch.');
  }

  return result.stdout;
}

function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'orchestrator-ui-sync-'));

  try {
    ensureNotUpstreamCheckout();
    ensureCleanWorkingTree(options.allowDirty);
    ensureUpstreamRemote();

    if (options.branch) {
      logStep(`Switching to branch ${options.branch}`);
      git(['switch', options.branch]);
    }

    const branch = currentBranch();

    logStep(`Fetching ${UPSTREAM_REMOTE} (tags included)`);
    git(['fetch', UPSTREAM_REMOTE, '--tags', '--prune', '--force']);

    const tag = resolveTag(options.tag);
    const version = tag.startsWith(PACKAGE_PREFIX) ? tag.slice(PACKAGE_PREFIX.length) : tag;
    const submoduleUrl = readSubmoduleUrl(tag);
    const submoduleRef = options.submoduleRef ?? readSubmodulePin(tag);

    console.log(`\nBranch:        ${branch}`);
    console.log(`Upstream tag:  ${tag}`);
    console.log(`Example app:   ${submoduleUrl}`);
    console.log(`Example ref:   ${submoduleRef}${options.submoduleRef ? '' : ' (pinned by the tag)'}`);

    const treeDir = path.join(tempDir, 'tree');

    logStep(`Extracting upstream tree from ${tag}`);
    extractArchive([tag], treeDir, tempDir, 'library');

    logStep(`Flattening ${SUBMODULE_PATH} from ${submoduleUrl}`);
    const submoduleSha = materializeSubmodule(submoduleUrl, submoduleRef, path.join(treeDir, SUBMODULE_PATH), tempDir);
    console.log(`    ${SUBMODULE_PATH} is now plain files at ${submoduleSha}`);

    logStep('Dropping submodule registration and upstream workflows');
    rmSync(path.join(treeDir, '.gitmodules'), { force: true });
    rmSync(path.join(treeDir, WORKFLOWS_DIR), { recursive: true, force: true });

    logStep('Re-applying fork-owned files');
    const restored = copyForkOwnedPaths(repoDir, treeDir);
    console.log(restored.length ? `    ${restored.join('\n    ')}` : '    (none found on this branch)');
    applyPackageJsonOverlay(treeDir);

    if (options.skipPatches) {
      logStep(`Skipping ${FORK_PATCHES_DIR} (--skip-patches): redo them by hand before committing`);
    } else {
      logStep(`Applying ${FORK_PATCHES_DIR}`);
      const applied = applyForkPatches(treeDir);
      console.log(applied.length ? `    ${applied.join('\n    ')}` : '    (none)');
    }

    if (options.dryRun) {
      logStep('Dry run: comparing the generated tree against the current branch');
      const diff = run(
        'diff',
        ['-rq', ...DRY_RUN_EXCLUDES.map((pattern) => `--exclude=${pattern}`), repoDir, treeDir],
        { capture: true, allowFailure: true },
      );
      console.log(diff.stdout || '    (no content differences)');
      console.log(
        '\nNote: package-lock.json is excluded above; a real sync regenerates it after applying the overlay.',
      );
      console.log('\n==> Dry run complete; the branch was not modified.');
      return;
    }

    logStep(`Replacing the tracked content of ${branch}`);
    removeTrackedFiles();
    copyTreeInto(treeDir, repoDir);

    if (!options.skipLockfile) {
      logStep('Refreshing package-lock.json for the overlaid dependencies');
      run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']);
    }

    logStep('Staging the result');
    git(['add', '-A']);

    if (!git(['diff', '--cached', '--quiet'], { capture: true, allowFailure: true }).status) {
      console.log(`\n==> ${branch} already matches upstream ${version}; nothing to commit.`);
      return;
    }

    logStep('Committing');
    const message = [
      `Sync with upstream ${version}`,
      '',
      `Rebuilt from ${tag} with ${SUBMODULE_PATH} flattened from a submodule`,
      `into tracked files at ${submoduleSha}.`,
    ].join('\n');
    // --no-verify: this is generated content, not hand-written changes for the hooks to police.
    git(['commit', '--no-verify', '-m', message]);

    if (options.push) {
      logStep(`Pushing ${branch} to origin`);
      git(['push', 'origin', branch]);
    } else {
      console.log('\nReview the commit, then push with:');
      console.log(`    git push origin ${branch}`);
    }

    console.log(`\n==> Done. ${branch} is aligned with upstream ${version}.`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`\nError: ${error.message}`);
  console.error('\nIf the working tree looks incomplete, restore it with: git checkout -- .');
  process.exitCode = 1;
}
