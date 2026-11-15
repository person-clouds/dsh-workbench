[中文](README.md) | [English](README.en.md)

# DSH Workbench (dsh-workbench)

Put DSH workspaces, SA tickets and reports, delivery branch changes, Markdown documents and read-only code browsing into one sidebar panel. SA operations are invoked from the same panel through the SA management API, without opening another port or a second DSH Host.

> Position: the delivery view and SA management entry for DSH. There is exactly one writer per source of truth: the DSH Host writes `workspace.json` and sessions; SA writes `orchestrator.sqlite`. This plugin only reads the SA database and sends writes through the SA management API.

## Panel layout

Sidebar icon (id `dsh-workbench`, label “DSH 工作台”) → `main` slot:

```text
[Workspaces] [Repos] [Docs] [Tickets] [SA Control]
```

| Tab | Content |
|---|---|
| Workspaces | Reads DSH `workspaceRegistry`: all workspaces plus an explicit “ungrouped” bucket; shows session name/ID/archive/pin (archive and pin are read-only) |
| Repos | SA delivery repo + DSH workspace paths + `<stateDir>/work/*` ticket subprojects; auto-detects git; directory tree, file content, recent commits, dirty count, session names |
| Docs | Markdown index grouped by repo, expanded as a tree by file path |
| Tickets | SA ticket list and details: reports, diffs, ticket records; retry/stop directly |
| SA Control | Overview/problems/health, source status and label refresh, policy/executor/source forms, prompt team sections/skills/revision history; writes are proxied to `/orchestrator/api/*` |

## Data sources

| Data | Source | Notes |
|---|---|---|
| Workspaces, session ownership | DSH `ctx.workspaceRegistry` | Same source as the DSH Web UI; ungrouped is computed on the Host |
| Session titles | DSH `ctx.sessionQuery` | `readTitleSnapshots`; returned with workspace/repo lists |
| Repo list | `config.repos` + SA delivery repo + DSH workspaces + `<stateDir>/work/*` | Deduplicated by real path; tagged configured / sa-delivery / workspace / sa-work |
| Tickets, reports, SA settings | `~/.dsh/state/superagent/orchestrator.sqlite` | Opened read-only; WAL readable |
| Ticket records | `docs/work/<id8>-*.md` in the delivery repo's `origin/main` | Read-only git objects |
| Branch changes | `git diff <baseRef>...agent/<executor>` | Read-only; background `git fetch` updates refs only |
| Docs / code | `config.repos` + DSH workspace paths | `git` or `worktree` mode |
| SA management writes | `/dsh-workbench/api/sa` → `/orchestrator/api/*` | Same origin, DSH login state and `x-orchestrator-request: 1` |

## Install

```bash
# Local development directory
cd /home/zh/www/personalCloud/task/dsh-workbench

# Through the DSH plugin manager, or:
dsh plugin --profile web add link:/home/zh/www/personalCloud/task/dsh-workbench
```

Published-package install:

```bash
dsh plugin --profile web add dsh-workbench
```

Uninstall: remove `dsh-workbench` in the plugin manager (the source directory is not deleted).

## Configuration

Edit under DSH Settings → Plugins → DSH Workbench, or write it into the profile's `cordis.patch.yml`:

```yaml
- id: dsh-workbench
  name: dsh-workbench
  config:
    dshHome: /home/zh/.dsh
    stateDir: /home/zh/.dsh/state/superagent
    repoDir: /home/zh/src/dshSuperagentRepo
    baseRef: origin/main
    cacheSeconds: 10
    fetchMinutes: 10
    repos: []                 # optional; empty means use DSH workspace paths
    retentionDays: 60
    retentionAutoCleanup: true
    retentionCheckMinutes: 60
    saApiBase: ''             # empty means the current DSH Host loopback address
```

