# Orchestrator ui library

This repo contains the generally reusable parts of the orchestrator ui grouped and exposed as pages, components and elements such as icons.
It is meant to be used together with an app that includes this library through NPM. For ease of development we have added the orchestrator example app implementation as a submodule in the folder /aps/wfo-ui.

To install and run the app:

```
git clone git@github.com:workfloworchestrator/orchestrator-ui-library.git
cd orchestrator-ui-library
git submodule init
git submodule update
# Optionally: to update to the latest version of the git submodule instead of the ones currently pinned to the repo run
git submodule update --remote
cp apps/wfo-ui/.env.example apps/wfo-iu/.env
# change the values in the env file to point to your orchestrator backend
# set auth=false or follow the directions below this sections
npm install
npm run dev
```

This makes the orchestrator ui run on http://localhost:3000

## Websocket

Using websockets is controlled by NEXT_PUBLIC_USE_WEBSOCKET, when set to 'true' the application tries to open a websocket to ORCHESTRATOR_WEBSOCKET_URL that defaults to ws://localhost:8080 to get updates as they happen. The messages received through this endpoint are used to invalidate the frontend cache that triggers a refetch of data were needed.

# Authentication

- set `AUTH_ACTIVE` env variable to false or use setup below with auth.

## AUTH with NextAuth and keycloak

Setup auth with keycloak in docker

- copy apps env: `cp apps/wfo-ui/.env.example apps/wfo-ui/.env`.
  - change `KEYCLOAK_ADMIN` and `KEYCLOAK_ADMIN_PASSWORD` to your own values.
  - `NEXTAUTH_SECRET`: is NextAuth internal for JWT encryption and easily created with command `openssl rand -base64 32`.
  - `NEXTAUTH_URL`: should be the base url to the auth page: `${FRONTEND_URL}/api/auth`.
  - `NEXTAUTH_ID`: name of the provider which is shown in the `Sign in with {NEXTAUTH_ID}`, default is `keycloak`.
- run `docker compose up -d` to start keycloak.
- log into keycloak at http://localhost:8085
- keycloak setup (use the `apps/{folder}` env):
  - follow the [keycloak docs](https://www.keycloak.org/getting-started/getting-started-docker#_secure_the_first_application) to create a new realm and at least one user.
  - after creating the realm, copy paste the url of the realm `http://{YOUR_KEYCLOAK_DOMAIN}/realms/{YOUR_REALM}` in your env as variable `NEXTAUTH_ISSUER`.
  - Create a client.
    - first page: fill in a name for `ClientID`. (`.env.example` default is `orchestrator-client`)
    - second page: enable `Client authentication` and `Authorization`.
    - third page fill in `Valid redirect URIs` and `Web Origins`:
      - `Valid redirect URIs` with `{FRONTEND_URL}/api/auth/callback/{PROVIDER}`, with default provider its env variable `NEXTAUTH_ID`. (eg `http://localhost:3000/api/auth/callback/keycloak`)
      - `Web Origins` with `{FRONTEND_URL}`. (eg `http://localhost:3000/`)
  - go to the client details and go to tab `Credentials` and copy the Client secret and paste it into your env file. (`NEXTAUTH_CLIENT_SECRET`)
  - run the app with `turbo dev`.
- keycloak backend setup:
  - Create another client in the same realm.
    - first page: fill in a name for `ClientID`. (set the client id in your env (`OAUTH2_RESOURCE_SERVER_ID`)).
    - second page: enable `Client authentication` and `Authorization`.
    - third page: does not need any config.
  - go to the client details and go to tab `Credentials` and copy the Client secret and pase it into your env file. (`OAUTH2_RESOURCE_SERVER_SECRET`)
  - if you don't use authorization and only use authentication set `OAUTH2_AUTHORIZATION_ACTIVE` to `False`. if you do have authentication, you should set `OAUTH2_TOKEN_URL` to the inspection endpoint of your auth provider.
  - run the backend.

# Contributing

Each PR, which typically addresses an existing ticket from the issue list, should have a reference to the issue (eg use the issue number in the branch name). Furthermore the PR should include a changeset describing the changes of the PR, which will become part of the changelog in NPM.

# Release and publish

## Preparing the release

```bash
npm run packages:changeset
```

- Include the changes made by this command in pull requests to the main branch
- Selecting packages that will get a version bump
- Specifies per selected package the type of version bump (`major`, `minor` or `patch`)
- Adds a description or release notes for the release
- All entries will be saved in a `.md` file in the `.changeset` folder

Once the pull-request with a changeset file is merged to the main branch another PR is opened by the Changesets-bot to update the version numbers of the packages. When this pull request gets merged to main an automatic publish to NPM will be performed.

## Release to NPM

Just merge the `Version Packages` PR into main, and the packages will be published to npm automatically.

## Create a deploy branch

Use the interactive deploy script when you want to create or update a deploy branch from a published `@orchestrator-ui/orchestrator-ui-components` tag.

This is useful because this repository is not a single deployable app. It is a monorepo that publishes reusable UI packages, while the example `apps/wfo-ui` application lives as a submodule during normal development. For deployment you usually want a branch that is tied to one published package version and that contains the example app as regular files, so the result can be pushed, reviewed, and deployed as one coherent snapshot.

The deploy script automates that translation from "published package tag in the monorepo" to "deployable application branch". Without it you would need to manually check out the correct package tag, update the submodule, convert the submodule content into tracked files, fix any tag-specific dependency gaps, and make sure you are pushing only to a fork instead of the official repository.

```bash
npm run deploy
```

This command will:

- let you select the version tag to deploy
- fetch deploy tags from the official `workfloworchestrator/orchestrator-ui-library` repository
- let you choose a safe push remote and refuse pushes to the official repository
- offer to create a fork with GitHub CLI when no safe push remote is configured, including custom names for the fork repository and local remote
- let you use the suggested deploy branch, select an existing branch, or enter a new branch name
- ask whether the push should use `--force-with-lease` (default is `no`)
- ask whether `@copilotkit/runtime` should be added to `apps/wfo-ui` when the selected tag does not already include it
- turn the `apps/wfo-ui` submodule into regular tracked files in the deploy branch so the branch is self-contained

The deploy flow resets the selected output branch to the chosen tag before creating the deploy commit, so make sure the target branch can be overwritten.

## Frontend-Backend versioning dependency

The file `version-compatibility.json` in the root of the orchestrator-ui-library is used to define the minimum backend version that is required for a specific frontend version.
In the UI a check is added to validate whether the UI matches a minimum release of the backend.

```
[
    {
        "orchestratorUiVersion": "3.4.0",
        "minimumOrchestratorCoreVersion": "2.10.0",
        "changes": "Endpoints in BE to modify description on metadata pages"
    },
    ...
]
```

## Storybook

The storybook can be run from the packages/orchestrator-ui-components/ folder, run:

```bash
npx storybook dev
```

Story book can be inspected on [http://localhost:61834/](http://localhost:61834/).
