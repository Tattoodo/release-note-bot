# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

`release-note-bot` is a serverless AWS Lambda that handles GitHub and Shortcut webhooks for Tattoodo repositories. It automates release operations: PR description changelogs, QA label management, semantic version tagging, GitHub releases, Slack deployment notifications, and platform-specific release flows for iOS and Android.

## Tech stack

- **Runtime:** Node.js 18 (`.nvmrc`, `engines`)
- **Language:** TypeScript (strict mode)
- **Deployment:** Serverless Framework → AWS Lambda + API Gateway
- **Key deps:** `@octokit/rest` (GitHub API), `@slack/webhook` (Slack notifications)
- **Tooling:** ESLint, Prettier, `tsc`. No test runner.

## Scripts

```bash
yarn install
yarn build      # prettier → eslint → tsc to dist/
yarn lint       # eslint src/**/*.ts
yarn deploy     # build + serverless deploy (also runs in CI on push to main)
yarn logs       # tail webhook lambda logs
```

There is no `yarn test`. Validate changes via `yarn build` (which lints + typechecks).

## Entry points

Three Lambda functions, defined in `serverless.yml`:

| Route | Handler | Purpose |
|---|---|---|
| `GET /ping` | `src/ping.ts` | GitHub webhook health check |
| `POST /webhook` | `src/webhook.ts` | GitHub PR & push events |
| `POST /shortcut-webhook` | `src/shortcut-webhook.ts` | Shortcut story state changes |

## Architecture: the effect system

`src/webhook.ts` dispatches events to a list of independent **effects** under `src/effects/`. Each effect exports:

```ts
export const name: string;
export const shouldRun: (payload) => boolean;
export const run: (payload) => Promise<string>;
```

Effects run in parallel via `Promise.all`. Failures are caught per-effect and logged — one failing effect never blocks others, and the webhook always returns 200.

Current effects:
- `renameTitle` — renames release PRs to `Production/Staging Release`
- `tagRelease` — semver bump + GitHub release on merged release PRs
- `tagReleaseFromGradleFile` — Android variant of `tagRelease`
- `tagReleaseFromPbxproj` — iOS variant
- `writeIosVersionToProjectFiles` — writes versions to `PRODUCTION_VERSIONS` for Xcode Cloud
- `updatePrStories` — generates PR-body changelog and manages the `untested` label
- `notifyDeploymentInSlack` — Slack notification on production/staging deploys
- `resyncReleaseNotes` — manual trigger via the `resync-notes` label

Each effect has its own `enabledForRepos` allowlist; an effect only runs for repos it opts into.

## Module layout

```
src/
├── webhook.ts                 # GitHub webhook router
├── ping.ts                    # health check
├── shortcut-webhook.ts        # Shortcut webhook handler
├── types.d.ts                 # GitHub event types + WebhookEffect interface
├── queue.ts                   # SinglePendingPromiseQueue (per-PR serialization)
├── helpers.ts                 # branch classification (production/staging/dev)
│
├── octokit.ts                 # authed Octokit client
├── github.ts                  # GitHub API helpers (labels, PR details, search)
├── shortcut.ts                # Shortcut API helpers (story fetch, ID extraction, members)
├── slack.ts                   # Slack message formatting
│
├── prStories.ts               # Changelog generation + QA verification (shared by effects)
├── prTitle.ts                 # Release PR title helpers
├── iosRelease.ts              # iOS dual-target (client-app / business-app) versioning
│
└── effects/                   # See above
```

Shared logic lives outside `effects/`. Effects should stay thin and delegate to these modules.

## Conventions

- **Formatting:** tabs, single quotes, no trailing commas, print width 120 (see `.prettierrc`). Run `yarn build` before committing.
- **TypeScript:** strict null checks and no implicit any are on. Don't paper over nulls with `!` — use proper guards.
- **Naming:** `camelCase` for vars/functions, `CONSTANT_CASE` for constants, `is*` for boolean predicates, leading `_` for module-private functions (e.g. `_updatePrStoriesAndQaStatus`).
- **Error handling:** log via `console.error` and return a sentinel (`null`, `[]`, or an error message string from an effect). Don't throw out of an effect's `run`.
- **Async:** prefer `Promise.all` for independent work.

## Things that are easy to get wrong

1. **The PR queue.** `prQueue` in `src/queue.ts` serializes operations per `owner/repo/number`. When adding new write paths to a PR, route them through `prQueue.add(key, ...)` to avoid races with concurrent webhooks.
2. **Changelog markers.** PR-body changelogs are wrapped in `<!-- changelog-start -->` / `<!-- changelog-end -->` so they can be regenerated without clobbering user content. Don't write to PR bodies outside this convention. Same pattern for the shipped-stories notice and the elastic mapping notice — see `stripGeneratedContent` in `src/prStories.ts`.
3. **Production vs staging behavior.** QA indicators (🚫 ✅ 🚢) and the `untested` label only apply on production base branches. `isBranchProduction` in `src/helpers.ts` is the source of truth. Production branches: `production`, `main`, `master`. Staging: `release`, `staging`.
4. **Hardcoded Shortcut workflow state IDs.** `QA_WORKFLOW_STATE_ID` and `READY_TO_SHIP_WORKFLOW_STATE_ID` in `src/shortcut.ts` are org-specific magic numbers tied to the Tattoodo Shortcut workspace.
5. **Story ID extraction.** Story IDs are pulled from branch names (`sc-123/...`), commit messages (`Merge pull request #1 from org/sc-123/...`), and bracket notation (`[sc-123]`). See `extractStoryIdsFromBranchAndMessages` in `src/shortcut.ts`.
6. **iOS dual targets.** `app-ios` ships two independent apps (`client-app`, `business-app`) with separate version tracks. Versions live in `PRODUCTION_VERSIONS` (read by Xcode Cloud), not in `.xcodeproj`. See `src/iosRelease.ts` and `src/effects/writeIosVersionToProjectFiles.ts`.
7. **`resync-notes` label.** Adding this label to any PR re-runs title + story updates and then removes itself. Useful as a manual recovery hatch.
8. **Effect allowlists.** A new effect is inert until its `enabledForRepos` includes the target repo.

## Environment / secrets

Loaded from AWS SSM Parameter Store via `serverless.yml`:

- `GITHUB_API_TOKEN`
- `CLUBHOUSE_API_TOKEN` (Shortcut, formerly Clubhouse)
- `RELEASE_SLACK_WEBHOOK_URL_PRODUCTION`
- `RELEASE_SLACK_WEBHOOK_URL_STAGING`

## Deployment

`yarn deploy` runs locally; CI (`.github/workflows/deploy-serverless.yml`) deploys automatically on push to `main`.