Each `repos` item: `{ id, name, path, mode: git|worktree, ref, description, remote, exclude }`.
Besides explicit `repos`, the repo list automatically includes the SA delivery repo pointed to by `repoDir`, all DSH `workspaceRegistry` workspaces, and SA ticket subprojects under `<stateDir>/work/*`. The same real path appears only once; `superagent-console/repos.json` is no longer read.

> The unified sidebar entry is `dsh-workbench`. If the old `dsh-superagent` panel still occupies a sidebar icon, use [`handover/dsh-superagent-hide-legacy-sidebar.patch`](handover/dsh-superagent-hide-legacy-sidebar.patch) to remove the duplicate entry; the old panel's `main` deep link remains for troubleshooting.

## 60-day retention and cleanup

- SA ticket archives (unfinished tickets are never cleaned) become candidates only after `retentionDays`.
- Only worktrees under `~/src/dsh-worktrees/` and `<stateDir>/work/` are handled, and only after all checks pass: dirty workspace, locks, paths, session archive, etc.
- `git worktree remove` runs first, then the DSH workspace registration is removed; DSH session logs are never deleted.
- A panel dry-run is available; automatic cleanup runs at most once every 24 hours and writes its result to `~/.dsh/state/workbench/retention.json`.
- `retentionAutoCleanup` in `cordis.patch.yml` is the initial value; once `retention.json` exists, the runtime switch follows `settings.autoCleanup` in that ledger. Use `handover/enable-retention-auto-cleanup.sh --apply` to enable it, which synchronizes config and ledger.
- Any failed check preserves the scene and records the reason; there is no `rm -rf` fallback.

## Security boundaries

- Registers exactly one route prefix: `/dsh-workbench/api`. Host/Origin and browser login state are decided by DSH Connection's `ctx.connection.requestRejection`: 401 when unauthenticated, 403 for untrusted origins.
- SA writes must carry `x-orchestrator-request: 1` and may only use allowlisted methods/paths.
- No credentials or `.env` files are read; code browsing blocks `.env*`, `.git`, credential directories, `*.pem/*.key/*.sqlite/*.db`, etc.
- All content is rendered as React elements; `innerHTML` is not used.

## Directory layout

```text
task/dsh-workbench/
├── package.json          # bundle manifest: dsh.bundle.patch + dsh.client (web, immediately)
├── cordis.patch.yml      # insert row dsh-workbench
├── index.js              # Host: routes, snapshots, SA proxy, background fetch, retention loop
├── lib/tickets.js        # read-only orchestrator.sqlite
├── lib/gitdata.js        # git show / ls-tree / diff / fetch
├── lib/markdown.js       # Markdown subset → blocks / inline spans; diff chunks
├── lib/repos.js          # read-only repos: docs index / tree / file contents
├── lib/workspaces.js     # DSH workspaceRegistry + ungrouped + session titles
├── lib/sessions.js       # sessionQuery session catalog and title snapshots
├── lib/retention.js      # 60-day retention, safety checks and cleanup ledger
├── lib/sa.js             # SA management API allowlist proxy
├── client.js             # browser side: sidebar icon + 5 tabs
├── locale/zh.json        # Chinese copy
├── locale/en.json
├── market/person-clouds__dsh-workbench.yml
├── icon.svg
├── scripts/
│   ├── sa-state.sh            # read-only SA runtime state (journal token → cookie → /orchestrator/api/state)
│   └── retire-legacy-units.sh # retire old units (dsh-superagent / superagent-console), idempotent
└── handover/                  # single-Host switching scripts and patches (switch-single-host.sh etc.)
```

`sa-state.sh` is the single implementation for reading SA runtime state: `cloudctl sa status` and `task/health-watch/scripts/checks/50-superagent.sh` both call it, avoiding two different interpretations.

## Known limitations

- Branch changes are readable only while the branch is pushed or still exists locally; if the execution directory and branch are gone, only reports and docs remain.
- A single diff is truncated at 400 KB; files over 2 MB or binary files are not inlined.
- No full-text code search.
- Anyone who can see the workbench can see tickets, docs and code (same as DSH login state).
