# Deploying this fork

This repository is a fork of [workfloworchestrator/orchestrator-ui-library](https://github.com/workfloworchestrator/orchestrator-ui-library)
that exists for one reason: to produce a **single, directly deployable WFO GUI**.

Upstream keeps the example GUI at `apps/wfo-ui` as a **git submodule** pointing at
[example-orchestrator-ui](https://github.com/workfloworchestrator/example-orchestrator-ui).
Vercel does not check out submodules, so a plain fork builds an empty app. The fix is to
replace the submodule with a checkout of its content, committed as ordinary tracked files.

For the step-by-step procedure to pull in a new upstream release, see [UPGRADING.md](UPGRADING.md).
This file explains the layout and the reasoning behind it.

Two scripts cover that, both dependency-free at the point of use:

| Script                                                | What it does                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------- |
| `npm run sync:upstream` (`scripts/sync-upstream.mjs`) | Rebuilds **this branch** from the latest upstream release tag, flattened. |
| `npm run deploy` (`scripts/deploy.mjs`)               | Builds a **separate `deploy-X.Y.Z` branch** from any tag, flattened.      |

## Layout

`main` is the deployable branch: it holds the upstream tree of a published
`@orchestrator-ui/orchestrator-ui-components@X.Y.Z` release with `apps/wfo-ui` present as
real files, plus this fork's own files. Vercel builds `main`.

## Aligning with upstream

```bash
npm run sync:upstream                 # latest upstream release
node scripts/sync-upstream.mjs --dry-run           # show what would change
node scripts/sync-upstream.mjs --version 8.9.2     # pin a specific release
node scripts/sync-upstream.mjs --submodule-ref main  # take the example app's tip instead of the pinned commit
```

The script:

1. adds/validates the `upstream` remote and fetches its tags;
2. picks the newest `@orchestrator-ui/orchestrator-ui-components@X.Y.Z` tag (or the one you name);
3. lays down that tag's tree;
4. fetches `apps/wfo-ui` at the commit **that tag pins** and unpacks it as tracked files —
   no submodule, no nested `.git`, so `npm ci` and Vercel both see a normal workspace;
5. deletes `.gitmodules` and **all upstream workflows** (see below);
6. restores this fork's own files and re-applies the `package.json` overlay;
7. refreshes `package-lock.json` and commits.

It refuses to run if `origin` is the upstream repository, and leaves pushing to you unless
you pass `--push`.

### Why the upstream workflows are removed

`.github/workflows/` is dropped on every sync and only this fork's workflows are put back.
Upstream's workflows act on behalf of the upstream project:

- `publish-to-npm.yml` runs **on every push to `main`** and tries to `changeset publish` the
  packages to npm, then dispatches into `workfloworchestrator/example-orchestrator-ui`;
- `tag-example-ui.yml` writes tags into `workfloworchestrator/example-orchestrator-ui`;
- `gh-pages.yml` publishes upstream's documentation site.

Since `main` here is the deploy target, every sync would otherwise fire the publish workflow.

## What belongs to this fork

Everything else comes from upstream and is overwritten on each sync. Only these survive,
listed in `FORK_OWNED_PATHS` in `scripts/sync-upstream.mjs`:

- `scripts/` — the deploy and sync tooling
- `DEPLOY.md` — this file
- `UPGRADING.md` — the step-by-step upgrade runbook
- `.github/workflows/block-deploy-to-main.yml`

Plus the `package.json` overlay (`PACKAGE_JSON_OVERLAY` in the same file), which re-adds the
`deploy`, `deploy:quick` and `sync:upstream` scripts and the `@inquirer/prompts` dev dependency.

**To add a permanent local change, add its path to `FORK_OWNED_PATHS`** — otherwise the next
sync will drop it.

## Building a standalone deploy branch

`npm run deploy` is the interactive variant: it builds a `deploy-X.Y.Z` branch from any tag
rather than rewriting the branch you are on. Use it for one-off or side-by-side deploys. It
refuses to push to the upstream repository and can create a fork via the GitHub CLI.

```bash
npm run deploy        # interactive
npm run deploy:quick  # defaults, no prompts
```

## Recovery

`sync:upstream` rewrites the working tree in place. It requires a clean tree first, so if it
fails part-way:

```bash
git checkout -- .
```
