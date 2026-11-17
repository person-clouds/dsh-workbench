[中文](README.md) | [English](README.en.md)

# DSH Workbench (dsh-workbench)

Put DSH workspaces, SA tickets and reports, delivery branch changes, Markdown documents and read-only code browsing into one sidebar panel. The SA Control tab opens the genuine `dsh-superagent` frontend page instead of maintaining a second, weaker form set — still without opening another port or a second DSH Host.

> Position: the delivery view and SA management entry for DSH. There is exactly one writer per source of truth: the DSH Host writes `workspace.json` and sessions; SA writes `orchestrator.sqlite`. This plugin only reads the SA database. The original `dsh-superagent` panel is the single source of truth for SA management UI.

## Panel layout

Sidebar icon (id `dsh-workbench`, label “DSH 工作台”) → `main` slot:

```text
[Workspaces] [Repos] [Docs] [Tickets] [SA Control]
```

| Tab | Content |
|---|---|
| Workspaces | Reads DSH `workspaceRegistry`: server-paged workspace cards plus an explicit “ungrouped” bucket; sessions default to **unarchived**, with an unarchived/archived/all switch; each card pages sessions on the server |
| Repos | SA delivery repo + DSH workspace paths + `<stateDir>/work/*` ticket subprojects; auto-detects git; server-paged repo cards and directory tree, file content, recent commits, dirty count; the repo list carries no sessions and the repo detail pages that repo's sessions separately (10/page by default) |
| Docs | Lists repos first, then loads that repo’s Markdown index on demand; folders are collapsed by default and expand level by level |
| Tickets | Server-paged SA ticket list, active-only by default; details contain reports, diffs and ticket records; retry/stop directly; the list does not run git lookups for every ticket |
| SA Control | Opens the genuine `dsh-superagent` main panel: Overview / Sources / Triggers / Eval / Execution / Settings & prompts. Workbench-only capabilities missing from the native page are listed in [`PLAN-sa-ui-migration.md`](PLAN-sa-ui-migration.md); not implemented in this round |

## Data sources

| Data | Source | Notes |
|---|---|---|
| Workspaces, session ownership | DSH `ctx.workspaceRegistry` | Same source as the DSH Web UI; ungrouped is computed on the Host |
| Session titles | DSH projection cache + permanent title cache + `ctx.sessionQuery` | Reads live/persisted projections first, then `<dshHome>/state/workbench/session-titles.json`; only current-page misses call `readTitleSnapshots` and write back |
| Repo list | `config.repos` + SA delivery repo + DSH workspaces + `<stateDir>/work/*` | Deduplicated by real path; tagged configured / sa-delivery / workspace / sa-work |
| Tickets, reports, SA settings | `~/.dsh/state/superagent/orchestrator.sqlite` | Opened read-only; WAL readable |
| Ticket records | `docs/work/<id8>-*.md` in the delivery repo's `origin/main` | Read-only git objects |
| Branch changes | `git diff <baseRef>...agent/<executor>` | Read-only; background `git fetch` updates refs only |
| Docs / code | `config.repos` + DSH workspace paths | `git` or `worktree` mode |
| SA management writes | Native `dsh-superagent` panel → `/orchestrator/api/*` | Same origin as the workbench; the old `lib/sa.js` proxy is only a fallback when the layout service is unavailable |


## List query conventions

- Growing lists use server-side `offset`/`limit` (limit capped at 50) and return `total`/`hasMore`;
  the client keeps only the current page and never slices a full response in the browser;
- Sessions default to `archived=active`; only an explicit `archived=archived|all` shows archived sessions.
  The Workspaces tab exposes an unarchived / archived / all switch;
- Sort fields and directions are allow-listed with defaults; time-based lists default to descending time
  with a unique id as the stable secondary key;
- The ticket list resolves document titles only for the current page and no longer runs `buildDiff`
  for every ticket in the database;
- Directory trees return one level with `entries + total + hasMore`; workspace session cards page via
  `view=sessions&workspace=<id|ungrouped>&offset=&limit=&archived=`, and repo detail sessions page via
  `view=repoSessions&repo=<id>&offset=&limit=&archived=`;
- Session titles check the DSH projection cache and permanent title cache first; only current-page
  misses read logs. `sort=title` hydrates before sorting. A successfully read archived title is cached
  permanently and survives a restart.

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

> The unified sidebar entry is `dsh-workbench`. If the old `dsh-superagent` panel still occupies a sidebar icon, use [`handover/dsh-superagent-hide-legacy-sidebar.patch`](handover/dsh-superagent-hide-legacy-sidebar.patch) to remove the duplicate entry; its `main` panel remains registered, and SA Control reuses it through `ctx.layout.selectPanel("dsh-superagent")`. See [`PLAN-sa-ui-migration.md`](PLAN-sa-ui-migration.md).

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
├── lib/workspaces.js     # DSH workspaceRegistry + ungrouped + session paging
├── lib/list.js           # list paging / archive filter / sort allow-list
├── lib/sessions.js       # sessionQuery session catalog; per-page title hydration
├── lib/title-cache.js    # permanent archived-title cache (atomic writes, warn-only failures)
├── lib/retention.js      # 60-day retention, safety checks and cleanup ledger
├── lib/sa.js             # SA management API allowlist proxy
├── client.js             # browser side: sidebar icon + 5 tabs; SA Control opens native panel
├── PLAN-sa-ui-migration.md # native SA compatibility and pending-migration backlog
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

## TODO and `/ok`

- When a user-visible session needs the user's next action, a hidden marker turns its title into `TODO: <title>`; subagent sessions are excluded.
- Sending `/ok` in the composer strips the prefix and archives the session asynchronously without sending a message or starting a model turn.
