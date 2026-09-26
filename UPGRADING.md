# Upgrading this fork to a newer upstream release

This is the runbook for pulling a new
[orchestrator-ui-library](https://github.com/workfloworchestrator/orchestrator-ui-library)
release into this fork. See [DEPLOY.md](DEPLOY.md) for _why_ the repo is laid out the way it is.

This file is fork-owned and does not exist upstream, so editing it can never cause a merge
conflict during a sync.

## The short version

```bash
git switch main
git pull
node scripts/sync-upstream.mjs --dry-run   # look before you leap
npm run sync:upstream                      # rewrites the branch, commits
npm ci && npm run build                    # prove it still builds
git push origin main
```

## Why you will never resolve a conflict

`sync:upstream` does **not** merge or rebase. It throws the tracked tree away and lays down the
upstream release fresh, then puts this fork's own files back on top. There is nothing to
conflict, and the result is always exactly upstream plus a known, listed overlay.

The trade-off: **any local edit to a path that is not fork-owned is silently discarded on the
next sync.** See [Keeping a local change](#keeping-a-local-change).

---

## Step 0 — Look before you upgrade

Most of the risk in an upgrade is not the sync, it's the version jump. Check these first.

**What is available:**

```bash
git fetch upstream --tags
git tag --list '@orchestrator-ui/orchestrator-ui-components@*' --sort=v:refname | tail -5
```

**What version are we on now:**

```bash
node -p "require('./packages/orchestrator-ui-components/package.json').version"
```

**Which backend the new release needs** — the single most common way to break a deploy. The UI
checks this at runtime and shows a compatibility badge:

```bash
git show '@orchestrator-ui/orchestrator-ui-components@9.0.0:version-compatibility.json' | head -20
```

Each entry means "UI at this version or newer requires orchestrator-core at least this version".
Confirm your backend meets it _before_ you deploy.

**Upstream's own upgrade notes** — these exist only for releases with breaking changes:

```bash
TAG='@orchestrator-ui/orchestrator-ui-components@9.0.0'
git ls-tree -r --name-only "$TAG" mkdocs/docs/guides/upgrading/
git show "$TAG:mkdocs/docs/guides/upgrading/9.0.md"
```

**What actually changed since the version you run:**

```bash
git log --oneline \
  '@orchestrator-ui/orchestrator-ui-components@8.9.2'..'@orchestrator-ui/orchestrator-ui-components@9.0.0'
```

## Step 1 — Preview

```bash
node scripts/sync-upstream.mjs --dry-run
```

Reports every file that would change and leaves the branch untouched. Worth scanning for files
you did not expect to lose — especially anything your team added.

Build output and `package-lock.json` are filtered out of the comparison, so anything still listed
is a real content change. Untracked, gitignored artifacts from a previous local build (for example
`src/configuration/version.ts`) can appear as `Only in ...` — those are harmless.

## Step 2 — Sync

```bash
npm run sync:upstream
```

Requires a clean working tree. Useful flags:

| Flag                   | Use                                                            |
| ---------------------- | -------------------------------------------------------------- |
| `--version X.Y.Z`      | Take a specific release instead of the newest                  |
| `--tag <tag>`          | Take an exact tag                                              |
| `--branch <name>`      | Switch to that branch first                                    |
| `--submodule-ref main` | Take the example app's tip rather than the commit the tag pins |
| `--push`               | Push when done                                                 |
| `--skip-lockfile`      | Skip the `package-lock.json` refresh                           |
| `--allow-dirty`        | Proceed with an unclean tree (last resort)                     |

By default it takes the example app at the commit **the release tag pins**, which is the
combination upstream tested. Use `--submodule-ref main` only when you specifically need the
example app's newest commits.

Re-running the script when nothing has changed is safe: it reports _"already matches upstream
X.Y.Z; nothing to commit"_ and leaves the tree clean.

## Step 3 — Verify locally

Do not skip this. Vercel runs `npm ci`, which fails outright if `package-lock.json` and
`package.json` disagree.

```bash
npm ci        # must succeed
npm run build # must succeed
npm run dev   # optional smoke test against your backend
```

## Step 4 — Ship

```bash
git push origin main
```

Vercel builds `main`. If you would rather stage it, push the sync to a branch and let Vercel's
preview deploy run before merging.

---

## Keeping a local change

Everything outside the overlay is replaced on every sync. To make a change permanent, register
its path in `FORK_OWNED_PATHS` in [`scripts/sync-upstream.mjs`](scripts/sync-upstream.mjs):

```js
const FORK_OWNED_PATHS = ['scripts', 'DEPLOY.md', 'UPGRADING.md', '.github/workflows/block-deploy-to-main.yml'];
```

For `package.json` specifically, add to `PACKAGE_JSON_OVERLAY` in the same file rather than
editing `package.json` — the file itself comes from upstream each time.

Two rules that save pain later:

- **Prefer new files over edits to upstream files.** A whole new path can be listed in
  `FORK_OWNED_PATHS` and survives untouched. A modified upstream file cannot — it will be
  overwritten, and the overlay has no way to express "upstream's version, but patched".
- **Verify it survives.** After adding a path, run `node scripts/sync-upstream.mjs --dry-run`
  and confirm the file is not listed as disappearing.

## When things go wrong

**The sync failed part-way and the tree looks wrong.** The script only rewrites tracked files
and requires a clean tree first, so nothing uncommitted is at risk:

```bash
git checkout -- .
```

**`npm ci` fails after a sync.** The lockfile and `package.json` disagree. Regenerate:

```bash
npm install --package-lock-only
```

**The script errors with `apps/wfo-ui is not a submodule at <tag>`.** Upstream restructured —
they either moved the example app or vendored it. Check `git show <tag>:.gitmodules` and update
`SUBMODULE_PATH` in the script, or drop the flattening step if upstream no longer uses a submodule.

**A workflow you wanted is gone.** Every upstream workflow is deleted on each sync, on purpose —
upstream's workflows publish to npm and write tags into upstream's repos. To keep one, copy it to
a new filename and add that path to `FORK_OWNED_PATHS`. Details in [DEPLOY.md](DEPLOY.md).

## Known breaking points

Checked when this fork moved from 7.6.0 to 8.9.2 — keep appending as you upgrade.

| Release | What to watch for                                                                                                                                                     |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.7.0   | Requires **orchestrator-core ≥ 5.0.0**. Anything at or above this needs a Core 5 backend.                                                                             |
| 8.0.0   | `pydantic-forms` 1.x → 2.x. Custom form components reading `useGetConfig()` must use `componentMatcher` instead of `componentMatcherExtender`.                        |
| 8.4.0   | Agent/CopilotKit feature **removed** (`WfoAgent`, `pages/agent.tsx`, `pages/api/copilotkit.ts`, the `@copilotkit/*` and `@elastic/charts` deps). No longer available. |

Because 8.4 removed CopilotKit entirely, the `@copilotkit/runtime` prompt in
`scripts/deploy.mjs` is inert on 8.x — it only triggers when the example app already declares a
CopilotKit dependency.
