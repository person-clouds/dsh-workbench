/**
 * DSH 工作台（浏览器端）：在侧栏加一个独立面板，读 Host 的 /dsh-workbench/api，
 * 展示工作区、仓库、文档、SA 工单与 SA 控制，并管理 60 天保留清理。
 *
 * 渲染入口与 dsh-superagent 官方面板一致（main 槽位 + sidebar.panellist 图标）。
 */
// 浏览器端插件脚本由 dsh-client-modules 以**普通脚本**原样拼接执行（只注册
// window.__ModuleLoader__.load 的工厂），不得出现 import / export：顶层 import
// 会让整条 entry 在 import 阶段失败（"<id> import failed (see console)"）。
// 因此字典直接内联；改动文案时请同步 locale/zh.json、locale/en.json 与本处。
window.__ModuleLoader__.load({
  id: 'dsh-workbench',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const API = '/dsh-workbench/api'
    const PANEL_ID = 'dsh-workbench'
    const NS = 'dshWorkbench'
    const REFRESH_MS = 20_000

    // 语言字典放在 factory 内：顶层 const 在 HMR/重复加载时会造成
    // "Identifier 'zh' has already been declared"，表现为 bundle 未注册。
    const zh = {
      "meta": {
        "title": "DSH 工作台",
        "description": "统一管理工作区、仓库、文档、SA 工单与运行配置。"
      },
      "panel": "DSH 工作台",
      "navWorkspaces": "工作区",
      "navRepos": "仓库",
      "navDocs": "文档",
      "navTickets": "工单",
      "navSa": "SA 控制",
      "loading": "正在读取…",
      "loadFailed": "读取失败：{message}",
      "retry": "重试",
      "refresh": "刷新",
      "workspacesTitle": "工作区",
      "workspacesHint": "这些记录来自当前 DSH Host 的 workspaceRegistry，是唯一写者。",
      "workspaceCount": "{n} 个工作区",
      "noWorkspaces": "还没有工作区。",
      "workspacePath": "路径",
      "workspaceCreated": "创建",
      "workspaceMissing": "目录不存在",
      "workspaceSessions": "会话",
      "sessionArchived": "已归档",
      "sessionPinned": "已 pin",
      "sessionNormal": "普通会话",
      "sessionOrchestrator": "orchestrator",
      "sessionWorker": "worker",
      "reposTitle": "仓库",
      "reposHint": "来源为 DSH 插件配置与工作区自动识别。",
      "repoCount": "{n} 个仓库",
      "noRepos": "没有可用的仓库。",
      "openRepo": "浏览仓库",
      "repoUnavailable": "仓库不可用：{message}",
      "modeGit": "git 对象（不改工作区）",
      "modeWorktree": "工作区文件",
      "dirty": "{n} 个未提交",
      "head": "最新提交",
      "commits": "最近提交",
      "noCommits": "没有读到提交记录。",
      "backToRepos": "返回仓库列表",
      "backToTree": "返回目录",
      "emptyTree": "这个目录是空的。",
      "dirCount": "{n} 个目录",
      "fileCount": "{n} 个文件",
      "fileTooLarge": "文件超过 2MB，不在页面内渲染。",
      "binaryFile": "二进制文件，不在页面内渲染。",
      "docFile": "Markdown 文档",
      "codeFile": "源码文件",
      "docsTitle": "文档",
      "docsHint": "浏览仓库里的 Markdown 文档。",
      "docsCount": "{n} 篇",
      "noDocs": "没有可读的 Markdown 文档。",
      "openDoc": "打开文档",
      "backToDocs": "返回文档列表",
      "tickets": "工单",
      "all": "全部",
      "live": "进行中",
      "countAll": "共 {n} 条",
      "countLive": "{n} 条进行中",
      "filterLive": "只看进行中",
      "filterAll": "看全部",
      "back": "返回列表",
      "emptyTickets": "没有读到工单。SA 还没处理过需求，或工单库路径不对。",
      "emptyLive": "当前没有进行中的工单。",
      "summary": "执行摘要",
      "latestReport": "最新报告",
      "reports": "执行报告（{n} 轮）",
      "reportRound": "第 {n} 轮",
      "noReport": "还没有执行报告。",
      "doc": "工单记录",
      "noDoc": "仓库里没有这篇工单记录（docs/work/{prefix}-*.md）。",
      "diff": "分支改动",
      "noDiff": "还没有可读的分支改动：分支尚未推送，或与 main 没有差异。",
      "diffFiles": "{n} 个文件",
      "diffTruncated": "补丁过大，只展示前 400KB。",
      "source": "来源",
      "createdAt": "创建",
      "updatedAt": "更新",
      "branch": "分支",
      "execDir": "执行目录",
      "execExists": "本地仍在",
      "execCleaned": "已清理",
      "outcome": "结束",
      "fullId": "完整 ID",
      "pullRequest": "Pull Request",
      "issue": "Issue",
      "attention": "等待回答",
      "dbMissing": "读不到工单库：{message}",
      "repoMissing": "SA 交付仓库不可用：{dir}。分支改动与工单记录将无法显示。",
      "syncOk": "仓库已同步 {time}",
      "syncFail": "上次同步失败：{message}",
      "saTitle": "SA 控制",
      "saHint": "只通过 SA management API 读写；不直连 SQLite。",
      "saState": "运行状态",
      "saSources": "来源",
      "saSettings": "配置",
      "saPrompts": "提示词",
      "saPause": "暂停执行器",
      "saResume": "恢复执行器",
      "saSetupCheck": "重新检查环境",
      "saRetry": "重试工单",
      "saStop": "停止工单",
      "saSave": "保存 JSON",
      "saSaved": "已保存",
      "saRaw": "原始 JSON",
      "saUnavailable": "SA 管理接口不可用：{message}",
      "ungroupedTitle": "未分组",
      "ungroupedHint": "不属于任何工作区的 DSH 会话；与工作区页使用同一套会话目录。",
      "ungroupedCount": "{n} 个未分组会话",
      "workspaceSessionCount": "{n} 个会话",
      "sessionUntitled": "未命名会话",
      "noSessions": "没有会话。",
      "sessionUpdated": "更新于 {time}",
      "sessionRange": "显示 {from}-{to} / 共 {total} 个会话",
      "sessionShowAll": "查看全部",
      "sessionCollapse": "收起",
      "listRange": "显示 {from}-{to} / 共 {total} 项",
      "listPrev": "上一页",
      "listNext": "下一页",
      "docsTreeHint": "目录默认收起，点击逐层展开。",
      "docsRepoHint": "先选择仓库，再按目录层级展开文档。",
      "docsRepoCount": "{n} 个仓库",
      "backToDocsRepos": "返回仓库列表",
      "repoSourceConfigured": "DSH 配置",
      "repoSourceWorkspace": "工作区自动识别",
      "repoSourceSaWork": "SA 子项目",
      "repoSourceSaDelivery": "SA 交付仓库",
      "repoGit": "git 仓库",
      "repoNoGit": "非 git 目录",
      "repoSessionCount": "{n} 个会话",
      "saOverview": "概览",
      "saSourcesTab": "来源",
      "saSettingsTab": "配置",
      "saPromptsTab": "提示词",
      "saThreadsTab": "线程",
      "saDecisionsTab": "决策",
      "saNoThreads": "没有订阅的线程。",
      "saNoDecisions": "没有决策记录。",
      "saUnsubscribe": "取消订阅",
      "saDismiss": "忽略",
      "saActionDone": "操作完成。",
      "saThreadTickets": "关联工单",
      "saPendingCount": "待处理 {n}",
      "saDecisionAccept": "受理",
      "saDecisionIgnore": "忽略",
      "saDecisionUnavailable": "不可用",
      "saReason": "原因",
      "saSetupDir": "状态目录",
      "saAccounts": "账号",
      "saHealth": "健康",
      "saLoad": "执行器负载",
      "saActiveWorkers": "活跃 {n}/{m}",
      "saActiveWorkersLabel": "活跃执行器",
      "saProblems": "需要处理",
      "saNoProblems": "没有发现运行问题。",
      "saSetup": "环境与账号",
      "saMaster": "主会话",
      "saPaused": "执行器已暂停",
      "saRunning": "执行器运行中",
      "saSourceEnabled": "已启用",
      "saSourceDisabled": "已停用",
      "saReceived": "24h 收到",
      "saFiltered": "已过滤",
      "saLastAt": "最近",
      "saSaveChanges": "保存",
      "saSaving": "保存中…",
      "saRevision": "修订 {n}",
      "saRestartHint": "保存后 SA 可能按配置重启。",
      "saEnabled": "启用",
      "saAdvanced": "高级字段",
      "saAddRow": "添加一行",
      "saRemoveRow": "删除",
      "saPromptsTeam": "团队提示词",
      "saPromptsSkills": "技能",
      "saPromptsOverrides": "内置片段覆盖",
      "saPromptsHistory": "修订历史",
      "saPromptsCurrent": "当前",
      "saPromptsDefault": "内置默认",
      "saAddSkill": "添加技能",
      "saAdvancedJson": "高级 JSON",
      "saNoSources": "没有已注册的来源。",
      "saRefreshLabels": "刷新成员",
      "saPolicySync": "同步策略",
      "saConflict": "配置已被修改：请刷新后重试。",
      "saReady": "就绪",
      "saStarting": "启动中",
      "saError": "错误",
      "saMissing": "未安装",
      "saNoHealth": "暂无健康条目。",
      "saNoFields": "没有可编辑字段。",
      "saInvalidJson": "JSON 格式不正确，修正后才会保存。",
      "saPrompt_communication": "沟通方式",
      "saPrompt_scope": "工单范围",
      "saPrompt_delivery": "交付要求",
      "saNoSkills": "没有自定义技能。",
      "saNoHistory": "没有修订历史。",
      "saPromptsOverrides": "内置片段覆盖",
      "saNoOverrides": "没有覆盖内置片段。",
      "saAddOverride": "添加覆盖",
      "saIdle": "空闲工单",
      "saQueued": "排队",
      "saFlow": "24 小时流程",
      "saJudged": "已评估",
      "saAccepted": "已受理",
      "saDropped": "已丢弃",
      "saPolicyVersion": "策略版本",
      "saExecutorLabel": "执行器",
      "saPolicyRules": "受理规则",
      "saPolicySources": "来源策略",
      "saRuleId": "规则 ID",
      "saRuleName": "规则名",
      "saRuleInstruction": "规则说明",
      "saNewRule": "新规则",
      "saAddRule": "添加规则",
      "saProblemSetup": "环境尚未完成初始化",
      "saProblemNoSource": "没有可用的来源",
      "saProblemNoAllowed": "没有可发起工作的账号",
      "saProblemSourceError": "来源报错",
      "saProblemPaused": "执行器已暂停",
      "saProblemRuntime": "运行时错误",
      "saProblemEvalOverdue": "评估超时",
      "saProblemEvalUnavailable": "评估不可用",
      "saProblemOutgoing": "消息发送失败",
      "saNoPrompts": "没有读到提示词配置。",
      "saFieldOptional": "可选",
      "retentionTitle": "保留与清理",
      "retentionHint": "结束满 {days} 天、worker 已归档、无未提交改动、无打开 PR、未 pin 的 worktree 才可清理。session 日志永不删除。",
      "retentionAuto": "自动清理",
      "retentionNext": "下次检查",
      "retentionDryRun": "手动 dry-run",
      "retentionCleanup": "执行清理",
      "retentionEligible": "可清理",
      "retentionLedger": "最近清理",
      "retentionNoCandidates": "当前没有可清理的 worktree。",
      "retentionNoLedger": "还没有清理记录。",
      "retentionChecks": "安全检查",
      "retentionBlocked": "已阻止",
      "retentionOk": "通过",
      "retentionAge": "结束 {n} 天",
      "retentionRunDone": "本轮处理 {n} 张，清理 {m} 个。",
      "loadingData": "正在读取…",
      "readFailed": "读取失败：{message}",
      "lineNo": "行号",
      "repoPath": "路径",
      "refreshedAt": "更新于 {time}"
    }
    const en = {
      "meta": {
        "title": "DSH Workbench",
        "description": "Manage workspaces, repositories, docs, SA tickets and runtime configuration in one place."
      },
      "panel": "DSH Workbench",
      "navWorkspaces": "Workspaces",
      "navRepos": "Repos",
      "navDocs": "Docs",
      "navTickets": "Tickets",
      "navSa": "SA control",
      "loading": "Loading…",
      "loadFailed": "Could not load: {message}",
      "retry": "Retry",
      "refresh": "Refresh",
      "workspacesTitle": "Workspaces",
      "workspacesHint": "These records come from the current DSH Host workspaceRegistry, the only writer.",
      "workspaceCount": "{n} workspaces",
      "noWorkspaces": "No workspaces yet.",
      "workspacePath": "Path",
      "workspaceCreated": "Created",
      "workspaceMissing": "Directory missing",
      "workspaceSessions": "Sessions",
      "sessionArchived": "archived",
      "sessionPinned": "pinned",
      "sessionNormal": "session",
      "sessionOrchestrator": "orchestrator",
      "sessionWorker": "worker",
      "reposTitle": "Repositories",
      "reposHint": "Sources are DSH plugin configuration plus auto-detected workspaces.",
      "repoCount": "{n} repos",
      "noRepos": "No repository available.",
      "openRepo": "Browse repository",
      "repoUnavailable": "Repository unavailable: {message}",
      "modeGit": "Git objects (worktree untouched)",
      "modeWorktree": "Worktree files",
      "dirty": "{n} uncommitted",
      "head": "Latest commit",
      "commits": "Recent commits",
      "noCommits": "No commits found.",
      "backToRepos": "Back to repositories",
      "backToTree": "Back to directory",
      "emptyTree": "This directory is empty.",
      "dirCount": "{n} dirs",
      "fileCount": "{n} files",
      "fileTooLarge": "File is larger than 2MB and is not rendered inline.",
      "binaryFile": "Binary file, not rendered inline.",
      "docFile": "Markdown document",
      "codeFile": "Source file",
      "docsTitle": "Docs",
      "docsHint": "Browse Markdown documents in repositories.",
      "docsCount": "{n} docs",
      "noDocs": "No readable Markdown documents.",
      "openDoc": "Open document",
      "backToDocs": "Back to docs",
      "tickets": "Tickets",
      "all": "All",
      "live": "Active",
      "countAll": "{n} total",
      "countLive": "{n} active",
      "filterLive": "Active only",
      "filterAll": "Show all",
      "back": "Back to list",
      "emptyTickets": "No tickets were found. SA has not handled any request yet, or the ticket database path is wrong.",
      "emptyLive": "No active tickets right now.",
      "summary": "Execution summary",
      "latestReport": "Latest report",
      "reports": "Reports ({n} rounds)",
      "reportRound": "Round {n}",
      "noReport": "No report yet.",
      "doc": "Work note",
      "noDoc": "This repository has no work note for the ticket (docs/work/{prefix}-*.md).",
      "diff": "Branch changes",
      "noDiff": "No branch changes to read: the branch is not pushed yet, or it has no difference from main.",
      "diffFiles": "{n} files",
      "diffTruncated": "The patch is too large; only the first 400KB is shown.",
      "source": "Source",
      "createdAt": "Created",
      "updatedAt": "Updated",
      "branch": "Branch",
      "execDir": "Execution directory",
      "execExists": "Still on disk",
      "execCleaned": "Cleaned up",
      "outcome": "Outcome",
      "fullId": "Full ID",
      "pullRequest": "Pull request",
      "issue": "Issue",
      "attention": "Waiting for an answer",
      "dbMissing": "Ticket database unavailable: {message}",
      "repoMissing": "SA delivery repository unavailable: {dir}. Branch changes and work notes cannot be shown.",
      "syncOk": "Repository synced {time}",
      "syncFail": "Last sync failed: {message}",
      "saTitle": "SA control",
      "saHint": "Reads and writes only through the SA management API; never SQLite directly.",
      "saState": "Runtime state",
      "saSources": "Sources",
      "saSettings": "Settings",
      "saPrompts": "Prompts",
      "saPause": "Pause executor",
      "saResume": "Resume executor",
      "saSetupCheck": "Re-check setup",
      "saRetry": "Retry ticket",
      "saStop": "Stop ticket",
      "saSave": "Save JSON",
      "saSaved": "Saved",
      "saRaw": "Raw JSON",
      "saUnavailable": "SA management API unavailable: {message}",
      "ungroupedTitle": "Ungrouped",
      "ungroupedHint": "DSH sessions that belong to no workspace; built from the same session catalog as the workspace cards.",
      "ungroupedCount": "{n} ungrouped sessions",
      "workspaceSessionCount": "{n} sessions",
      "sessionUntitled": "Untitled session",
      "noSessions": "No sessions.",
      "sessionUpdated": "Updated {time}",
      "sessionRange": "Showing {from}-{to} of {total} sessions",
      "sessionShowAll": "Show all",
      "sessionCollapse": "Collapse",
      "listRange": "Showing {from}-{to} of {total}",
      "listPrev": "Prev",
      "listNext": "Next",
      "docsTreeHint": "Folders are collapsed by default; expand level by level.",
      "docsRepoHint": "Pick a repository, then expand its docs by folder.",
      "docsRepoCount": "{n} repos",
      "backToDocsRepos": "Back to repositories",
      "repoSourceConfigured": "DSH config",
      "repoSourceWorkspace": "Auto-detected workspace",
      "repoSourceSaWork": "SA subproject",
      "repoSourceSaDelivery": "SA delivery repo",
      "repoGit": "git repository",
      "repoNoGit": "non-git directory",
      "repoSessionCount": "{n} sessions",
      "saOverview": "Overview",
      "saSourcesTab": "Sources",
      "saSettingsTab": "Settings",
      "saPromptsTab": "Prompts",
      "saThreadsTab": "Threads",
      "saDecisionsTab": "Decisions",
      "saNoThreads": "No subscribed threads.",
      "saNoDecisions": "No decisions yet.",
      "saUnsubscribe": "Unsubscribe",
      "saDismiss": "Dismiss",
      "saActionDone": "Done.",
      "saThreadTickets": "Tickets",
      "saPendingCount": "{n} pending",
      "saDecisionAccept": "accept",
      "saDecisionIgnore": "ignore",
      "saDecisionUnavailable": "unavailable",
      "saReason": "Reason",
      "saSetupDir": "State directory",
      "saAccounts": "Accounts",
      "saHealth": "Health",
      "saLoad": "Executor load",
      "saActiveWorkers": "active {n}/{m}",
      "saActiveWorkersLabel": "Active workers",
      "saProblems": "Needs attention",
      "saNoProblems": "No runtime problems found.",
      "saSetup": "Environment & accounts",
      "saMaster": "Main session",
      "saPaused": "Executor paused",
      "saRunning": "Executor running",
      "saSourceEnabled": "enabled",
      "saSourceDisabled": "disabled",
      "saReceived": "24h received",
      "saFiltered": "filtered",
      "saLastAt": "last",
      "saSaveChanges": "Save",
      "saSaving": "Saving…",
      "saRevision": "r{n}",
      "saRestartHint": "Saving may restart SA according to its setup fields.",
      "saEnabled": "Enabled",
      "saAdvanced": "Advanced fields",
      "saAddRow": "Add row",
      "saRemoveRow": "Remove",
      "saPromptsTeam": "Team prompts",
      "saPromptsSkills": "Skills",
      "saPromptsOverrides": "Built-in overrides",
      "saPromptsHistory": "Revision history",
      "saPromptsCurrent": "current",
      "saPromptsDefault": "built-in default",
      "saAddSkill": "Add skill",
      "saAdvancedJson": "Advanced JSON",
      "saNoSources": "No sources registered.",
      "saRefreshLabels": "Refresh members",
      "saPolicySync": "Sync policy",
      "saConflict": "Settings changed: refresh and try again.",
      "saReady": "ready",
      "saStarting": "starting",
      "saError": "error",
      "saMissing": "missing",
      "saNoHealth": "No health entries.",
      "saNoFields": "No editable fields.",
      "saInvalidJson": "Invalid JSON; fix it before saving.",
      "saPrompt_communication": "Communication",
      "saPrompt_scope": "Ticket scope",
      "saPrompt_delivery": "Delivery requirements",
      "saNoSkills": "No custom skills.",
      "saNoHistory": "No revision history.",
      "saPromptsOverrides": "Built-in overrides",
      "saNoOverrides": "No built-in overrides.",
      "saAddOverride": "Add override",
      "saIdle": "Idle tickets",
      "saQueued": "Queued",
      "saFlow": "24h flow",
      "saJudged": "judged",
      "saAccepted": "accepted",
      "saDropped": "dropped",
      "saPolicyVersion": "Policy version",
      "saExecutorLabel": "Executor",
      "saPolicyRules": "Admission rules",
      "saPolicySources": "Source policy",
      "saRuleId": "Rule ID",
      "saRuleName": "Rule name",
      "saRuleInstruction": "Rule instruction",
      "saNewRule": "New rule",
      "saAddRule": "Add rule",
      "saProblemSetup": "Setup is not complete",
      "saProblemNoSource": "No source available",
      "saProblemNoAllowed": "No account may originate work",
      "saProblemSourceError": "Source error",
      "saProblemPaused": "Executor is paused",
      "saProblemRuntime": "Runtime error",
      "saProblemEvalOverdue": "Eval overdue",
      "saProblemEvalUnavailable": "Eval unavailable",
      "saProblemOutgoing": "Outgoing message failed",
      "saNoPrompts": "No prompt configuration was returned.",
      "saFieldOptional": "optional",
      "retentionTitle": "Retention & cleanup",
      "retentionHint": "Only worktrees older than {days} days whose worker is archived, clean, has no open PR and is not pinned are eligible. Session logs are never deleted.",
      "retentionAuto": "Auto cleanup",
      "retentionNext": "Next check",
      "retentionDryRun": "Dry run",
      "retentionCleanup": "Clean up now",
      "retentionEligible": "Eligible",
      "retentionLedger": "Recent cleanup",
      "retentionNoCandidates": "No worktree is eligible right now.",
      "retentionNoLedger": "No cleanup record yet.",
      "retentionChecks": "Safety checks",
      "retentionBlocked": "Blocked",
      "retentionOk": "Passed",
      "retentionAge": "ended {n} days ago",
      "retentionRunDone": "Processed {n}, cleaned {m}.",
      "loadingData": "Loading…",
      "readFailed": "Could not load: {message}",
      "lineNo": "Line",
      "repoPath": "Path",
      "refreshedAt": "Updated {time}"
    }

    // ---------------- 样式：只用 --dsw-alias-* 主题令牌，跟随明暗与字体 ----------------

    const CSS = `
.sawb-root { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); font-size: 13px; line-height: 1.55; }
.sawb-head { display: flex; align-items: center; gap: 10px; padding: 12px clamp(18px, 3vw, 40px); border-bottom: 1px solid var(--dsw-alias-border-l1); flex-wrap: wrap; flex: 0 0 auto; background: var(--dsw-alias-bg-base); }
.sawb-head.sawb-subhead { border-bottom: 0; padding-bottom: 2px; }
.sawb-title { margin: 0; font-size: 15px; font-weight: 600; }
.sawb-meta { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.sawb-spacer { flex: 1; }
.sawb-btn { border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); border-radius: 6px; padding: 3px 10px; font: inherit; font-size: 12px; cursor: pointer; }
.sawb-btn:hover { background: var(--dsw-alias-bg-layer-2); }
.sawb-btn[aria-pressed="true"] { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-brand-primary); }
.sawb-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.sawb-btn.sawb-btn-sm { padding: 2px 8px; }
.sawb-tabs { display: inline-flex; gap: 2px; padding: 2px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); }
.sawb-tabs button { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; padding: 3px 12px; border-radius: 6px; cursor: pointer; }
.sawb-tabs button[aria-pressed="true"] { background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); box-shadow: 0 1px 2px rgba(0,0,0,.12); }
.sawb-tabs button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 0; }
.sawb-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 24px clamp(18px, 3vw, 40px) 52px; overscroll-behavior: contain; scrollbar-width: thin; }
.sawb-body.sawb-body-tight { padding-top: 12px; }
.sawb-notice { border: 1px solid var(--dsw-alias-state-warn-primary); border-radius: 8px; padding: 8px 12px; margin: 0 0 12px; font-size: 12px; }
.sawb-notice.sawb-error { border-color: var(--dsw-alias-state-error-primary); }
.sawb-empty { color: var(--dsw-alias-label-secondary); padding: 24px 0; text-align: center; }
.sawb-badge { display: inline-block; padding: 0 7px; border-radius: 999px; font-size: 11px; line-height: 18px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.sawb-badge.live { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.sawb-badge.ok { border-color: var(--dsw-alias-state-success-primary); color: var(--dsw-alias-state-success-primary); }
.sawb-badge.muted { border-color: var(--dsw-alias-state-idle-primary); color: var(--dsw-alias-state-idle-primary); }
.sawb-row { display: grid; grid-template-columns: 78px 1fr auto; gap: 2px 12px; width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--dsw-alias-border-l1); background: transparent; color: inherit; font: inherit; padding: 9px 8px; cursor: pointer; }
.sawb-row:hover { background: var(--dsw-alias-bg-layer-2); }
.sawb-row:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.sawb-row-title { font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sawb-mono { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 12px; color: var(--dsw-alias-label-secondary); }
.sawb-row-sub { grid-column: 2 / 4; font-size: 12px; color: var(--dsw-alias-label-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sawb-row-side { display: flex; align-items: center; gap: 8px; }
.sawb-detail-head { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.sawb-detail-title { margin: 0; font-size: 17px; font-weight: 600; line-height: 1.4; }
.sawb-facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px 18px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 10px 14px; margin: 0 0 14px; background: var(--dsw-alias-bg-layer-1); }
.sawb-facts div { min-width: 0; }
.sawb-facts dt { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.sawb-facts dd { margin: 0; overflow-wrap: anywhere; font-size: 12px; }
.sawb-section { margin-bottom: 16px; }
.sawb-section h3 { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; font-size: 13px; font-weight: 600; flex-wrap: wrap; }
.sawb-panel { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 14px 18px; line-height: 1.75; }
.sawb-md p { margin: 0 0 6px; }
.sawb-md ul, .sawb-md ol { margin: 0 0 6px; padding-left: 20px; }
.sawb-md code { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 12px; background: var(--dsw-alias-bg-layer-2); border-radius: 4px; padding: 0 4px; }
.sawb-md pre { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 12px; background: var(--dsw-alias-bg-layer-2); border-radius: 6px; padding: 8px 10px; overflow: auto; margin: 0 0 8px; }
.sawb-md blockquote { margin: 0 0 6px; padding-left: 10px; border-left: 2px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }
.sawb-table-wrap { width: 100%; overflow-x: auto; margin: 4px 0 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; }
.sawb-md table { width: 100%; border-collapse: collapse; font-size: 12px; }
.sawb-md th, .sawb-md td { padding: 8px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); text-align: left; vertical-align: top; }
.sawb-md th { background: var(--dsw-alias-bg-layer-2); font-weight: 600; white-space: nowrap; }
.sawb-md tr:last-child td { border-bottom: 0; }
.sawb-md a, .sawb-link { color: var(--dsw-alias-brand-primary); text-decoration: none; overflow-wrap: anywhere; }
.sawb-md a:hover, .sawb-link:hover { text-decoration: underline; }
.sawb-links { display: flex; gap: 14px; flex-wrap: wrap; }
.sawb-files { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 8px; }
.sawb-files td { border-bottom: 1px solid var(--dsw-alias-border-l1); padding: 4px 6px; vertical-align: top; }
.sawb-files td:first-child { width: 64px; color: var(--dsw-alias-label-secondary); font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); }
.sawb-files td:last-child { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); overflow-wrap: anywhere; }
.sawb-stat { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 12px; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; margin: 0 0 8px; }
.sawb-diff-file { border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; margin-bottom: 10px; overflow: hidden; }
.sawb-diff-file > summary { cursor: pointer; padding: 6px 10px; background: var(--dsw-alias-bg-layer-2); font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 12px; display: flex; gap: 10px; }
.sawb-diff-file > summary .sawb-count { color: var(--dsw-alias-label-secondary); margin-left: auto; }
.sawb-diff-body { margin: 0; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 12px; line-height: 1.5; overflow: auto; max-height: 420px; }
.sawb-diff-body span { display: block; padding: 0 10px; white-space: pre; }
.sawb-diff-body .add { color: var(--dsw-alias-state-success-primary); }
.sawb-diff-body .del { color: var(--dsw-alias-state-error-primary); }
.sawb-diff-body .hunk { color: var(--dsw-alias-label-secondary); }
.sawb-diff-body .meta { color: var(--dsw-alias-state-idle-primary); }
.sawb-reports details { border-top: 1px solid var(--dsw-alias-border-l1); padding: 6px 0; }
.sawb-reports summary { cursor: pointer; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.sawb-live-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-brand-primary); margin-right: 6px; }
.sawb-foot { padding: 12px 18px 12px; flex: 0 0 auto; }
.sawb-crumbs { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; font-size: 12px; color: var(--dsw-alias-label-secondary); margin-bottom: 12px; }
.sawb-crumbs button { border: 0; background: transparent; color: var(--dsw-alias-brand-primary); font: inherit; padding: 1px 2px; cursor: pointer; }
.sawb-crumbs button:hover { text-decoration: underline; }
.sawb-doc-list { width: 100%; max-width: 1040px; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; overflow: hidden; margin: 0 auto 20px; background: var(--dsw-alias-bg-layer-1); }
.sawb-doc-group-title { display: flex; align-items: center; gap: 8px; padding: 12px 16px; background: var(--dsw-alias-bg-layer-2); font-weight: 600; font-size: 13px; }
.sawb-doc-item { display: flex; align-items: center; gap: 12px; width: 100%; border: 0; border-top: 1px solid var(--dsw-alias-border-l1); background: transparent; color: inherit; font: inherit; padding: 10px 16px; text-align: left; cursor: pointer; }
.sawb-doc-item:hover { background: var(--dsw-alias-bg-layer-2); }
.sawb-doc-item .sawb-doc-title { font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sawb-doc-item .sawb-doc-path { margin-left: auto; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 11px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 55%; }
.sawb-repo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 22px; width: 100%; max-width: 1360px; margin: 0 auto; }
.sawb-repo-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; min-width: 0; transition: border-color .15s ease, transform .15s ease; }
.sawb-repo-card:hover { border-color: var(--dsw-alias-brand-primary); transform: translateY(-1px); }
.sawb-repo-card h3 { margin: 0; font-size: 15px; }
.sawb-repo-card p { margin: 0; }
.sawb-repo-info { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; font-size: 12px; }
.sawb-repo-info dt { color: var(--dsw-alias-label-secondary); }
.sawb-repo-info dd { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sawb-repo-card .sawb-foot-line { margin-top: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sawb-tree { width: 100%; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; overflow: hidden; background: var(--dsw-alias-bg-layer-1); }
.sawb-tree-row { display: flex; align-items: center; gap: 12px; width: 100%; border: 0; border-top: 1px solid var(--dsw-alias-border-l1); background: transparent; color: inherit; font: inherit; padding: 9px 14px; text-align: left; cursor: pointer; }
.sawb-tree-row:first-child { border-top: 0; }
.sawb-tree-row:hover { background: var(--dsw-alias-bg-layer-2); }
.sawb-tree-icon { width: 18px; text-align: center; color: var(--dsw-alias-label-secondary); flex: 0 0 auto; }
.sawb-tree-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sawb-tree-row .sawb-meta { margin-left: auto; }
.sawb-code-wrap { width: 100%; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; }
.sawb-code { margin: 0; padding: 10px 0; overflow: auto; max-height: calc(100vh - 280px); font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 12px; line-height: 1.55; tab-size: 2; }
.sawb-code-line { display: flex; min-width: max-content; }
.sawb-code-line:hover { background: var(--dsw-alias-bg-layer-2); }
.sawb-line-no { flex: 0 0 54px; padding: 0 10px 0 8px; text-align: right; color: var(--dsw-alias-state-idle-primary); user-select: none; }
.sawb-line-text { white-space: pre; padding-right: 16px; }
.sawb-file-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.sawb-body > .sawb-file-head,
.sawb-body > .sawb-crumbs,
.sawb-body > .sawb-tree,
.sawb-body > .sawb-code-wrap,
.sawb-body > .sawb-panel { width: 100%; max-width: 1120px; box-sizing: border-box; margin-left: auto; margin-right: auto; }
.sawb-body > .sawb-section { width: 100%; max-width: 1080px; margin-left: auto; margin-right: auto; }
@media (max-width: 900px) {
  .sawb-head { padding-left: 14px; padding-right: 14px; }
  .sawb-body { padding: 16px 14px 36px; }
  .sawb-repo-grid { grid-template-columns: 1fr; gap: 16px; }
  .sawb-doc-item { align-items: flex-start; flex-direction: column; gap: 3px; }
  .sawb-doc-item .sawb-doc-path { margin-left: 0; max-width: 100%; }
}
.sawb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.sawb-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 12px 14px; background: var(--dsw-alias-bg-layer-1); }
.sawb-card h3 { margin: 0 0 6px; font-size: 13px; }
.sawb-kv { display: grid; grid-template-columns: max-content 1fr; gap: 3px 10px; margin: 8px 0 0; }
.sawb-kv dt { color: var(--dsw-alias-label-secondary); }
.sawb-kv dd { margin: 0; overflow-wrap: anywhere; }
.sawb-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.sawb-chip { border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; padding: 0 8px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.sawb-json { margin: 0; max-height: 340px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
.sawb-actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.sawb-check { font-size: 11px; margin-left: 4px; }
.sawb-check.bad { color: var(--dsw-alias-label-danger, #c0392b); }
.sawb-check.ok { color: var(--dsw-alias-label-success, #2e7d32); }
.sawb-textarea { width: 100%; box-sizing: border-box; margin-top: 8px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; resize: vertical; }
.sawb-session-list { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; }
.sawb-session { display: flex; align-items: center; gap: 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; padding: 5px 8px; min-width: 0; background: var(--dsw-alias-bg-base); }
.sawb-session-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.sawb-session-id { flex: 0 1 32%; margin-left: auto; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 11px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 32%; }
.sawb-session-more { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
.sawb-session-more .sawb-meta { margin-right: auto; }
.sawb-session-page { min-width: 24px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 1px 6px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11px; cursor: pointer; }
.sawb-session-page:hover { background: var(--dsw-alias-bg-layer-2); }
.sawb-session-page[aria-pressed="true"] { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); }
.sawb-pager { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; width: 100%; max-width: 1360px; margin: 16px auto 0; }
.sawb-pager .sawb-meta { margin-right: auto; }
.sawb-pager button:disabled { opacity: .45; cursor: default; }
.sawb-doc-repo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; width: 100%; max-width: 1080px; margin: 0 auto; }
.sawb-doc-repo { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 14px 16px; background: var(--dsw-alias-bg-layer-1); color: inherit; font: inherit; text-align: left; cursor: pointer; min-width: 0; }
.sawb-doc-repo:hover { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); }
.sawb-doc-repo strong { font-size: 13px; }
.sawb-doc-repo .sawb-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.sawb-card.sawb-ungrouped { border-style: dashed; }
.sawb-doc-tree { padding: 6px 0; }
.sawb-doc-folder { display: flex; align-items: center; gap: 6px; width: 100%; border: 0; background: transparent; color: inherit; font: inherit; padding: 5px 16px; cursor: pointer; text-align: left; }
.sawb-doc-folder:hover { background: var(--dsw-alias-bg-layer-2); }
.sawb-doc-folder .sawb-caret { width: 12px; color: var(--dsw-alias-label-secondary); flex: 0 0 auto; }
.sawb-doc-tree .sawb-doc-item { border-top: 0; padding-top: 5px; padding-bottom: 5px; }
.sawb-doc-tree .sawb-doc-item:hover { background: var(--dsw-alias-bg-layer-2); }
.sawb-doc-folder-name { font-weight: 600; font-size: 12px; }
.sawb-sa-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.sawb-sa-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 12px 14px; background: var(--dsw-alias-bg-layer-1); min-width: 0; }
.sawb-sa-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.sawb-sa-card-head h4 { margin: 0; font-size: 13px; }
.sawb-sa-card-head .sawb-spacer { flex: 1; }
.sawb-sa-preview { margin: 6px 0; color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
.sawb-sa-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; margin: 10px 0; }
.sawb-sa-stat { border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 7px 9px; background: var(--dsw-alias-bg-base); }
.sawb-sa-stat b { display: block; font-size: 16px; line-height: 1.25; }
.sawb-sa-stat span { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.sawb-sa-problem { border-left: 3px solid var(--dsw-alias-state-warn-primary); padding: 5px 10px; margin-bottom: 6px; background: var(--dsw-alias-bg-layer-1); border-radius: 4px; font-size: 12px; }
.sawb-sa-field { display: grid; grid-template-columns: minmax(120px, 34%) 1fr; gap: 4px 12px; align-items: start; padding: 6px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.sawb-sa-field:last-child { border-bottom: 0; }
.sawb-sa-field > label { font-size: 12px; color: var(--dsw-alias-label-secondary); padding-top: 4px; overflow-wrap: anywhere; }
.sawb-sa-field input[type="text"], .sawb-sa-field input[type="number"], .sawb-sa-field select, .sawb-sa-field textarea { width: 100%; box-sizing: border-box; padding: 4px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; }
.sawb-sa-field textarea { min-height: 64px; resize: vertical; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); }
.sawb-sa-field .sawb-hint { grid-column: 2; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.sawb-sa-savebar { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.sawb-switch { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; }
.sawb-switch input { width: 14px; height: 14px; accent-color: var(--dsw-alias-brand-primary); }
.sawb-tag { display: inline-block; padding: 0 7px; border-radius: 999px; font-size: 11px; line-height: 18px; border: 1px solid currentColor; }
.sawb-tag.ready, .sawb-tag.on { color: var(--dsw-alias-state-success-primary); }
.sawb-tag.starting, .sawb-tag.paused { color: var(--dsw-alias-state-warn-primary); }
.sawb-tag.error, .sawb-tag.missing { color: var(--dsw-alias-state-error-primary); }
.sawb-tag.off { color: var(--dsw-alias-label-secondary); }
.sawb-subtabs { display: inline-flex; gap: 2px; border-bottom: 1px solid var(--dsw-alias-border-l1); margin-bottom: 14px; }
.sawb-subtabs button { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; padding: 6px 12px; border-bottom: 2px solid transparent; cursor: pointer; }
.sawb-subtabs button[aria-pressed="true"] { color: var(--dsw-alias-label-primary); border-bottom-color: var(--dsw-alias-brand-primary); }
.sawb-sa-textarea { width: 100%; box-sizing: border-box; min-height: 110px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: 12px/1.55 var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); resize: vertical; }
`

    function StyleTag() {
      return h('style', { 'data-plugin': NS }, CSS)
    }

    // ---------------- 小工具 ----------------

    function when(value) {
      if (!value) return '—'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return String(value).replace('T', ' ').slice(0, 16)
      const pad = number => String(number).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    function urlNumber(url, kind) {
      const match = new RegExp(`/${kind}/(\\d+)`).exec(url || '')
      return match ? `#${match[1]}` : ''
    }

    function badge(text, tone) {
      return h('span', { className: `sawb-badge ${tone || ''}`.trim() }, text)
    }

    function toneOf(ticket) {
      if (ticket.live) return 'live'
      if (ticket.outcome === 'merged' || ticket.outcome === 'completed') return 'ok'
      return 'muted'
    }

    const LIST_PAGE_SIZE = 9

    /** 分页只保留当前区间，页码过多时显示首尾与当前附近，避免按钮铺满页面。 */
    function usePagedList(items, pageSize = LIST_PAGE_SIZE) {
      const [page, setPage] = React.useState(1)
      const source = items || []
      const pageCount = Math.max(1, Math.ceil(source.length / pageSize))
      React.useEffect(() => {
        if (page > pageCount) setPage(1)
      }, [page, pageCount])
      const safePage = Math.min(page, pageCount)
      return {
        page: safePage,
        setPage,
        pageCount,
        items: source.slice((safePage - 1) * pageSize, safePage * pageSize),
      }
    }

    function pageItems(page, pageCount) {
      if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1)
      const wanted = new Set([1, pageCount, page - 1, page, page + 1])
      if (page <= 3) [2, 3, 4].forEach(value => wanted.add(value))
      if (page >= pageCount - 2) [pageCount - 3, pageCount - 2, pageCount - 1].forEach(value => wanted.add(value))
      const sorted = [...wanted].filter(value => value >= 1 && value <= pageCount).sort((left, right) => left - right)
      const output = []
      sorted.forEach((value, index) => {
        if (index > 0 && value - sorted[index - 1] > 1) output.push('…')
        output.push(value)
      })
      return output
    }

    function Pagination({ page, pageSize = LIST_PAGE_SIZE, total, t, onChange }) {
      const pageCount = Math.max(1, Math.ceil(total / pageSize))
      if (pageCount <= 1) return null
      const from = (page - 1) * pageSize + 1
      const to = Math.min(page * pageSize, total)
      return h('div', { className: 'sawb-pager' },
        h('span', { className: 'sawb-meta' }, t('listRange', { from, to, total })),
        h('button', {
          type: 'button', className: 'sawb-btn sawb-btn-sm', disabled: page <= 1,
          onClick: () => onChange(Math.max(1, page - 1)),
        }, `‹ ${t('listPrev')}`),
        pageItems(page, pageCount).map((value, index) => value === '…'
          ? h('span', { key: `gap:${index}`, className: 'sawb-meta' }, '…')
          : h('button', {
              key: value, type: 'button', className: 'sawb-session-page',
              'aria-pressed': String(page === value),
              onClick: () => onChange(value),
            }, String(value))),
        h('button', {
          type: 'button', className: 'sawb-btn sawb-btn-sm', disabled: page >= pageCount,
          onClick: () => onChange(Math.min(pageCount, page + 1)),
        }, `${t('listNext')} ›`))
    }

    function external(href, text, key) {
      return h('a', { key, className: 'sawb-link', href, target: '_blank', rel: 'noopener noreferrer' }, text)
    }

    /** 行内片段：加粗、行内代码、链接，纯 React 元素，不用 innerHTML。 */
    function Inlines({ parts }) {
      return parts.map((part, index) => {
        if (part.kind === 'bold') return h('strong', { key: index }, part.text)
        if (part.kind === 'code') return h('code', { key: index }, part.text)
        if (part.kind === 'link') return h(React.Fragment, { key: index }, external(part.url, part.text))
        return h(React.Fragment, { key: index }, part.text)
      })
    }

    /** Markdown 块渲染：Host 已把文本切好，这里只做 React 元素映射。 */
    function Markdown({ blocks }) {
      if (!blocks || blocks.length === 0) return null
      return h('div', { className: 'sawb-md' }, blocks.map((block, index) => {
        if (block.kind === 'code') return h('pre', { key: index }, block.text)
        if (block.kind === 'list') {
          const items = block.items.map((item, at) => h('li', { key: at }, h(Inlines, { parts: item.parts })))
          return block.ordered ? h('ol', { key: index }, items) : h('ul', { key: index }, items)
        }
        if (block.kind === 'table') {
          return h('div', { key: index, className: 'sawb-table-wrap' },
            h('table', null,
              h('thead', null, h('tr', null, block.headers.map((cell, at) => h('th', { key: at }, h(Inlines, { parts: cell.parts }))))),
              h('tbody', null, block.rows.map((row, rowIndex) =>
                h('tr', { key: rowIndex }, row.map((cell, at) => h('td', { key: at }, h(Inlines, { parts: cell.parts }))))))))
        }
        if (block.kind === 'heading') return h('p', { key: index }, h('strong', null, h(Inlines, { parts: block.parts })))
        if (block.kind === 'quote') return h('blockquote', { key: index }, h(Inlines, { parts: block.parts }))
        return h('p', { key: index }, h(Inlines, { parts: block.parts }))
      }))
    }

    function diffLineClass(line) {
      if (line.startsWith('+++') || line.startsWith('---')) return 'meta'
      if (line.startsWith('@@')) return 'hunk'
      if (line.startsWith('+')) return 'add'
      if (line.startsWith('-')) return 'del'
      return ''
    }

    /** 按需加载一个接口：列表不带 ticket，详情带 ticket；两者不是同一份快照。 */
    function loadSnapshot(ticketId, signal) {
      const url = ticketId ? `${API}?ticket=${encodeURIComponent(ticketId)}` : API
      return fetch(url, { credentials: 'same-origin', signal, headers: { accept: 'application/json' } }).then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json()
        if (data && data.error && !data.tickets && !data.ticket) throw new Error(data.error)
        return data
      })
    }

    /** 文档 / 代码视图统一走同一个只读 API，不同 view 参数由 Host 调度。 */
    function loadApi(params, signal) {
      const search = new URLSearchParams()
      Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
      })
      return fetch(`${API}?${search.toString()}`, {
        credentials: 'same-origin', signal, headers: { accept: 'application/json' },
      }).then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json()
        if (data && data.error) throw new Error(data.error)
        return data
      })
    }

    function errorText(error) {
      return String(error && error.message ? error.message : error)
    }

    // ---------------- 视图 ----------------

    /** 所有页面都必须经过 Root：保证 style 永远存在，并给内容区稳定的高度/滚动容器。 */
    function Root({ children }) {
      return h('div', { className: 'sawb-root' }, h(StyleTag), children)
    }

    function Tabs({ section, t, onSection }) {
      const items = [
        ['workspaces', t('navWorkspaces')],
        ['repos', t('navRepos')],
        ['docs', t('navDocs')],
        ['tickets', t('navTickets')],
        ['sa', t('navSa')],
      ]
      return h('div', { className: 'sawb-tabs', role: 'tablist' },
        items.map(([key, label]) => h('button', {
          key,
          type: 'button',
          role: 'tab',
          'aria-pressed': String(section === key),
          onClick: () => onSection(key),
        }, label)))
    }

    function CodeBlock({ text }) {
      const lines = String(text || '').split('\n')
      return h('pre', { className: 'sawb-code' }, lines.map((line, index) =>
        h('span', { key: index, className: 'sawb-code-line' },
          h('span', { className: 'sawb-line-no', 'aria-hidden': true }, String(index + 1)),
          h('span', { className: 'sawb-line-text' }, line || ' '))))
    }

    function Breadcrumbs({ repo, path, t, onRoot, onPath }) {
      const parts = String(path || '').split('/').filter(Boolean)
      return h('div', { className: 'sawb-crumbs', 'aria-label': t('repoPath') },
        h('button', { type: 'button', onClick: onRoot }, repo.name),
        parts.map((part, index) => h(React.Fragment, { key: index },
          h('span', null, '/'),
          h('button', { type: 'button', onClick: () => onPath(parts.slice(0, index + 1).join('/')) }, part))))
    }

    function Notice({ children, tone }) {
      return h('div', { className: `sawb-notice${tone === 'error' ? ' sawb-error' : ''}`, role: 'status' }, children)
    }

    function TicketRow({ ticket, t, onOpen }) {
      const extra = [
        when(ticket.createdAt),
        ticket.branch,
        ticket.doc && ticket.doc.title ? `${t('doc')} · ${ticket.doc.title}` : '',
      ].filter(Boolean).join(' · ')
      return h('button', { type: 'button', className: 'sawb-row', onClick: () => onOpen(ticket.id) },
        h('span', { className: 'sawb-mono' }, ticket.shortId),
        h('span', { className: 'sawb-row-title', title: ticket.title }, ticket.title),
        h('span', { className: 'sawb-row-side' },
          ticket.prUrl ? h('span', { className: 'sawb-mono' }, `PR ${urlNumber(ticket.prUrl, 'pull')}`.trim()) : null,
          badge(ticket.label, toneOf(ticket))),
        h('span', { className: 'sawb-row-sub' },
          ticket.live ? h('span', { className: 'sawb-live-dot', 'aria-hidden': true }) : null,
          extra))
    }

    function ListView({ data, t, onOpen, section, onSection }) {
      const [showAll, setShowAll] = React.useState(false)
      const all = (data && data.tickets) || []
      const live = all.filter(ticket => ticket.live)
      // 默认先看进行中；没有进行中就直接给全部，免得用户对着空列表。
      const showLive = !showAll && live.length > 0
      const shown = showLive ? live : all
      const notices = []
      if (data && data.db && !data.db.ok) notices.push(h(Notice, { key: 'db', tone: 'error' }, t('dbMissing', { message: data.db.error })))
      if (data && data.repo && !data.repo.ok) notices.push(h(Notice, { key: 'repo' }, t('repoMissing', { dir: data.repo.dir })))
      const sync = data && data.repo && data.repo.sync
      return h(React.Fragment, null,
        h('div', { className: 'sawb-head' },
          h('h2', { className: 'sawb-title' }, t('tickets')),
          h('span', { className: 'sawb-meta' }, live.length > 0 ? `${t('countLive', { n: live.length })} · ${t('countAll', { n: all.length })}` : t('countAll', { n: all.length })),
          h('span', { className: 'sawb-spacer' }),
          sync && sync.at
            ? h('span', { className: 'sawb-meta', title: sync.message || '' },
                sync.ok === false ? t('syncFail', { message: sync.message }) : t('syncOk', { time: when(sync.at) }))
            : null,
          h(Tabs, { section, t, onSection }),
          h('button', {
            type: 'button',
            className: 'sawb-btn',
            'aria-pressed': String(showAll),
            onClick: () => setShowAll(value => !value),
          }, showAll ? t('filterLive') : t('filterAll')),
        ),
        h('div', { className: 'sawb-body' },
          notices,
          shown.length === 0
            ? h('div', { className: 'sawb-empty' }, all.length === 0 ? t('emptyTickets') : t('emptyLive'))
            : h('div', null, shown.map(ticket => h(TicketRow, { key: ticket.id, ticket, t, onOpen })))),
      )
    }

    function Facts({ ticket, t }) {
      // 链接带自己的 key：作为 span 的子节点直接渲染，避免 React 列表 key 警告。
      const issue = ticket.issueUrl ? [external(ticket.issueUrl, `${t('issue')} ${urlNumber(ticket.issueUrl, 'issues')}`.trim(), 'issue')] : []
      const pr = ticket.prUrl ? [external(ticket.prUrl, `${t('pullRequest')} ${urlNumber(ticket.prUrl, 'pull')}`.trim(), 'pr')] : []
      const rows = [
        [t('source'), issue.length || pr.length ? h('span', { className: 'sawb-links' }, issue, pr) : '—'],
        [t('createdAt'), when(ticket.createdAt)],
        [t('updatedAt'), when(ticket.updatedAt)],
        [t('branch'), h('span', { className: 'sawb-mono' }, ticket.branch || '—')],
        [t('execDir'), h('span', { className: 'sawb-mono', title: ticket.execDir }, `${ticket.execDir || '—'} · ${ticket.execExists ? t('execExists') : t('execCleaned')}`)],
        [t('outcome'), ticket.endedAt ? `${ticket.label} · ${when(ticket.endedAt)}` : ticket.label],
        [t('fullId'), h('span', { className: 'sawb-mono' }, ticket.id)],
      ]
      return h('dl', { className: 'sawb-facts' }, rows.map(([label, value], index) =>
        h('div', { key: index }, h('dt', null, label), h('dd', null, value))))
    }

    function DiffSection({ ticket, t }) {
      const diff = ticket.diff
      const title = t('diff')
      if (!diff || !diff.exists) {
        return h('section', { className: 'sawb-section' }, h('h3', null, title), h('div', { className: 'sawb-panel sawb-meta' }, t('noDiff')))
      }
      const files = diff.files || []
      const patch = diff.patch || []
      return h('section', { className: 'sawb-section' },
        h('h3', null, title, badge(`${t('diffFiles', { n: files.length })} · ${diff.ref || ''}`.trim(), 'muted')),
        files.length > 0
          ? h('table', { className: 'sawb-files' }, h('tbody', null, files.map((file, index) =>
              h('tr', { key: index }, h('td', null, file.status), h('td', null, file.path)))))
          : null,
        diff.stat ? h('pre', { className: 'sawb-stat' }, diff.stat) : null,
        patch.map((file, index) => h('details', { key: index, className: 'sawb-diff-file' },
          h('summary', null,
            h('span', null, file.path),
            h('span', { className: 'sawb-count' }, `+${file.added} −${file.removed}`)),
          h('pre', { className: 'sawb-diff-body' }, file.lines.map((line, at) =>
            h('span', { key: at, className: diffLineClass(line) }, line || ' '))))),
        diff.patchBytes >= 400_000 ? h('div', { className: 'sawb-meta' }, t('diffTruncated')) : null,
      )
    }

    function Reports({ ticket, t }) {
      const reports = Array.isArray(ticket.reports) ? ticket.reports : []
      if (reports.length === 0) {
        return h('section', { className: 'sawb-section' }, h('h3', null, t('latestReport')), h('div', { className: 'sawb-panel sawb-meta' }, t('noReport')))
      }
      const [latest, ...others] = reports
      return h('section', { className: 'sawb-section' },
        h('h3', null, t('latestReport'), badge(when(latest.at), 'muted')),
        h('div', { className: 'sawb-panel sawb-reports' },
          h(Markdown, { blocks: latest.blocks }),
          others.length > 0
            ? h('details', null,
                h('summary', null, t('reports', { n: reports.length })),
                others.map(report => h('div', { key: report.index, style: { marginTop: 8 } },
                  h('div', { className: 'sawb-meta' }, `${t('reportRound', { n: report.index })} · ${when(report.at)}`),
                  h(Markdown, { blocks: report.blocks }))))
            : null),
      )
    }

    function DetailView({ ticket, t, onBack }) {
      return h(React.Fragment, null,
        h('div', { className: 'sawb-head' },
          h('button', { type: 'button', className: 'sawb-btn', onClick: onBack }, `← ${t('back')}`),
          h('span', { className: 'sawb-spacer' }),
          h('span', { className: 'sawb-links' },
            ticket.prUrl ? external(ticket.prUrl, t('pullRequest')) : null,
            ticket.issueUrl ? external(ticket.issueUrl, t('issue')) : null)),
        h('div', { className: 'sawb-body' },
          h('div', { className: 'sawb-detail-head' },
            h('div', { className: 'sawb-meta' }, h('span', { className: 'sawb-mono' }, ticket.shortId), ' · ', badge(ticket.label, toneOf(ticket))),
            h('h2', { className: 'sawb-detail-title' }, ticket.title),
            ticket.attention ? h(Notice, null, `${t('attention')}：${ticket.attention}`) : null),
          h(TicketActions, { ticket, t }),
          h(Facts, { ticket, t }),
          h(Reports, { ticket, t }),
          h(DiffSection, { ticket, t }),
          ticket.doc
            ? h('section', { className: 'sawb-section' },
                h('h3', null, t('doc'), badge(ticket.doc.path, 'muted')),
                h('div', { className: 'sawb-panel' }, h(Markdown, { blocks: ticket.doc.blocks })))
            : h('section', { className: 'sawb-section' },
                h('h3', null, t('doc')),
                h('div', { className: 'sawb-panel sawb-meta' }, t('noDoc', { prefix: ticket.shortId }))),
        ))
    }

    /** 会话列表：显示标题，id 作为尾注；无标题时按类型给出可读占位。 */
    function sessionName(session, t) {
      if (session.title) return session.title
      if (session.kind === 'orchestrator') return `${t('sessionOrchestrator')} · ${session.id.slice(0, 12)}`
      if (session.kind === 'worker') return `${t('sessionWorker')} · ${session.id.slice(0, 12)}`
      return t('sessionUntitled')
    }

    const SESSION_PAGE_SIZE = 10

    /** 工作区会话默认折叠为最近 10 个；可翻页，也可一键展开全部。 */
    function SessionList({ sessions, t, collapsible = false }) {
      const [expanded, setExpanded] = React.useState(false)
      const [page, setPage] = React.useState(1)
      const source = sessions || []
      const ordered = React.useMemo(() => collapsible
        ? [...source].sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
        : source, [source, collapsible])
      const total = ordered.length
      const pageCount = Math.max(1, Math.ceil(total / SESSION_PAGE_SIZE))
      React.useEffect(() => {
        if (page > pageCount) setPage(1)
      }, [page, pageCount])
      if (total === 0) return h('div', { className: 'sawb-meta', style: { marginTop: 8 } }, t('noSessions'))
      const start = expanded ? 0 : (page - 1) * SESSION_PAGE_SIZE
      const visible = expanded ? ordered : ordered.slice(start, start + SESSION_PAGE_SIZE)
      return h(React.Fragment, null,
        h('div', { className: 'sawb-session-list' }, visible.map(session => {
          const name = sessionName(session, t)
          return h('div', { key: session.id, className: 'sawb-session', title: [name, session.id, session.cwd || ''].filter(Boolean).join('\n') },
            session.archived ? badge(t('sessionArchived'), 'muted') : null,
            session.pinned ? badge(t('sessionPinned'), 'muted') : null,
            h('span', { className: 'sawb-session-name', title: name }, name),
            h('span', { className: 'sawb-session-id' }, session.id))
        })),
        collapsible && total > SESSION_PAGE_SIZE
          ? h('div', { className: 'sawb-session-more' },
              h('span', { className: 'sawb-meta' }, expanded
                ? t('workspaceSessionCount', { n: total })
                : t('sessionRange', { from: start + 1, to: start + visible.length, total })),
              h('button', {
                type: 'button', className: 'sawb-btn sawb-btn-sm',
                onClick: () => { setExpanded(value => !value); setPage(1) },
              }, expanded ? t('sessionCollapse') : t('sessionShowAll')),
              expanded ? null : pageItems(page, pageCount).map((value, index) => value === '…'
                ? h('span', { key: `session-gap:${index}`, className: 'sawb-meta' }, '…')
                : h('button', {
                    key: value, type: 'button', className: 'sawb-session-page',
                    'aria-pressed': String(page === value),
                    onClick: () => setPage(value),
                  }, String(value))))
          : null)
    }

    /** 把 flat docs 构造成目录树；只在前端派生，不改变 Host 返回结构。 */
    function buildDocTree(docs) {
      const root = { dirs: new Map(), files: [] }
      for (const item of docs) {
        const parts = String(item.path || '').split('/').filter(Boolean)
        let node = root
        parts.slice(0, -1).forEach(part => {
          if (!node.dirs.has(part)) node.dirs.set(part, { name: part, dirs: new Map(), files: [] })
          node = node.dirs.get(part)
        })
        const name = parts[parts.length - 1] || item.path
        node.files.push({ ...item, name })
      }
      return root
    }

    function DocFolder({ name, node, depth, repo, t, onOpen }) {
      const [open, setOpen] = React.useState(false)
      return h(React.Fragment, null,
        h('button', { type: 'button', className: 'sawb-doc-folder', style: { paddingLeft: 16 + depth * 18 }, onClick: () => setOpen(value => !value) },
          h('span', { className: 'sawb-caret' }, open ? '▾' : '▸'),
          h('span', { className: 'sawb-doc-folder-name' }, name),
          badge(String(node.dirs.size + node.files.length), 'muted')),
        open ? h(DocTree, { node, depth: depth + 1, repo, t, onOpen }) : null)
    }

    function DocTree({ node, depth, repo, t, onOpen }) {
      const dirs = [...node.dirs.values()].sort((left, right) => left.name.localeCompare(right.name))
      const files = [...node.files].sort((left, right) => left.path.localeCompare(right.path))
      return h('div', { className: 'sawb-doc-tree' },
        dirs.map(dir => h(DocFolder, { key: `dir:${dir.name}`, name: dir.name, node: dir, depth, repo, t, onOpen })),
        files.map(item => h('button', {
          key: item.path, type: 'button', className: 'sawb-doc-item', style: { paddingLeft: 16 + depth * 18 }, title: item.path,
          onClick: () => onOpen(repo, item.path),
        },
          h('span', { className: 'sawb-doc-title' }, item.title || item.name),
          h('span', { className: 'sawb-doc-path' }, item.path))))
    }

    /** 文档中心：先选仓库，再按目录层级按需读取该仓库的 Markdown 索引。 */
    function DocsView({ t, section, onSection }) {
      const [route, setRoute] = React.useState({ kind: 'repos', repo: undefined })
      const [state, setState] = React.useState({ phase: 'loading', repos: [], groups: [], error: '' })
      const [doc, setDoc] = React.useState({ phase: 'idle', repo: undefined, data: undefined, error: '' })
      const repoPaged = usePagedList(state.repos, 12)

      React.useEffect(() => {
        const controller = new AbortController()
        setState(previous => ({ phase: 'loading', repos: previous.repos, groups: previous.groups, error: '' }))
        const params = route.kind === 'repos' ? { view: 'docRepos' } : { view: 'docs', repo: route.repo.id }
        loadApi(params, controller.signal)
          .then(data => setState({ phase: 'ready', repos: data.repos || [], groups: data.groups || [], error: '' }))
          .catch(error => {
            if (error && error.name === 'AbortError') return
            setState({ phase: 'error', repos: [], groups: [], error: errorText(error) })
          })
        return () => controller.abort()
      }, [route])

      const openDoc = (repo, path) => {
        setDoc({ phase: 'loading', repo, data: undefined, error: '' })
        const controller = new AbortController()
        loadApi({ view: 'blob', repo: repo.id, path }, controller.signal)
          .then(data => setDoc({ phase: 'ready', repo, data, error: '' }))
          .catch(error => setDoc({ phase: 'error', repo, data: undefined, error: errorText(error) }))
      }

      if (doc.phase !== 'idle') {
        return h(React.Fragment, null,
          h('div', { className: 'sawb-head' },
            h('button', { type: 'button', className: 'sawb-btn', onClick: () => setDoc({ phase: 'idle', repo: undefined, data: undefined, error: '' }) }, `← ${t('backToDocs')}`),
            h('span', { className: 'sawb-spacer' }),
            h('span', { className: 'sawb-meta' }, doc.repo ? doc.repo.name : '')),
          h('div', { className: 'sawb-body' },
            doc.phase === 'error'
              ? h(Notice, { tone: 'error' }, t('readFailed', { message: doc.error }))
              : doc.phase === 'loading' || !doc.data
                ? h('div', { className: 'sawb-empty' }, t('loadingData'))
                : h(React.Fragment, null,
                    h('div', { className: 'sawb-file-head' },
                      h('h2', { className: 'sawb-detail-title' }, doc.data.path.split('/').pop()),
                      badge(doc.data.path, 'muted')),
                    doc.data.tooLarge
                      ? h(Notice, null, t('fileTooLarge'))
                      : h('div', { className: 'sawb-panel' }, h(Markdown, { blocks: doc.data.blocks })))))
      }

      if (route.kind === 'repos') {
        return h(React.Fragment, null,
          h('div', { className: 'sawb-head' },
            h('h2', { className: 'sawb-title' }, t('docsTitle')),
            h('span', { className: 'sawb-meta' }, t('docsRepoHint')),
            h('span', { className: 'sawb-spacer' }),
            h('span', { className: 'sawb-meta' }, t('docsRepoCount', { n: state.repos.length })),
            h(Tabs, { section, t, onSection })),
          h('div', { className: 'sawb-body' },
            state.phase === 'error'
              ? h(Notice, { tone: 'error' }, t('readFailed', { message: state.error }))
              : state.phase === 'loading' && state.repos.length === 0
                ? h('div', { className: 'sawb-empty' }, t('loadingData'))
                : state.repos.length === 0
                  ? h('div', { className: 'sawb-empty' }, t('noRepos'))
                  : h(React.Fragment, null,
                      h('div', { className: 'sawb-doc-repo-grid' }, repoPaged.items.map(repo => h('button', {
                        key: repo.id, type: 'button', className: 'sawb-doc-repo',
                        onClick: () => { setDoc({ phase: 'idle', repo: undefined, data: undefined, error: '' }); setRoute({ kind: 'repo', repo }) },
                      },
                        h('strong', null, repo.name),
                        repo.description ? h('span', { className: 'sawb-meta' }, repo.description) : null,
                        h('span', { className: 'sawb-meta sawb-mono' }, repo.id)))),
                      h(Pagination, { page: repoPaged.page, pageSize: 12, total: state.repos.length, t, onChange: repoPaged.setPage }))))
      }

      const group = state.groups[0]
      const total = group ? group.docs.length : 0
      return h(React.Fragment, null,
        h('div', { className: 'sawb-head' },
          h('button', { type: 'button', className: 'sawb-btn', onClick: () => setRoute({ kind: 'repos', repo: undefined }) }, `← ${t('backToDocsRepos')}`),
          h('h2', { className: 'sawb-title' }, route.repo.name),
          h('span', { className: 'sawb-meta' }, t('docsTreeHint')),
          h('span', { className: 'sawb-spacer' }),
          h('span', { className: 'sawb-meta' }, t('docsCount', { n: total })),
          h(Tabs, { section, t, onSection })),
        h('div', { className: 'sawb-body' },
          state.phase === 'error'
            ? h(Notice, { tone: 'error' }, t('readFailed', { message: state.error }))
            : state.phase === 'loading'
              ? h('div', { className: 'sawb-empty' }, t('loadingData'))
              : total === 0
                ? h('div', { className: 'sawb-empty' }, t('noDocs'))
                : h('div', { className: 'sawb-doc-list' },
                    h('div', { className: 'sawb-doc-group-title' },
                      h('span', null, route.repo.name),
                      badge(t('docsCount', { n: total }), 'muted')),
                    h(DocTree, { node: buildDocTree(group.docs), depth: 0, repo: group.repo, t, onOpen: openDoc }))))
    }

    /** 读取 SA 管理接口；只走 Host 同源代理，不在浏览器直连 3080 之外的端口。 */
    function saRequest(method, path, body) {
      const params = new URLSearchParams({ path })
      return fetch(`${API}/sa?${params.toString()}`, {
        method,
        credentials: 'same-origin',
        headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }).then(async response => {
        let data
        try { data = await response.json() } catch { data = undefined }
        if (!response.ok) throw new Error((data && data.error) || `HTTP ${response.status}`)
        return data
      })
    }

    /** 工作区页：DSH Host 是 workspace.json 的唯一写者，这里只读展示全部工作区与未分组。 */
    function WorkspacesView({ t, section, onSection }) {
      const [state, setState] = React.useState({ phase: 'loading', data: undefined, error: '' })
      const load = React.useCallback(signal => {
        setState(previous => ({ phase: 'loading', data: previous.data, error: '' }))
        loadApi({ view: 'workspaces' }, signal)
          .then(data => setState({ phase: 'ready', data, error: '' }))
          .catch(error => {
            if (error && error.name === 'AbortError') return
            setState({ phase: 'error', data: undefined, error: errorText(error) })
          })
      }, [])
      React.useEffect(() => {
        const controller = new AbortController()
        load(controller.signal)
        return () => controller.abort()
      }, [load])
      const workspaces = (state.data && state.data.workspaces) || []
      const ungrouped = (state.data && state.data.ungrouped && state.data.ungrouped.sessions) || []
      const totalSessions = workspaces.reduce((sum, workspace) => sum + workspace.sessions.length, 0) + ungrouped.length
      const paged = usePagedList(workspaces, 8)
      return h(React.Fragment, null,
        h('div', { className: 'sawb-head' },
          h('h2', { className: 'sawb-title' }, t('workspacesTitle')),
          h('span', { className: 'sawb-meta' }, t('workspacesHint')),
          h('span', { className: 'sawb-spacer' }),
          h('span', { className: 'sawb-meta' }, `${t('workspaceCount', { n: workspaces.length })} · ${t('workspaceSessionCount', { n: totalSessions })}`),
          h(Tabs, { section, t, onSection }),
          h('button', { type: 'button', className: 'sawb-btn', onClick: () => load() }, t('refresh'))),
        h('div', { className: 'sawb-body' },
          state.phase === 'error'
            ? h(Notice, { tone: 'error' }, t('readFailed', { message: state.error }))
            : !state.data
              ? h('div', { className: 'sawb-empty' }, t('loadingData'))
              : h(React.Fragment, null,
                  state.data.sessionError ? h(Notice, null, state.data.sessionError) : null,
                  h('div', { className: 'sawb-grid' },
                    paged.items.map(workspace => h('article', { key: workspace.id, className: 'sawb-card' },
                      h('h3', null, workspace.title || workspace.id),
                      h('dl', { className: 'sawb-kv' },
                        h('dt', null, t('workspacePath')), h('dd', { className: 'sawb-mono', title: workspace.path }, workspace.path),
                        h('dt', null, t('workspaceCreated')), h('dd', null, when(workspace.createdAt))),
                      workspace.exists === false ? h(Notice, { tone: 'error' }, t('workspaceMissing')) : null,
                      h('div', { className: 'sawb-chips' },
                        h('span', { className: 'sawb-chip' }, t('workspaceSessionCount', { n: workspace.sessions.length })),
                        workspace.git ? h('span', { className: 'sawb-chip' }, t('repoGit')) : null),
                      h(SessionList, { sessions: workspace.sessions, t, collapsible: true }))),
                    h('article', { key: '__ungrouped', className: 'sawb-card sawb-ungrouped' },
                      h('h3', null, t('ungroupedTitle')),
                      h('p', { className: 'sawb-meta' }, t('ungroupedHint')),
                      h('div', { className: 'sawb-chips' }, h('span', { className: 'sawb-chip' }, t('ungroupedCount', { n: ungrouped.length }))),
                      h(SessionList, { sessions: ungrouped, t, collapsible: true }))),
                  h(Pagination, {
                    page: paged.page, pageSize: 8, total: workspaces.length, t,
                    onChange: paged.setPage,
                  }))))
    }

    /** JSON 编辑器：用于 settings 块与 prompts，保存必须带 revision 防止覆盖并发修改。 */
    function JsonEditor({ title, value, revision, t, onSave }) {
      const [text, setText] = React.useState(JSON.stringify(value, null, 2))
      const [notice, setNotice] = React.useState('')
      React.useEffect(() => { setText(JSON.stringify(value, null, 2)) }, [value, revision])
      const save = () => {
        try {
          const parsed = JSON.parse(text)
          setNotice('')
          Promise.resolve(onSave(parsed, revision)).then(() => setNotice(t('saSaved'))).catch(error => setNotice(errorText(error)))
        } catch (error) {
          setNotice(errorText(error))
        }
      }
      return h('details', { className: 'sawb-section' },
        h('summary', null, title, badge(`r${revision}`, 'muted')),
        h('textarea', {
          className: 'sawb-textarea', value: text, spellCheck: false, rows: Math.min(18, text.split('\n').length + 1),
          onChange: event => setText(event.target.value),
        }),
        h('div', { className: 'sawb-actions' },
          h('button', { type: 'button', className: 'sawb-btn', onClick: save }, t('saSave')),
          notice ? h('span', { className: 'sawb-meta' }, notice) : null))
    }

    /** 保留清理：只显示安全判定结果；执行动作由 Host 调用 git / workspaceRegistry。 */
    function RetentionSection({ t }) {
      const [state, setState] = React.useState({ phase: 'loading', data: undefined, error: '', notice: '' })
      const load = React.useCallback(signal => {
        loadApi({ view: 'retention' }, signal)
          .then(data => setState(previous => ({ phase: 'ready', data, error: '', notice: previous.notice })))
          .catch(error => {
            if (error && error.name === 'AbortError') return
            setState({ phase: 'error', data: undefined, error: errorText(error), notice: '' })
          })
      }, [])
      React.useEffect(() => {
        const controller = new AbortController()
        load(controller.signal)
        return () => controller.abort()
      }, [load])
      const act = body => {
        setState(previous => ({ ...previous, notice: '' }))
        fetch(API, {
          method: 'POST', credentials: 'same-origin',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }).then(async response => {
          const data = await response.json()
          if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
          return data
        }).then(data => {
          if (data && data.candidates) setState({ phase: 'ready', data, error: '', notice: '' })
          else setState(previous => ({ ...previous, notice: data.lastResult ? t('retentionRunDone', { n: data.lastResult.scanned || 0, m: data.lastResult.cleaned || 0 }) : '' }))
          load()
        }).catch(error => setState(previous => ({ ...previous, notice: errorText(error) })))
      }
      const data = state.data
      if (!data) return h('section', { className: 'sawb-section' }, h('h3', null, t('retentionTitle')),
        state.phase === 'error' ? h(Notice, { tone: 'error' }, t('readFailed', { message: state.error })) : h('div', { className: 'sawb-meta' }, t('loadingData')))
      const candidates = data.eligible || []
      const ledger = data.ledger || []
      return h('section', { className: 'sawb-section' },
        h('h3', null, t('retentionTitle'), badge(`${data.settings.days} 天`, 'muted')),
        h('p', { className: 'sawb-meta' }, t('retentionHint', { days: data.settings.days })),
        h('div', { className: 'sawb-actions' },
          h('button', { type: 'button', className: 'sawb-btn', onClick: () => act({ action: 'dry-run' }) }, t('retentionDryRun')),
          h('button', { type: 'button', className: 'sawb-btn', onClick: () => act({ action: 'cleanup' }) }, t('retentionCleanup')),
          h('label', { className: 'sawb-meta' },
            h('input', { type: 'checkbox', checked: Boolean(data.settings.autoCleanup), onChange: event => act({ action: 'settings', autoCleanup: event.target.checked }) }), ' ', t('retentionAuto'))),
        state.notice ? h(Notice, null, state.notice) : null,
        h('h4', null, t('retentionEligible')),
        candidates.length === 0
          ? h('div', { className: 'sawb-meta' }, t('retentionNoCandidates'))
          : h('div', { className: 'sawb-grid' }, candidates.map(candidate => h('article', { key: candidate.ticketId, className: 'sawb-card' },
              h('h3', null, candidate.ticketId),
              h('div', { className: 'sawb-meta' }, candidate.path),
              h('div', { className: 'sawb-chips' }, Object.entries(candidate.checks || {}).map(([key, value]) => h('span', {
                key, className: `sawb-chip sawb-check ${value ? 'ok' : 'bad'}`,
              }, `${key}: ${value ? '✓' : '✗'}`)))))),
        h('h4', null, t('retentionLedger')),
        ledger.length === 0
          ? h('div', { className: 'sawb-meta' }, t('retentionNoLedger'))
          : h('div', null, ledger.slice(0, 20).map((entry, index) => h('div', { key: index, className: 'sawb-meta sawb-mono' },
              `${when(entry.at)} · ${entry.ticket || ''} · ${entry.action || ''} · ${entry.dir || ''}`))))
    }

    function localized(value, fallback) {
      if (value === undefined || value === null) return fallback || ''
      if (typeof value === 'string') return value
      return value.zh || value.en || fallback || ''
    }

    function cloneJson(value) {
      try { return JSON.parse(JSON.stringify(value)) } catch { return value }
    }

    function SaTag({ state, t }) {
      const labels = { ready: t('saReady'), on: t('saSourceEnabled'), off: t('saSourceDisabled'), starting: t('saStarting'), paused: t('saPaused'), error: t('saError'), missing: t('saMissing'), setup: t('saSetup') }
      return h('span', { className: `sawb-tag ${state || ''}` }, labels[state] || state || '—')
    }

    function SaProblem({ problem, t }) {
      const kind = problem.kind || ''
      const text = {
        setup: t('saProblemSetup'), 'no-source': t('saProblemNoSource'), 'no-allowed': t('saProblemNoAllowed'),
        'source-error': t('saProblemSourceError'), 'executor-paused': t('saProblemPaused'), 'runtime-error': t('saProblemRuntime'),
        'eval-overdue': t('saProblemEvalOverdue'), 'eval-unavailable': t('saProblemEvalUnavailable'), outgoing: t('saProblemOutgoing'),
      }[kind] || kind
      const detail = localized(problem.detail || problem.message || problem.source && problem.source.health && problem.source.health.detail || problem.name || '')
      return h('div', { className: 'sawb-sa-problem' },
        h('strong', null, text || kind),
        detail ? h('div', { className: 'sawb-meta' }, detail) : null)
    }

    function SaStat({ label, value }) {
      return h('div', { className: 'sawb-sa-stat' }, h('b', null, value === undefined || value === null || value === '' ? '—' : value), h('span', null, label))
    }

    function SaHealthList({ health, t }) {
      const items = health && !Array.isArray(health)
        ? Object.entries(health).map(([name, item]) => ({ name, ...(item || {}) }))
        : (health || [])
      if (items.length === 0) return h('div', { className: 'sawb-meta' }, t('saNoHealth'))
      return h('div', { className: 'sawb-session-list' }, items.map((item, index) => h('div', { key: `${item.name || index}`, className: 'sawb-session' },
        SaTag({ state: item.state === 'ready' ? 'ready' : item.state, t }),
        h('span', { className: 'sawb-session-name' }, item.name || ''),
        h('span', { className: 'sawb-session-id' }, item.detail || item.at || ''))))
    }

    function SaRowsEditor({ field, value, t, onChange }) {
      const rows = Array.isArray(value) ? value : []
      const columns = field.columns || []
      const update = (index, key, cell) => {
        const next = rows.map(row => ({ ...row }))
        next[index] = { ...next[index], [key]: cell }
        onChange(next)
      }
      return h('div', null,
        rows.map((row, index) => h('div', { key: index, className: 'sawb-session', style: { alignItems: 'flex-start', flexWrap: 'wrap' } },
          columns.map(column => h('label', { key: column.key, className: 'sawb-meta', style: { flex: '1 1 140px', minWidth: 0 } },
            h('span', null, localized(column.label, column.key)),
            column.type === 'select'
              ? h('select', { value: String(row[column.key] || ''), onChange: event => update(index, column.key, event.target.value) },
                  (column.options || []).map(option => h('option', { key: option.value, value: option.value }, localized(option.label, option.value))))
              : h('input', { type: 'text', value: String(row[column.key] === undefined ? '' : row[column.key]), onChange: event => update(index, column.key, event.target.value) }))),
          h('button', { type: 'button', className: 'sawb-btn sawb-btn-sm', onClick: () => onChange(rows.filter((_, at) => at !== index)) }, t('saRemoveRow')))),
        h('div', { className: 'sawb-actions' },
          h('button', { type: 'button', className: 'sawb-btn sawb-btn-sm', onClick: () => {
            const row = {}
            for (const column of columns) row[column.key] = column.type === 'select' ? (column.options && column.options[0] ? column.options[0].value : '') : ''
            onChange([...rows, row])
          } }, t('saAddRow'))))
    }

    /** 是否有关联字段支持从来源刷新选项（例如飞书群/成员名单）。 */
    function hasRefreshFields(fields) {
      return (fields || []).some(field => (field.columns || []).some(column => Boolean(column.refresh)))
    }

    function SaJsonField({ value, onChange }) {
      const [text, setText] = React.useState(JSON.stringify(value === undefined ? null : value, null, 2))
      const [bad, setBad] = React.useState(false)
      React.useEffect(() => { setText(JSON.stringify(value === undefined ? null : value, null, 2)); setBad(false) }, [value])
      return h('div', null,
        h('textarea', { className: 'sawb-sa-textarea', value: text, spellCheck: false, onChange: event => {
          setText(event.target.value)
          try { onChange(JSON.parse(event.target.value)); setBad(false) } catch { setBad(true) }
        } }),
        bad ? h('div', { className: 'sawb-meta' }, t('saInvalidJson')) : null)
    }

    function inferFields(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return []
      return Object.keys(value).map(key => ({
        key,
        label: { zh: key, en: key },
        type: key === 'mode' ? 'select'
          : key === 'blockedCommands' ? 'json'
          : typeof value[key] === 'boolean' ? 'switch'
          : typeof value[key] === 'number' ? 'number'
          : typeof value[key] === 'string' ? 'text' : 'json',
        ...key === 'mode' ? { options: [
          { value: 'off', label: { zh: '关闭', en: 'Off' } },
          { value: 'observe', label: { zh: '观察', en: 'Observe' } },
          { value: 'auto', label: { zh: '自动', en: 'Auto' } },
        ] } : {},
      }))
    }

    function SaFieldEditor({ field, value, facts, t, onChange }) {
      const label = localized(field.label, field.key)
      let control
      if (field.type === 'switch') {
        control = h('label', { className: 'sawb-switch' },
          h('input', { type: 'checkbox', checked: Boolean(value), onChange: event => onChange(event.target.checked) }), t('saEnabled'))
      } else if (field.type === 'select') {
        control = h('select', { value: String(value === undefined ? '' : value), onChange: event => onChange(event.target.value) },
          (field.options || []).map(option => h('option', { key: option.value, value: option.value }, localized(option.label, option.value))))
      } else if (field.type === 'number') {
        control = h('input', { type: 'number', min: field.min, max: field.max, value: Number(value || 0), onChange: event => onChange(Number(event.target.value)) })
      } else if (field.type === 'fact') {
        control = h('span', { className: 'sawb-mono' }, localized(facts && facts[field.key], '—'))
      } else if (field.type === 'json') {
        control = h(SaJsonField, { value, onChange })
      } else if (field.type === 'rows') {
        control = h(SaRowsEditor, { field, value, t, onChange })
      } else {
        control = h('input', { type: 'text', value: String(value === undefined ? '' : value), pattern: field.pattern, onChange: event => onChange(event.target.value) })
      }
      return h('div', { className: 'sawb-sa-field' },
        h('label', null, label, field.advanced ? h('span', { className: 'sawb-meta' }, ` · ${t('saFieldOptional')}`) : null),
        control,
        field.hint ? h('span', { className: 'sawb-hint' }, localized(field.hint)) : null)
    }

    /** 设置块表单：动态渲染 SA 的 FieldSpec；保存必须带 revision。 */
    function SaSettingsForm({ title, value, revision, fields, facts, restarts, problem, source, t, onSave }) {
      const [draft, setDraft] = React.useState(() => cloneJson(value))
      const [advanced, setAdvanced] = React.useState(false)
      const [notice, setNotice] = React.useState('')
      React.useEffect(() => { setDraft(cloneJson(value)); setNotice('') }, [value, revision])
      const hasAdvanced = (fields || []).some(field => field.advanced)
      const setField = (key, nextValue) => setDraft(previous => {
        const next = cloneJson(previous) || {}
        if (source) {
          next.config = next.config || {}
          next.config[key] = nextValue
        } else {
          next[key] = nextValue
        }
        return next
      })
      const save = () => {
        setNotice(t('saSaving'))
        Promise.resolve(onSave(cloneJson(draft), revision))
          .then(() => setNotice(t('saSaved')))
          .catch(error => setNotice(errorText(error)))
      }
      const rows = (fields || []).filter(field => advanced || !field.advanced)
      return h('section', { className: 'sawb-section' },
        h('div', { className: 'sawb-sa-card' },
          h('div', { className: 'sawb-sa-card-head' },
            h('h4', null, title),
            badge(t('saRevision', { n: revision }), 'muted'),
            problem ? SaTag({ state: 'error', t }) : null,
            h('span', { className: 'sawb-spacer' }),
            source ? h('label', { className: 'sawb-switch' },
              h('input', { type: 'checkbox', checked: Boolean(draft && draft.enabled), onChange: event => setDraft(previous => ({ ...previous, enabled: event.target.checked })) }),
              t('saEnabled')) : null),
          problem ? h(Notice, { tone: 'error' }, localized(problem, String(problem))) : null,
          rows.length === 0
            ? h('div', null,
                h('div', { className: 'sawb-meta' }, t('saNoFields')),
                h(SaJsonField, { value: draft, onChange: next => setDraft(next) }))
            : rows.map(field => h(SaFieldEditor, {
                key: field.key, field, facts,
                value: source ? draft && draft.config && draft.config[field.key] : draft && draft[field.key],
                t, onChange: next => setField(field.key, next),
              })),
          hasAdvanced ? h('div', { className: 'sawb-actions' },
            h('button', { type: 'button', className: 'sawb-btn sawb-btn-sm', 'aria-pressed': String(advanced), onClick: () => setAdvanced(value => !value) }, t('saAdvanced'))) : null,
          h('div', { className: 'sawb-sa-savebar' },
            h('button', { type: 'button', className: 'sawb-btn', onClick: save }, t('saSaveChanges')),
            restarts && restarts.length > 0 ? h('span', { className: 'sawb-meta' }, t('saRestartHint')) : null,
            notice ? h('span', { className: 'sawb-meta' }, notice) : null)))
    }

    /** 策略表单：规则与按来源拆分的 policy.fields，保存时提交整个 policy 块。 */
    function SaPolicyEditor({ block, sources, t, onSave }) {
      const [draft, setDraft] = React.useState(() => cloneJson(block.value))
      const [notice, setNotice] = React.useState('')
      React.useEffect(() => { setDraft(cloneJson(block.value)); setNotice('') }, [block.value, block.revision])
      const setField = (sourceId, key, nextValue) => setDraft(previous => {
        const next = cloneJson(previous) || {}
        next.sources = next.sources || {}
        next.sources[sourceId] = { ...(next.sources[sourceId] || {}), [key]: nextValue }
        return next
      })
      const setRule = (index, key, nextValue) => setDraft(previous => {
        const next = cloneJson(previous) || {}
        const rules = [...(next.rules || [])]
        rules[index] = { ...(rules[index] || {}), [key]: nextValue }
        return { ...next, rules }
      })
      const addRule = () => setDraft(previous => {
        const next = cloneJson(previous) || {}
        return { ...next, rules: [...(next.rules || []), { id: `rule-${Date.now()}`, name: t('saNewRule'), enabled: true, instruction: '' }] }
      })
      const removeRule = index => setDraft(previous => {
        const next = cloneJson(previous) || {}
        return { ...next, rules: (next.rules || []).filter((_, at) => at !== index) }
      })
      const save = () => {
        setNotice(t('saSaving'))
        Promise.resolve(onSave(cloneJson(draft), block.revision))
          .then(() => setNotice(t('saSaved')))
          .catch(error => setNotice(errorText(error)))
      }
      const rules = (draft && draft.rules) || []
      const withPolicy = (sources || []).filter(source => source.policy && (source.policy.fields || []).length > 0)
      return h('section', { className: 'sawb-section' },
        h('h3', null, t('saPolicyRules'), badge(`${rules.length}`, 'muted'), badge(t('saRevision', { n: block.revision }), 'muted')),
        h('div', { className: 'sawb-sa-grid' }, rules.map((rule, index) => h('div', { key: rule.id || index, className: 'sawb-sa-card' },
          h('div', { className: 'sawb-sa-card-head' }, h('h4', null, rule.name || rule.id || t('saNewRule')),
            h('label', { className: 'sawb-switch' },
              h('input', { type: 'checkbox', checked: Boolean(rule.enabled), onChange: event => setRule(index, 'enabled', event.target.checked) }), t('saEnabled')),
            h('span', { className: 'sawb-spacer' }),
            h('button', { type: 'button', className: 'sawb-btn sawb-btn-sm', onClick: () => removeRule(index) }, t('saRemoveRow'))),
          h('div', { className: 'sawb-sa-field' }, h('label', null, t('saRuleId')),
            h('input', { type: 'text', value: String(rule.id || ''), onChange: event => setRule(index, 'id', event.target.value) })),
          h('div', { className: 'sawb-sa-field' }, h('label', null, t('saRuleName')),
            h('input', { type: 'text', value: String(rule.name || ''), onChange: event => setRule(index, 'name', event.target.value) })),
          h('div', { className: 'sawb-sa-field' }, h('label', null, t('saRuleInstruction')),
            h('textarea', { className: 'sawb-sa-textarea', value: String(rule.instruction || ''), onChange: event => setRule(index, 'instruction', event.target.value) }))))),
        h('div', { className: 'sawb-actions' }, h('button', { type: 'button', className: 'sawb-btn sawb-btn-sm', onClick: addRule }, t('saAddRule'))),
        h('h3', null, t('saPolicySources'), badge(t('saRevision', { n: block.revision }), 'muted')),
        h('div', { className: 'sawb-sa-grid' }, withPolicy.map(source => {
          const part = (draft && draft.sources && draft.sources[source.id]) || {}
          return h('div', { key: source.id, className: 'sawb-sa-card' },
            h('div', { className: 'sawb-sa-card-head' }, h('h4', null, localized(source.title, source.id)),
              source.policy.sync ? badge(t('saPolicySync'), source.policy.sync.ready ? 'ok' : 'muted') : null),
            source.policy.explicit ? h('p', { className: 'sawb-meta' }, localized(source.policy.explicit)) : null,
            (source.policy.fields || []).map(field => h(SaFieldEditor, {
              key: field.key, field, value: part[field.key], t,
              onChange: next => setField(source.id, field.key, next),
            })))
        })),
        h('div', { className: 'sawb-sa-savebar' },
          h('button', { type: 'button', className: 'sawb-btn', onClick: save }, t('saSaveChanges')),
          notice ? h('span', { className: 'sawb-meta' }, notice) : null))
    }

    /** 提示词编辑器：团队三段、技能、内置片段覆盖与修订历史。 */
    function SaPromptsEditor({ prompts, t, onSave }) {
      const current = prompts && prompts.current
      const [draft, setDraft] = React.useState(() => cloneJson(current && current.config))
      const [notice, setNotice] = React.useState('')
      const [newSkill, setNewSkill] = React.useState('')
      const [newOverride, setNewOverride] = React.useState('')
      React.useEffect(() => { setDraft(cloneJson(current && current.config)); setNotice('') }, [current && current.revision])
      if (!current) return h('div', { className: 'sawb-empty' }, t('saNoPrompts'))
      const config = draft || {}
      const update = (key, value) => setDraft(previous => ({ ...previous, [key]: value }))
      const updateSkill = (name, value) => setDraft(previous => ({ ...previous, skills: { ...(previous.skills || {}), [name]: value } }))
      const removeSkill = name => setDraft(previous => {
        const skills = { ...(previous.skills || {}) }
        delete skills[name]
        return { ...previous, skills }
      })
      const addSkill = () => {
        const name = newSkill.trim()
        if (!name) return
        updateSkill(name, '')
        setNewSkill('')
      }
      const updateOverride = (name, text) => setDraft(previous => ({
        ...previous,
        overrides: { ...(previous.overrides || {}), [name]: { ...((previous.overrides || {})[name] || {}), text } },
      }))
      const removeOverride = name => setDraft(previous => {
        const overrides = { ...(previous.overrides || {}) }
        delete overrides[name]
        return { ...previous, overrides }
      })
      const addOverride = () => {
        const name = newOverride
        if (!name) return
        const part = (prompts.parts || []).find(item => item.key === name)
        setDraft(previous => ({
          ...previous,
          overrides: { ...(previous.overrides || {}), [name]: { text: '', ...(part && part.base ? { base: part.base } : {}) } },
        }))
        setNewOverride('')
      }
      const save = () => {
        setNotice(t('saSaving'))
        Promise.resolve(onSave(cloneJson(config), current.revision))
          .then(() => setNotice(t('saSaved')))
          .catch(error => setNotice(errorText(error)))
      }
      const skillEntries = Object.entries(config.skills || {})
      return h(React.Fragment, null,
        h('section', { className: 'sawb-section' },
          h('div', { className: 'sawb-sa-card' },
            h('div', { className: 'sawb-sa-card-head' },
              h('h4', null, t('saPromptsTeam')),
              badge(t('saRevision', { n: current.revision }), 'muted'),
              prompts.defaultChanged ? badge(t('saPromptsDefault'), 'muted') : null,
              h('span', { className: 'sawb-spacer' })),
            ['communication', 'scope', 'delivery'].map(key => h('div', { key, className: 'sawb-sa-field' },
              h('label', null, t(`saPrompt_${key}`)),
              h('textarea', { className: 'sawb-sa-textarea', value: String(config[key] || ''), onChange: event => update(key, event.target.value) }))),
            h('div', { className: 'sawb-sa-savebar' },
              h('button', { type: 'button', className: 'sawb-btn', onClick: save }, t('saSaveChanges')),
              notice ? h('span', { className: 'sawb-meta' }, notice) : null))),
        h('section', { className: 'sawb-section' },
          h('div', { className: 'sawb-sa-card' },
            h('div', { className: 'sawb-sa-card-head' }, h('h4', null, t('saPromptsSkills')), badge(String(skillEntries.length), 'muted')),
            skillEntries.length === 0 ? h('div', { className: 'sawb-meta' }, t('saNoSkills')) : null,
            skillEntries.map(([name, text]) => h('div', { key: name, className: 'sawb-sa-field' },
              h('label', null, name),
              h('div', null,
                h('textarea', { className: 'sawb-sa-textarea', value: String(text || ''), onChange: event => updateSkill(name, event.target.value) }),
                h('button', { type: 'button', className: 'sawb-btn sawb-btn-sm', onClick: () => removeSkill(name) }, t('saRemoveRow'))))),
            h('div', { className: 'sawb-actions' },
              h('input', { type: 'text', className: 'sawb-textarea', style: { maxWidth: 220, marginTop: 0 }, placeholder: t('saAddSkill'), value: newSkill, onChange: event => setNewSkill(event.target.value) }),
              h('button', { type: 'button', className: 'sawb-btn', onClick: addSkill }, t('saAddSkill'))))),
        h('section', { className: 'sawb-section' },
          h('div', { className: 'sawb-sa-card' },
            h('div', { className: 'sawb-sa-card-head' }, h('h4', null, t('saPromptsOverrides')), badge(String(Object.keys(config.overrides || {}).length), 'muted')),
            Object.keys(config.overrides || {}).length === 0 ? h('div', { className: 'sawb-meta' }, t('saNoOverrides')) : null,
            Object.entries(config.overrides || {}).map(([name, override]) => h('div', { key: name, className: 'sawb-sa-field' },
              h('label', null, name),
              h('textarea', { className: 'sawb-sa-textarea', value: String(override && override.text || ''), onChange: event => updateOverride(name, event.target.value) }),
              h('button', { type: 'button', className: 'sawb-btn sawb-btn-sm', onClick: () => removeOverride(name) }, t('saRemoveRow')))),
            h('div', { className: 'sawb-actions' },
              h('select', { value: newOverride, onChange: event => setNewOverride(event.target.value) },
                h('option', { value: '' }, t('saAddOverride')),
                (prompts.parts || []).map(part => h('option', { key: part.key, value: part.key }, part.key))),
              h('button', { type: 'button', className: 'sawb-btn', onClick: addOverride }, t('saAddOverride'))))),
        h('section', { className: 'sawb-section' },
          h('details', { className: 'sawb-sa-card' },
            h('summary', null, t('saPromptsHistory'), current.savedAt ? badge(when(current.savedAt), 'muted') : null),
            (prompts.revisions || []).length === 0 ? h('div', { className: 'sawb-meta' }, t('saNoHistory')) : null,
            (prompts.revisions || []).map(item => h('div', { key: item.revision, className: 'sawb-meta sawb-mono' },
              `r${item.revision} · ${when(item.savedAt)} · ${item.source || ''} · ${(item.changed || []).join(', ')}`)))))
    }

    /** SA 控制页：读 state/overview/sources/settings/prompts；写操作全部走同源代理。 */
    function SaView({ t, section, onSection }) {
      const [state, setState] = React.useState({ phase: 'loading', data: undefined, error: '' })
      const [tab, setTab] = React.useState('overview')
      const [actionNotice, setActionNotice] = React.useState('')
      const load = React.useCallback(signal => {
        setState(previous => ({ phase: 'loading', data: previous.data, error: '' }))
        Promise.all([
          saRequest('GET', 'state'),
          saRequest('GET', 'overview'),
          saRequest('GET', 'sources'),
          saRequest('GET', 'settings'),
          saRequest('GET', 'prompts'),
          saRequest('GET', 'threads'),
          saRequest('GET', 'decisions'),
        ]).then(([status, overview, sources, settings, prompts, threads, decisions]) => {
          setState({ phase: 'ready', data: { status, overview, sources, settings, prompts, threads, decisions }, error: '' })
        }).catch(error => {
          if (error && error.name === 'AbortError') return
          setState({ phase: 'error', data: undefined, error: errorText(error) })
        })
      }, [])
      React.useEffect(() => {
        const controller = new AbortController()
        load(controller.signal)
        return () => controller.abort()
      }, [load])
      const call = (method, path, body) => saRequest(method, path, body).then(data => { load(); return data })
      /** 按钮类写操作：失败显示在操作条，不抛未处理 rejection。 */
      const act = (method, path, body) => saRequest(method, path, body).then(data => {
        setActionNotice(t('saActionDone'))
        load()
        return data
      }, error => {
        setActionNotice(errorText(error))
        return undefined
      })
      const data = state.data
      const status = data && data.status
      const overview = data && data.overview
      const paused = Boolean(status && status.paused)
      const health = status && status.health
      const settingsSources = (data && data.settings && data.settings.sources) || []
      const sourceCards = ((data && data.sources) || []).map(source => ({ ...source, settings: settingsSources.find(item => item.id === source.id) }))
      const tabs = [['overview', t('saOverview')], ['sources', t('saSourcesTab')], ['threads', t('saThreadsTab')], ['decisions', t('saDecisionsTab')], ['settings', t('saSettingsTab')], ['prompts', t('saPromptsTab')]]
      const tabButton = key => h('button', { key, type: 'button', 'aria-pressed': String(tab === key), onClick: () => setTab(key) }, tabs.find(item => item[0] === key)[1])
      let body = null
      if (tab === 'overview') {
        const loadInfo = (status && status.load) || {}
        const flow = (overview && overview.flow) || {}
        const machine = status && status.setup && status.setup.machine
        const accounts = status && status.setup && status.setup.accounts
        const accountText = [accounts && accounts.repository, accounts && accounts.agent,
          accounts && accounts.feishu && accounts.feishu.name].filter(Boolean).join(' · ')
        body = h(React.Fragment, null,
          h('section', { className: 'sawb-section' },
            h('div', { className: 'sawb-sa-grid' },
              h('div', { className: 'sawb-sa-card' },
                h('div', { className: 'sawb-sa-card-head' }, h('h4', null, t('saState')), SaTag({ state: paused ? 'paused' : 'ready', t })),
                h('dl', { className: 'sawb-kv' },
                  h('dt', null, t('saMaster')), h('dd', { className: 'sawb-mono' }, status && status.masterId || '—'),
                  h('dt', null, t('saExecutorLabel')), h('dd', null, paused ? t('saPaused') : t('saRunning')),
                  h('dt', null, t('saSetupDir')), h('dd', { className: 'sawb-mono', title: machine && machine.stateDir || '' }, machine && machine.stateDir || '—'),
                  h('dt', null, t('saAccounts')), h('dd', null, accountText || '—')),
                h('div', { className: 'sawb-sa-stats' },
                  h(SaStat, { label: t('saActiveWorkersLabel'), value: `${loadInfo.running ?? loadInfo.active ?? 0}/${loadInfo.maxWorkers || 0}` }),
                  h(SaStat, { label: t('saIdle'), value: loadInfo.idle || 0 }),
                  h(SaStat, { label: t('saQueued'), value: loadInfo.queued || 0 }))),
              h('div', { className: 'sawb-sa-card' },
                h('div', { className: 'sawb-sa-card-head' }, h('h4', null, t('saFlow')), h('span', { className: 'sawb-spacer' })),
                h('div', { className: 'sawb-sa-stats' },
                  h(SaStat, { label: t('saReceived'), value: flow.received || 0 }),
                  h(SaStat, { label: t('saFiltered'), value: flow.filtered || 0 }),
                  h(SaStat, { label: t('saJudged'), value: flow.judged || 0 }),
                  h(SaStat, { label: t('saAccepted'), value: flow.accepted || 0 }),
                  h(SaStat, { label: t('saDropped'), value: flow.dropped || 0 })),
                h('div', { className: 'sawb-meta' }, `${t('saPolicyVersion')} ${overview && overview.policyVersion || '—'}`)))),
          h('section', { className: 'sawb-section' },
            h('h3', null, t('saProblems'), overview && overview.problems && overview.problems.length ? badge(`${overview.problems.length}`, 'live') : badge('0', 'ok')),
            !overview || !overview.problems || overview.problems.length === 0
              ? h('div', { className: 'sawb-panel sawb-meta' }, t('saNoProblems'))
              : h('div', null, overview.problems.map((problem, index) => h(SaProblem, { key: index, problem, t })))),
          h('section', { className: 'sawb-section' }, h('h3', null, t('saHealth')), h('div', { className: 'sawb-panel' }, h(SaHealthList, { health, t }))))
      } else if (tab === 'sources') {
        body = h('section', { className: 'sawb-section' },
          sourceCards.length === 0
            ? h('div', { className: 'sawb-empty' }, t('saNoSources'))
            : h('div', { className: 'sawb-sa-grid' }, sourceCards.map(source => {
                const settings = source.settings || {}
                const stats = source.stats || {}
                const canRefresh = hasRefreshFields(settings.fields)
                return h('div', { key: source.id, className: 'sawb-sa-card' },
                  h('div', { className: 'sawb-sa-card-head' },
                    h('h4', null, localized(source.title, source.id)),
                    SaTag({ state: source.state, t }),
                    h('span', { className: 'sawb-spacer' }),
                    badge(source.id, 'muted')),
                  h('div', { className: 'sawb-sa-stats' },
                    h(SaStat, { label: t('saReceived'), value: stats.received || 0 }),
                    h(SaStat, { label: t('saFiltered'), value: stats.filtered || 0 }),
                    h(SaStat, { label: t('saLastAt'), value: stats.lastAt ? when(stats.lastAt) : '—' })),
                  h(SaHealthList, { health: source.health, t }),
                  source.problem ? h(Notice, { tone: 'error' }, localized(source.problem, String(source.problem))) : null,
                  h('div', { className: 'sawb-actions' },
                    canRefresh ? h('button', { type: 'button', className: 'sawb-btn sawb-btn-sm', onClick: () => act('POST', `sources/${source.id}/labels`, {}) }, t('saRefreshLabels')) : null,
                    settings.policy && settings.policy.sync
                      ? h('button', { type: 'button', className: 'sawb-btn sawb-btn-sm', disabled: !settings.policy.sync.ready, onClick: () => act('POST', `policy-sync/${source.id}`, {}) }, t('saPolicySync'))
                      : null,
                    (source.filtered || []).length > 0 ? h('span', { className: 'sawb-meta' }, `${t('saFiltered')} ${source.filtered.length}`) : null))
              })))
      } else if (tab === 'threads') {
        const threads = (data.threads && data.threads.items) || []
        body = h('section', { className: 'sawb-section' },
          h('h3', null, t('saThreadsTab'), badge(`${threads.length}`, 'muted')),
          threads.length === 0
            ? h('div', { className: 'sawb-empty' }, t('saNoThreads'))
            : h('div', { className: 'sawb-sa-grid' }, threads.map(thread => {
                const source = sourceCards.find(item => item.id === thread.source)
                return h('div', { key: thread.key, className: 'sawb-sa-card' },
                  h('div', { className: 'sawb-sa-card-head' },
                    h('h4', null, thread.title || thread.key),
                    badge(thread.stage || '—', 'muted'),
                    h('span', { className: 'sawb-spacer' }),
                    h('button', { type: 'button', className: 'sawb-btn sawb-btn-sm', onClick: () => act('POST', `threads/${encodeURIComponent(thread.key)}/unsubscribe`, {}) }, t('saUnsubscribe'))),
                  h('div', { className: 'sawb-meta' }, `${localized(source && source.title, thread.source)} · ${when(thread.lastAt)}`),
                  thread.latest && thread.latest.preview ? h('p', { className: 'sawb-sa-preview' }, thread.latest.preview) : null,
                  (thread.tickets || []).length > 0
                    ? h('div', null,
                        h('div', { className: 'sawb-meta' }, t('saThreadTickets')),
                        thread.tickets.map(ticket => h('div', { key: ticket.id, className: 'sawb-meta' }, `${ticket.title || ticket.id} · ${ticket.state || ''}`)))
                    : null,
                  thread.pending ? h('div', { className: 'sawb-meta' }, t('saPendingCount', { n: thread.pending })) : null,
                  thread.url ? h('div', { className: 'sawb-meta' }, h('a', { href: thread.url, target: '_blank', rel: 'noreferrer' }, thread.url)) : null)
              })))
      } else if (tab === 'decisions') {
        const decisions = (data.decisions && data.decisions.items) || []
        const decisionLabel = kind => ({ accept: t('saDecisionAccept'), ignore: t('saDecisionIgnore'), unavailable: t('saDecisionUnavailable') }[kind] || kind)
        body = h('section', { className: 'sawb-section' },
          h('h3', null, t('saDecisionsTab'), badge(`${decisions.length}`, 'muted')),
          decisions.length === 0
            ? h('div', { className: 'sawb-empty' }, t('saNoDecisions'))
            : h('div', { className: 'sawb-sa-grid' }, decisions.map(decision => {
                const reason = (decision.reason || []).map(item => {
                  const detail = item.values && item.values.text
                  return detail ? `${item.code}：${detail}` : item.code
                }).join('；')
                return h('div', { key: decision.id, className: 'sawb-sa-card' },
                  h('div', { className: 'sawb-sa-card-head' },
                    h('h4', null, decision.ticketTitle || decision.threadTitle || decision.preview || decision.id),
                    badge(decisionLabel(decision.kind), decision.kind === 'accept' ? 'ok' : decision.kind === 'unavailable' ? 'error' : 'muted'),
                    h('span', { className: 'sawb-spacer' }),
                    decision.kind === 'unavailable'
                      ? h('button', { type: 'button', className: 'sawb-btn sawb-btn-sm', onClick: () => act('POST', `decisions/${encodeURIComponent(decision.id)}/dismiss`, {}) }, t('saDismiss'))
                      : null),
                  h('div', { className: 'sawb-meta' }, when(decision.at)),
                  decision.preview ? h('p', { className: 'sawb-sa-preview' }, decision.preview) : null,
                  reason ? h('div', { className: 'sawb-meta' }, `${t('saReason')}：${reason}`) : null,
                  decision.ticketId ? h('div', { className: 'sawb-meta sawb-mono' }, decision.ticketId) : null)
              })))
      } else if (tab === 'settings') {
        body = h(React.Fragment, null,
          h('section', { className: 'sawb-section' },
            h('div', { className: 'sawb-sa-grid' },
              (() => {
                const blocks = data.settings && data.settings.blocks || {}
                return h(React.Fragment, null,
                  blocks.policy ? h(SaPolicyEditor, { block: blocks.policy, sources: settingsSources, t,
                    onSave: (value, revision) => call('PUT', 'settings/policy', { value, revision }) }) : null,
                  ['eval', 'executor'].map(name => {
                    const block = blocks[name]
                    if (!block) return null
                    return h(SaSettingsForm, { key: name, title: name, value: block.value, revision: block.revision, fields: inferFields(block.value), t,
                      onSave: (value, revision) => call('PUT', `settings/${name}`, { value, revision }) })
                  }))
              })())),
          h('section', { className: 'sawb-section' },
            h('h3', null, t('saSourcesTab')),
            h('div', { className: 'sawb-sa-grid' }, settingsSources.map(source => h(SaSettingsForm, {
              key: source.id, title: localized(source.title, source.id), value: source.value, revision: source.revision,
              fields: source.fields || [], facts: source.facts || {}, restarts: source.restarts || [], problem: source.problem,
              source: true, t, onSave: (value, revision) => call('PUT', `settings/source:${source.id}`, { value, revision }),
            })))),
          h(RetentionSection, { t }))
      } else {
        body = h(SaPromptsEditor, { prompts: data.prompts, t, onSave: (config, baseRevision) => call('PUT', 'prompts', { config, baseRevision }) })
      }
      return h(React.Fragment, null,
        h('div', { className: 'sawb-head' },
          h('h2', { className: 'sawb-title' }, t('saTitle')),
          h('span', { className: 'sawb-meta' }, t('saHint')),
          h('span', { className: 'sawb-spacer' }),
          h(Tabs, { section, t, onSection }),
          h('button', { type: 'button', className: 'sawb-btn', onClick: () => call('POST', 'setup/check', {}) }, t('saSetupCheck')),
          h('button', { type: 'button', className: 'sawb-btn', onClick: () => call('POST', 'executor/pause', { paused: !paused }) }, paused ? t('saResume') : t('saPause')),
          actionNotice ? h('span', { className: 'sawb-meta' }, actionNotice) : null,
          h('button', { type: 'button', className: 'sawb-btn', onClick: () => load() }, t('refresh'))),
        h('div', { className: 'sawb-body' },
          state.phase === 'error'
            ? h(Notice, { tone: 'error' }, t('saUnavailable', { message: state.error }))
            : !data
              ? h('div', { className: 'sawb-empty' }, t('loadingData'))
              : h(React.Fragment, null,
                  h('div', { className: 'sawb-subtabs' }, tabs.map(item => tabButton(item[0]))),
                  body)))
    }

    /** 工单详情上的运行操作：retry / stop，均走 SA 管理 API。 */
    function TicketActions({ ticket, t }) {
      const [notice, setNotice] = React.useState('')
      if (!ticket.live) return null
      const call = path => saRequest('POST', path, {}).then(() => setNotice(t('saSaved'))).catch(error => setNotice(errorText(error)))
      return h('div', { className: 'sawb-actions' },
        h('button', { type: 'button', className: 'sawb-btn', onClick: () => call(`tickets/${ticket.id}/retry`) }, t('saRetry')),
        h('button', { type: 'button', className: 'sawb-btn', onClick: () => call(`tickets/${ticket.id}/stop`) }, t('saStop')),
        notice ? h('span', { className: 'sawb-meta' }, notice) : null)
    }

    function RepoCard({ repo, t, onOpen }) {
      const sourceLabel = repo.source === 'workspace' ? t('repoSourceWorkspace')
        : repo.source === 'sa-work' ? t('repoSourceSaWork')
        : repo.source === 'sa-delivery' ? t('repoSourceSaDelivery')
        : t('repoSourceConfigured')
      return h('article', { className: 'sawb-repo-card' },
        h('h3', null, repo.name, ' ', badge(sourceLabel, 'muted')),
        h('div', { className: 'sawb-chips' },
          badge(repo.mode === 'git' ? t('modeGit') : t('modeWorktree'), 'muted'),
          badge(repo.git ? t('repoGit') : t('repoNoGit'), repo.git ? 'ok' : 'muted')),
        repo.description ? h('p', { className: 'sawb-meta' }, repo.description) : null,
        repo.ok === false
          ? h(Notice, { tone: 'error' }, t('repoUnavailable', { message: repo.error }))
          : h('dl', { className: 'sawb-repo-info' },
              h('dt', null, t('branch')), h('dd', { className: 'sawb-mono' }, repo.branch || '—'),
              h('dt', null, t('head')), h('dd', { className: 'sawb-mono', title: repo.subject || '' }, `${repo.head || '—'}${repo.subject ? ` · ${repo.subject}` : ''}`),
              h('dt', null, t('repoPath')), h('dd', { className: 'sawb-mono', title: repo.path }, repo.path),
              repo.dirty ? h(React.Fragment, null, h('dt', null, ' '), h('dd', null, badge(t('dirty', { n: repo.dirty }), 'live'))) : null),
        repo.sessions && repo.sessions.length > 0
          ? h('div', null,
              h('div', { className: 'sawb-meta' }, t('repoSessionCount', { n: repo.sessions.length })),
              h(SessionList, { sessions: repo.sessions, t }))
          : null,
        repo.commits && repo.commits.length > 0
          ? h('div', null,
              h('div', { className: 'sawb-meta' }, t('commits')),
              h('ul', { className: 'sawb-meta', style: { margin: '4px 0 0', paddingLeft: 18 } },
                repo.commits.slice(0, 3).map(commit => h('li', { key: commit.short }, h('span', { className: 'sawb-mono' }, commit.short), ' ', commit.subject))))
          : null,
        h('div', { className: 'sawb-foot-line' },
          h('button', { type: 'button', className: 'sawb-btn', disabled: repo.ok === false, onClick: () => onOpen(repo) }, t('openRepo'))))
    }

    /** 代码仓库：仓库列表 → 目录树 → 文件内容。全程只读。 */
    function CodeView({ t, section, onSection }) {
      const [route, setRoute] = React.useState({ kind: 'repos', repo: undefined, path: '' })
      const [repoPage, setRepoPage] = React.useState(1)
      const [state, setState] = React.useState({ phase: 'loading', data: undefined, error: '' })
      const treePaged = usePagedList((state.data && state.data.entries) || [], LIST_PAGE_SIZE)

      React.useEffect(() => { treePaged.setPage(1) }, [route])
      React.useEffect(() => {
        const controller = new AbortController()
        setState({ phase: 'loading', data: undefined, error: '' })
        let params
        if (route.kind === 'repos') params = {
          view: 'repos',
          offset: String((repoPage - 1) * LIST_PAGE_SIZE),
          limit: String(LIST_PAGE_SIZE),
        }
        else if (route.kind === 'tree') params = { view: 'tree', repo: route.repo.id, path: route.path }
        else params = { view: 'blob', repo: route.repo.id, path: route.path }
        loadApi(params, controller.signal)
          .then(data => setState({ phase: 'ready', data, error: '' }))
          .catch(error => {
            if (error && error.name === 'AbortError') return
            setState({ phase: 'error', data: undefined, error: errorText(error) })
          })
        return () => controller.abort()
      }, [route, repoPage])

      const openRepo = repo => setRoute({ kind: 'tree', repo, path: '' })
      const openTree = (repo, path) => setRoute({ kind: 'tree', repo, path })
      const openBlob = (repo, path) => setRoute({ kind: 'blob', repo, path })

      let content = null
      if (state.phase === 'error') {
        content = h(Notice, { tone: 'error' }, t('readFailed', { message: state.error }))
      } else if (state.phase === 'loading' && !state.data) {
        content = h('div', { className: 'sawb-empty' }, t('loadingData'))
      } else if (route.kind === 'repos') {
        const repos = state.data.repos || []
        const total = Number(state.data.total) || repos.length
        content = repos.length === 0
          ? h('div', { className: 'sawb-empty' }, t('noRepos'))
          : h(React.Fragment, null,
              h('div', { className: 'sawb-repo-grid' }, repos.map(repo => h(RepoCard, { key: repo.id, repo, t, onOpen: openRepo }))),
              h(Pagination, { page: repoPage, pageSize: LIST_PAGE_SIZE, total, t, onChange: setRepoPage }))
      } else if (route.kind === 'tree') {
        const data = state.data
        const entries = data.entries || []
        const dirs = entries.filter(item => item.type === 'dir').length
        content = h(React.Fragment, null,
          h('div', { className: 'sawb-file-head' },
            h('button', { type: 'button', className: 'sawb-btn', onClick: () => setRoute({ kind: 'repos' }) }, `← ${t('backToRepos')}`),
            h('button', { type: 'button', className: 'sawb-btn', onClick: () => openTree(route.repo, '') }, t('repoPath')),
            h('span', { className: 'sawb-meta' }, t('dirCount', { n: dirs }) + ' · ' + t('fileCount', { n: entries.length - dirs }))),
          h(Breadcrumbs, { repo: route.repo, path: data.path || '', t, onRoot: () => openTree(route.repo, ''), onPath: path => openTree(route.repo, path) }),
          entries.length === 0
            ? h('div', { className: 'sawb-empty' }, t('emptyTree'))
            : h(React.Fragment, null,
                h('div', { className: 'sawb-tree' }, treePaged.items.map(entry => h('button', {
                  key: entry.path, type: 'button', className: 'sawb-tree-row',
                  onClick: () => entry.type === 'dir' ? openTree(route.repo, entry.path) : openBlob(route.repo, entry.path),
                },
                  h('span', { className: 'sawb-tree-icon', 'aria-hidden': true }, entry.type === 'dir' ? '▸' : '·'),
                  h('span', { className: 'sawb-tree-name' }, entry.name + (entry.type === 'dir' ? '/' : '')),
                  h('span', { className: 'sawb-meta' }, entry.type === 'dir' ? '' : (entry.lang || ''))))),
                h(Pagination, { page: treePaged.page, pageSize: LIST_PAGE_SIZE, total: entries.length, t, onChange: treePaged.setPage })))
      } else {
        const data = state.data
        const parent = route.path.includes('/') ? route.path.slice(0, route.path.lastIndexOf('/')) : ''
        content = h(React.Fragment, null,
          h('div', { className: 'sawb-file-head' },
            h('button', { type: 'button', className: 'sawb-btn', onClick: () => openTree(route.repo, parent) }, `← ${t('backToTree')}`),
            h('h2', { className: 'sawb-detail-title' }, route.path.split('/').pop()),
            badge(data.isDoc ? t('docFile') : (data.lang || t('codeFile')), 'muted'),
            h('span', { className: 'sawb-meta' }, `${data.size >= 0 ? Math.ceil(data.size / 1024) + ' KB' : ''}`)),
          h(Breadcrumbs, { repo: route.repo, path: route.path, t, onRoot: () => openTree(route.repo, ''), onPath: path => openTree(route.repo, path) }),
          data.tooLarge
            ? h(Notice, null, t('fileTooLarge'))
            : data.binary
              ? h(Notice, null, t('binaryFile'))
              : data.isDoc
                ? h('div', { className: 'sawb-panel' }, h(Markdown, { blocks: data.blocks }))
                : h('div', { className: 'sawb-code-wrap' }, h(CodeBlock, { text: data.text })))
      }

      return h(React.Fragment, null,
        h('div', { className: 'sawb-head' },
          h('h2', { className: 'sawb-title' }, t('reposTitle')),
          h('span', { className: 'sawb-meta' }, t('reposHint')),
          h('span', { className: 'sawb-spacer' }),
          h(Tabs, { section, t, onSection })),
        h('div', { className: 'sawb-body' }, content))
    }

    /** 列表：静默定时刷新；详情：打开时读一次快照，避免长报告反复传输。 */
    function Workbench({ t }) {
      const [section, setSection] = React.useState('workspaces')
      const [list, setList] = React.useState({ phase: 'loading', data: undefined, error: '' })
      const [detail, setDetail] = React.useState({ id: '', ticket: undefined, phase: 'idle', error: '' })
      const [nonce, setNonce] = React.useState(0)

      React.useEffect(() => {
        let alive = true
        const controller = new AbortController()
        const read = quiet => loadSnapshot('', controller.signal)
          .then(data => { if (alive) setList({ phase: 'ready', data, error: '' }) })
          .catch(error => {
            if (!alive || (error && error.name === 'AbortError')) return
            setList(previous => ({ phase: 'error', data: previous.data, error: String(error && error.message ? error.message : error) }))
          })
        void read(false)
        const timer = setInterval(() => { void loadSnapshot('', controller.signal).then(data => { if (alive) setList({ phase: 'ready', data, error: '' }) }).catch(() => {}) }, REFRESH_MS)
        return () => { alive = false; controller.abort(); clearInterval(timer) }
      }, [nonce])

      const open = React.useCallback(id => {
        setDetail({ id, ticket: undefined, phase: 'loading', error: '' })
        const controller = new AbortController()
        loadSnapshot(id, controller.signal)
          .then(data => setDetail({ id, ticket: data.ticket, phase: 'ready', error: '' }))
          .catch(error => setDetail({ id, ticket: undefined, phase: 'error', error: String(error && error.message ? error.message : error) }))
      }, [])
      const back = React.useCallback(() => setDetail({ id: '', ticket: undefined, phase: 'idle', error: '' }), [])

      if (section === 'workspaces') return h(Root, null, h(WorkspacesView, { t, section, onSection: setSection }))
      if (section === 'repos') return h(Root, null, h(CodeView, { t, section, onSection: setSection }))
      if (section === 'docs') return h(Root, null, h(DocsView, { t, section, onSection: setSection }))
      if (section === 'sa') return h(Root, null, h(SaView, { t, section, onSection: setSection }))

      if (detail.id) {
        if (detail.ticket) return h(Root, null, h(DetailView, { ticket: detail.ticket, t, onBack: back }))
        return h(Root, null,
          h('div', { className: 'sawb-body' },
            detail.phase === 'error'
              ? h(Notice, { tone: 'error' }, t('loadFailed', { message: detail.error }))
              : h('div', { className: 'sawb-empty' }, t('loading'))),
          h('div', { className: 'sawb-foot' }, h('button', { type: 'button', className: 'sawb-btn', onClick: back }, `← ${t('back')}`)))
      }

      return h(Root, null,
        list.data ? h(ListView, { data: list.data, t, onOpen: open, section, onSection: setSection }) : null,
        list.phase === 'loading' && !list.data ? h('div', { className: 'sawb-empty' }, t('loading')) : null,
        list.phase === 'error'
          ? h('div', { className: 'sawb-body' },
              h(Notice, { tone: 'error' }, t('loadFailed', { message: list.error }), ' ',
                h('button', { type: 'button', className: 'sawb-btn', onClick: () => setNonce(value => value + 1) }, t('retry'))))
          : null,
        list.data && list.data.generatedAt
          ? h('div', { className: 'sawb-meta sawb-foot' }, t('refreshedAt', { time: when(list.data.generatedAt) }))
          : null)
    }

    // ---------------- 注册 ----------------

    const Icon = ({ size }) =>
      h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('rect', { x: 3, y: 4.5, width: 18, height: 15, rx: 2 }),
        h('path', { d: 'M7 9h6M7 12.5h10M7 16h7' }),
        h('circle', { cx: 17, cy: 8, r: 1.6, fill: 'currentColor', stroke: 'none' }))

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        // DSH 内置语言 id 是 zh / en；再保留 zh-CN 以兼容浏览器区域标签。
        ctx.effect(() => ctx.locale.register(NS, { zh, 'zh-CN': zh, en }), 'dsh-workbench: dictionaries')
        const t = ctx.locale.bind(NS)
        ctx.slots.inject('main', () => ctx.slots.register(
          { name: 'main', key: PANEL_ID, locale: NS },
          (props) => h(Workbench, { t: props.t || t }),
        ))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
          { name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => t('panel'), locale: NS },
          Icon,
        ))
      },
    }
  },
})
