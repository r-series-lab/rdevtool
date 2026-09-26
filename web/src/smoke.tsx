import { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { Box, Button, CssBaseline, ThemeProvider } from "@mui/material";
import { mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import type { PageKey } from "./app-shell";
import type {
  ConfigSource,
  ConfigSourceComparison,
  ConfigSourceCopyRequest,
  ConfigSourceCopyResult,
  ConfigSourceFileInspection,
  ConfigSourceInspection,
  FinderShortcutItem,
  BranchTaskHistoryEntry,
  BuildHistoryEntry,
  BranchWorktreeSummary,
  ManagedArtifactCleanupPlanResponse,
  ManagedArtifactInventoryResponse,
  ProjectConfigEditorState,
  DeployTargetConfigSummary,
  ProjectManagementViewKey,
  ProjectRuntimeContextSnapshot,
  ProjectRuntimeEntry,
  ProjectRuntimePreflightResponse,
  ProxyDashboard,
  SaveProjectRuntimeLaunchProfileResponse,
  ProjectWorkspaceSummary,
  WorkspaceConfigFocusRequest,
} from "./app-types";
import { AppShellLayout } from "./components/AppShellLayout";
import { SettingsPanel } from "./components/SettingsPanel";
import { useAppConfirmDialog } from "./components/AppConfirmDialog";
import { ConfigSourceManagerDialog } from "./components/ConfigSourceManagerDialog";
import { ResourceActionDialog } from "./components/ResourceActionDialog";
import { HistoryCard } from "./components/AppCards";
import {
  FolderIcon,
  OpenExternalIcon,
  PackageIcon,
  SettingsIcon,
  TerminalIcon,
  WorkflowIcon,
} from "./components/AppIcons";
import { BranchHistoryPanel } from "./components/branch/BranchHistoryPanel";
import {
  WorkspacePageToolbar,
  WorkspacePageToolbarAction,
} from "./components/WorkspacePageToolbar";
import { useActivityPreferences } from "./hooks/useActivityPreferences";
import { MergePage, WorktreeSelector } from "./pages/MergePage";
import {
  BuildPage,
  BuildHistoryRecordDetail,
  BuildHistoryMoreMenu,
  BuildHistoryRunTimeline,
  type BuildHistoryParamEntry,
} from "./pages/BuildPage";
import type { BuildTargetMeta } from "./hooks/useBuildContext";
import { ProjectsPage } from "./pages/ProjectsPage";
import { OverviewPage } from "./pages/OverviewPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { ProxyPage } from "./pages/ProxyPage";
import {
  activityRequiresAttention,
  createActivityEntry,
  type ActivityEntry,
} from "./lib/activityCenter";
import { activityVisibleWithPreferences } from "./lib/activityPreferences";
import type { TrayPinnedAction } from "./lib/trayPins";
import type {
  WorkspaceWorkflowChain,
  WorkspaceWorkflowRunState,
} from "./lib/workflowChains";
import { createAppTheme, type AppStyleMode } from "./theme";
import { I18nProvider, useI18n } from "./i18n";
import "./styles.css";

const visibleNavItems: Array<{
  key: PageKey;
  label: string;
  shortLabel: string;
}> = [
  { key: "overview", label: "总览", shortLabel: "总览" },
  {
    key: "projectManagement",
    label: "项目管理",
    shortLabel: "项目管理",
  },
  { key: "resources", label: "资源管理", shortLabel: "资源管理" },
  { key: "proxy", label: "代理配置", shortLabel: "代理配置" },
  { key: "knowledge", label: "知识库", shortLabel: "知识库" },
];

const projectManagementContent: Record<ProjectManagementViewKey, string> = {
  projects: "项目内容",
  build: "构建内容",
  git: "Git 内容",
};

const smokeBranchHistory: BranchTaskHistoryEntry[] = [
  {
    id: "branch-history-batch-latest",
    createdAt: "2026-08-07 09:04",
    workspaceKey: "demo-workspace",
    taskKind: "sync",
    success: true,
    summary: "3 succeeded",
    detail: "",
    replay: {
      command: "execute_branch_sync_task",
      busyText: "正在重新合并分支",
      request: {
        projects: ["demo-portal", "demo-mobile", "demo-console", "demo-service"],
        sourceBranch: "release_demo_202608",
        targetBranch: "main",
      },
    },
    items: [
      ["demo-portal", "示例门户", "release_demo_202608", "main"],
      [
        "demo-mobile",
        "示例移动端",
        "feature_demo_mobile_release_candidate",
        "env_demo_pre",
      ],
      ["demo-console", "示例控制台", "release_demo_202608", "main"],
      ["demo-service", "示例服务", "release_demo_202608", "main"],
    ].map(([projectKey, projectName, sourceBranch, targetBranch]) => ({
      projectKey,
      projectName,
      sourceBranch,
      targetBranch,
      outputPath: null,
      success: true,
      statusKey: "merged",
      statusLabel: "已合并",
      summary: "已合并",
      detail: `已通过 GitLab API 合并到 ${targetBranch}`,
      remote: true,
      commit: null,
    })),
  },
  {
    id: "branch-history-permission-failed",
    createdAt: "2026-08-06 16:49",
    workspaceKey: "demo-workspace",
    taskKind: "sync",
    success: false,
    summary: "0 succeeded / 1 failed",
    detail: "",
    replay: {
      command: "execute_branch_sync_task",
      busyText: "正在重新合并分支",
      request: {
        projects: ["demo-mobile"],
        sourceBranch: "feature_demo_mobile",
        targetBranch: "env_demo_pre",
      },
    },
    items: [
      {
        projectKey: "demo-mobile",
        projectName: "示例移动端",
        sourceBranch: "feature_demo_mobile",
        targetBranch: "env_demo_pre",
        outputPath: null,
        success: false,
        statusKey: "gitlab_forbidden",
        statusLabel: "合并失败",
        summary: "合并失败",
        detail: "合并 MR 失败: HTTP 403 Forbidden",
        remote: true,
        commit: null,
      },
    ],
  },
  ...["2026-08-05 11:22", "2026-08-04 18:36"].map(
    (createdAt, index): BranchTaskHistoryEntry => ({
      id: `branch-history-single-${index}`,
      createdAt,
      workspaceKey: "demo-workspace",
      taskKind: "sync",
      success: true,
      summary: "1 succeeded",
      detail: "",
      replay: null,
      items: [
        {
          projectKey: "demo-console",
          projectName: "示例控制台",
          sourceBranch: index === 0 ? "release_demo_202607" : "release_demo_202606",
          targetBranch: "main",
          outputPath: null,
          success: true,
          statusKey: "merged",
          statusLabel: "已合并",
          summary: "已合并",
          detail: "已通过 GitLab API 合并到 main",
          remote: true,
          commit: null,
        },
      ],
    }),
  ),
];

const smokeBuildParamEntries: BuildHistoryParamEntry[] = [
  {
    key: "IS_BUILD_ADMIN",
    label: "IS_BUILD_ADMIN",
    valueLabel: "是",
    defaultValueLabel: "否",
    hidden: false,
    changed: true,
    defaultKnown: true,
  },
  {
    key: "IS_BUILD_MOBILE",
    label: "IS_BUILD_MOBILE",
    valueLabel: "是",
    defaultValueLabel: "否",
    hidden: false,
    changed: true,
    defaultKnown: true,
  },
  {
    key: "IS_GRAY",
    label: "IS_GRAY",
    valueLabel: "否",
    defaultValueLabel: "是",
    hidden: false,
    changed: true,
    defaultKnown: true,
  },
  {
    key: "CHANNEL",
    label: "CHANNEL",
    valueLabel: "pre",
    defaultValueLabel: "uat",
    hidden: false,
    changed: true,
    defaultKnown: true,
  },
  {
    key: "CACHE_MODE",
    label: "CACHE_MODE",
    valueLabel: "incremental",
    defaultValueLabel: "incremental",
    hidden: false,
    changed: false,
    defaultKnown: true,
  },
  {
    key: "JENKINS_TOKEN",
    label: "JENKINS_TOKEN",
    valueLabel: "已配置",
    defaultValueLabel: "未配置",
    hidden: true,
    changed: true,
    defaultKnown: true,
  },
];

const smokeBuildTimeline: BuildHistoryEntry[] = [
  ["build-run-latest", "构建成功", "构建 #858 当前结果：SUCCESS", "2026-08-05 14:13"],
  ["build-run-second", "构建失败", "构建 #857 当前结果：FAILURE", "2026-08-05 14:02"],
  ["build-run-third", "构建成功", "构建 #856 当前结果：SUCCESS", "2026-08-05 13:48"],
].map(([historyKey, stateLabel, detail, updatedAt], index) => ({
  historyKey,
  workspaceKey: "demo-workspace",
  projectKey: "demo-portal",
  projectName: "示例门户",
  mode: "vke",
  env: "uat3",
  branch: "feature_demo_mobile",
  stateKey: index === 1 ? "failed" : "success",
  stateLabel,
  detail,
  queueUrl: null,
  buildUrl: `https://ci.example.test/job/demo-portal/${858 - index}`,
  params: {},
  createdAt: updatedAt,
  updatedAt,
}));

function BuildRecordSmokePanel() {
  const { t } = useI18n();
  const localizedParamEntries = smokeBuildParamEntries.map((entry) =>
    entry.hidden
      ? {
          ...entry,
          valueLabel: t("已配置"),
          defaultValueLabel: t("未配置"),
        }
      : entry,
  );

  return (
    <Box className="workflow-panel workflow-history-panel">
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          minHeight: 30,
          pb: 0.75,
          mb: 0.8,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Box component="h2" sx={{ m: 0, fontSize: "1.12rem" }}>
          Record
        </Box>
      </Box>
      <Box className="workflow-history-content">
        <Box className="module-list-scroll">
          <Box sx={{ display: "grid", gap: 1.25 }}>
            <HistoryCard
              title="示例控制台 / standard"
              subtitle="构建成功 · 2026-08-10 14:48"
              accent="success"
              badge={
                <BuildHistoryMoreMenu
                  actions={[
                    {
                      key: "record",
                      label: t("打开记录"),
                      icon: <OpenExternalIcon fontSize="small" />,
                      onClick: () => undefined,
                    },
                    {
                      key: "workflow",
                      label: t("配置联动"),
                      icon: <WorkflowIcon fontSize="small" />,
                      onClick: () => undefined,
                      active: true,
                    },
                  ]}
                />
              }
              detail={
                <BuildHistoryRecordDetail
                  detail="构建 #908 当前结果：SUCCESS"
                  paramEntries={localizedParamEntries}
                />
              }
              meta={["pre", "feature_demo_console"]}
            />
            <HistoryCard
              title="示例移动端 / standard"
              subtitle="构建失败 · 2026-08-10 14:32"
              accent="danger"
              detail={
                <BuildHistoryRecordDetail
                  danger
                  detail={[
                    "Jenkins rejected the build request (HTTP 403). The configured credential cannot trigger this job.",
                    "Check the Jenkins token permission, job membership, and CSRF crumb configuration before retrying.",
                  ].join("\n")}
                  paramEntries={localizedParamEntries.slice(0, 2)}
                />
              }
              meta={["pre", "feature_demo_mobile"]}
            />
            <HistoryCard
              title="示例门户 / VKE"
              subtitle="构建成功 · 2026-08-05 14:13"
              accent="success"
              pinned
              detail={
                <BuildHistoryRecordDetail
                  detail="构建 #858 当前结果：SUCCESS"
                  paramEntries={[]}
                />
              }
              meta={[t("连续 {count} 次", { count: 3 }), "uat3"]}
            >
              <BuildHistoryRunTimeline
                items={smokeBuildTimeline}
                formatRelativeTime={(value) => value ?? ""}
              />
            </HistoryCard>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

const smokeKnowledgeDocuments = [
  {
    source: "file",
    scope: "project",
    projectKey: "demo",
    title: "本地代理排障",
    summary:
      "最后验证：2026-07-29。适用项目：示例控制台 demo-console。适用环境：以 env_demo_pre 为例，其他内网环境按相同拓扑替换环境标识与上游地址。",
    path: "/mock/notes/projects/demo/proxy-debug.md",
    relativePath: "projects/demo-console/internal-network-local-debug.md",
    updatedAtMs: Date.parse("2026-07-29T08:20:00+08:00"),
    score: 8,
  },
  {
    source: "file",
    scope: "playbook",
    projectKey: null,
    title: "发布前验证清单",
    summary: "从构建状态、运行时探针和关键页面三个层次保留证据。",
    path: "/mock/notes/playbooks/release-check.md",
    relativePath: "playbooks/release-check.md",
    updatedAtMs: Date.parse("2026-07-28T18:10:00+08:00"),
    score: 5,
  },
  {
    source: "file",
    scope: "inbox",
    projectKey: null,
    title: "待整理：联调环境约定",
    summary: "确认环境命名和访问方式后，再归档到环境约定。",
    path: "/mock/notes/inbox/integration-env.md",
    relativePath: "inbox/integration-env.md",
    updatedAtMs: Date.parse("2026-07-27T12:30:00+08:00"),
    score: 3,
  },
] as const;

const smokeKnowledgeContent: Record<string, string> = {
  "/mock/notes/projects/demo/proxy-debug.md": [
    "# 本地代理排障",
    "",
    "适用项目：`demo`",
    "",
    "## 建议拓扑",
    "",
    "```text",
    "Browser -> localhost dev server -> reverse proxy -> internal gateway",
    "```",
    "",
    "## 结论",
    "",
    "遇到接口 500 时，先确认代理监听、匹配规则和下一跳。",
    "",
    "## 验证记录",
    "",
    "- 代理监听：`127.0.0.1:8791`",
    "- 请求命中：`/api/orders`",
    "- 下一跳状态：`200 OK`",
    "",
    "[查看发布前验证清单](../../playbooks/release-check.md#操作步骤)",
  ].join("\n"),
  "/mock/notes/playbooks/release-check.md": [
    "# 发布前验证清单",
    "",
    "## 操作步骤",
    "",
    "1. 检查构建状态和产物目录。",
    "2. 验证运行时健康探针。",
    "3. 打开关键页面并记录结果。",
  ].join("\n"),
  "/mock/notes/inbox/integration-env.md": [
    "# 待整理：联调环境约定",
    "",
    "## 记录",
    "",
    "确认环境命名和访问方式后，再归档到环境约定。",
  ].join("\n"),
};

let pendingResourceActionCancellation: (() => void) | null = null;

let smokeKnowledgeReadCount = 0;
let smokeDoctorCheckCount = 0;

function createSmokeWorkspace(
  workspace: Pick<ProjectWorkspaceSummary, "key" | "name" | "projectCount"> &
    Partial<ProjectWorkspaceSummary>,
): ProjectWorkspaceSummary {
  return {
    description: null,
    active: false,
    system: false,
    archived: false,
    archivedAt: null,
    archiveReason: null,
    workspaceType: "custom",
    workspaceTypeLabel: "自定义工作区",
    resourceCount: 0,
    includeAllProjects: false,
    includeAllNavigation: false,
    rootDir: null,
    resourceDir: null,
    worklogPath: null,
    worklogExists: false,
    worklogAutoRecord: true,
    workspaceKind: "scope",
    projectScopeLabel: `${workspace.projectCount} 个项目`,
    navigationScopeLabel: "工作区入口",
    ...workspace,
  };
}

const smokeWorkspaces: ProjectWorkspaceSummary[] = [
  createSmokeWorkspace({
    key: "system",
    name: "系统工作区",
    description: "显示全部项目和入口，作为全局管理视图。",
    projectCount: 21,
    active: true,
    system: true,
    workspaceType: "system",
    workspaceTypeLabel: "系统工作区",
    includeAllProjects: true,
    includeAllNavigation: true,
    workspaceKind: "global",
    projectScopeLabel: "全部项目",
  }),
  createSmokeWorkspace({
    key: "release-20260716",
    name: "2026-07-16 上线",
    projectCount: 6,
  }),
  createSmokeWorkspace({
    key: "feature_demo_alpha",
    name: "示例需求 A",
    projectCount: 1,
    workspaceKind: "directory",
  }),
  createSmokeWorkspace({
    key: "feature_demo_exchange",
    name: "REQ-1234 全流量权益兑换流程优化V1.1",
    projectCount: 1,
    workspaceType: "business",
    workspaceKind: "directory",
  }),
  createSmokeWorkspace({
    key: "feature_demo_checkout",
    name: "示例需求工作区",
    projectCount: 2,
    workspaceKind: "directory",
  }),
  createSmokeWorkspace({ key: "r-series", name: "R系列", projectCount: 11 }),
  createSmokeWorkspace({ key: "demo-workspace", name: "示例工作区", projectCount: 10 }),
  createSmokeWorkspace({
    key: "t",
    name: "t",
    projectCount: 0,
    workspaceType: "business",
  }),
];

const documentationProjects = [
  { key: "demo-console", name: "示例控制台" },
  { key: "demo-mobile", name: "示例移动端" },
  { key: "demo-portal", name: "示例门户" },
  { key: "demo-service", name: "示例服务" },
  { key: "demo-admin", name: "示例管理台" },
  { key: "demo-catalog", name: "示例目录" },
  { key: "demo-data", name: "示例数据台" },
  { key: "demo-monitor", name: "示例监控台" },
  { key: "demo-client", name: "示例客户端" },
  { key: "demo-api", name: "示例接口服务" },
];

const documentationWorktrees: BranchWorktreeSummary[] = [
  {
    projectKey: "demo-console",
    projectName: "示例控制台",
    repoPath: "/mock/demo-workspace/demo-console",
    label: "默认工作副本",
    currentBranch: "release_demo_202608",
    detached: false,
    clean: false,
    ahead: 1,
    behind: 0,
    isDefault: true,
    isGitWorktree: true,
    isWorkspaceInstance: true,
    managed: true,
    statusKey: "changed",
    statusLabel: "有变更",
    detail: "1 个文件待提交",
    latestCommit: null,
  },
  {
    projectKey: "demo-mobile",
    projectName: "示例移动端",
    repoPath: "/mock/demo-workspace/demo-mobile",
    label: "需求工作副本",
    currentBranch: "feature_demo_mobile",
    detached: false,
    clean: true,
    ahead: 0,
    behind: 0,
    isDefault: false,
    isGitWorktree: true,
    isWorkspaceInstance: true,
    managed: true,
    statusKey: "ready",
    statusLabel: "可用",
    detail: "工作副本状态正常",
    latestCommit: null,
  },
  {
    projectKey: "demo-portal",
    projectName: "示例门户",
    repoPath: "/mock/demo-workspace/demo-portal",
    label: "默认工作副本",
    currentBranch: "main",
    detached: false,
    clean: true,
    ahead: 0,
    behind: 0,
    isDefault: true,
    isGitWorktree: true,
    isWorkspaceInstance: true,
    managed: true,
    statusKey: "ready",
    statusLabel: "可用",
    detail: "工作副本状态正常",
    latestCommit: null,
  },
];

const documentationBranchEntries = [
  "release_demo_202608",
  "feature_demo_mobile",
  "env_demo_pre",
  "main",
].map((name, index) => ({
  name,
  updatedAt: `2026-08-${String(10 - index).padStart(2, "0")} 10:30`,
  updatedTs: Date.parse(`2026-08-${String(10 - index).padStart(2, "0")}T10:30:00+08:00`),
  commit: null,
}));

const documentationBuildTargets = [
  {
    key: "standard",
    label: "标准",
    adapter: "jenkins",
    actionKind: "build",
    jobName: "Front.jenkins.pipeline/standard",
  },
  {
    key: "vke",
    label: "VKE",
    adapter: "jenkins",
    actionKind: "deploy",
    jobName: "Front.jenkins.pipeline/vke",
  },
];

const documentationBuildProjects = documentationProjects.slice(0, 4).map((project) => ({
  ...project,
  deployTargets:
    project.key === "demo-console"
      ? documentationBuildTargets
      : documentationBuildTargets.slice(0, 1),
}));

const documentationBuildTargetMeta: BuildTargetMeta = {
  targets: documentationBuildTargets,
  selectedTarget: "standard",
  params: [
    {
      key: "BRANCH",
      label: "分支",
      kind: "branch",
      defaultValue: "release_demo_202608",
      configuredDefault: null,
      defaultSource: "currentBranch",
      options: documentationBranchEntries.map((entry) => entry.name),
      required: true,
      trueValue: "",
      falseValue: "",
    },
    {
      key: "ENV_PROFILE",
      label: "部署环境",
      kind: "select",
      defaultValue: "pre",
      configuredDefault: "pre",
      defaultSource: "projectDefault",
      options: ["pre", "uat3"],
      required: true,
      trueValue: "",
      falseValue: "",
    },
    {
      key: "IS_BUILD_ADMIN",
      label: "构建管理端",
      kind: "boolean",
      defaultValue: "是",
      configuredDefault: "是",
      defaultSource: "projectDefault",
      options: [],
      required: false,
      trueValue: "是",
      falseValue: "否",
    },
    {
      key: "IS_BUILD_MOBILE",
      label: "构建移动端",
      kind: "boolean",
      defaultValue: "是",
      configuredDefault: "是",
      defaultSource: "projectDefault",
      options: [],
      required: false,
      trueValue: "是",
      falseValue: "否",
    },
    {
      key: "IS_GRAY",
      label: "灰度构建",
      kind: "boolean",
      defaultValue: "否",
      configuredDefault: "否",
      defaultSource: "booleanFalseValue",
      options: [],
      required: false,
      trueValue: "是",
      falseValue: "否",
    },
    {
      key: "JENKINS_TOKEN",
      label: "JENKINS_TOKEN",
      kind: "hidden",
      defaultValue: "",
      configuredDefault: null,
      defaultSource: "none",
      options: [],
      required: false,
      trueValue: "",
      falseValue: "",
    },
  ],
};

const documentationBuildParamValues = {
  BRANCH: "release_demo_202608",
  ENV_PROFILE: "pre",
  IS_BUILD_ADMIN: "是",
  IS_BUILD_MOBILE: "是",
  IS_GRAY: "否",
  JENKINS_TOKEN: "configured",
};

const documentationBuildHistory: BuildHistoryEntry[] = [
  {
    historyKey: "docs-build-success",
    workspaceKey: "demo-workspace",
    projectKey: "demo-console",
    projectName: "示例控制台",
    mode: "standard",
    env: "pre",
    branch: "release_demo_202608",
    stateKey: "success",
    stateLabel: "构建成功",
    detail: "构建 #908 当前结果：SUCCESS",
    queueUrl: null,
    buildUrl: "https://ci.example.test/job/demo-console/908",
    params: documentationBuildParamValues,
    createdAt: "2026-08-10 14:48",
    updatedAt: "2026-08-10 14:48",
  },
  {
    historyKey: "docs-build-failed",
    workspaceKey: "demo-workspace",
    projectKey: "demo-mobile",
    projectName: "示例移动端",
    mode: "standard",
    env: "pre",
    branch: "feature_demo_mobile",
    stateKey: "failed",
    stateLabel: "构建失败",
    detail:
      "Jenkins rejected the build request (HTTP 403). Check the token permission, job membership, and CSRF crumb configuration before retrying.",
    queueUrl: null,
    buildUrl: null,
    params: {
      BRANCH: "feature_demo_mobile",
      ENV_PROFILE: "pre",
      IS_BUILD_MOBILE: "是",
    },
    createdAt: "2026-08-10 14:32",
    updatedAt: "2026-08-10 14:32",
  },
  ...smokeBuildTimeline,
];

function DocumentationProjectToolbar({ view }: { view: "build" | "git" }) {
  const metrics =
    view === "git"
      ? [
          { key: "projects", label: "项目", value: 10, icon: <PackageIcon fontSize="small" />, tone: "blue" as const },
          { key: "worktrees", label: "工作副本", value: 3, icon: <FolderIcon fontSize="small" />, tone: "cyan" as const },
          { key: "changed", label: "有变更", value: 1, tone: "violet" as const },
        ]
      : [
          { key: "projects", label: "项目", value: 4, icon: <PackageIcon fontSize="small" />, tone: "blue" as const },
          { key: "targets", label: "构建目标", value: 5, icon: <TerminalIcon fontSize="small" />, tone: "violet" as const },
          { key: "records", label: "构建记录", value: documentationBuildHistory.length, tone: "cyan" as const },
        ];

  return (
    <WorkspacePageToolbar
      className={`project-management-toolbar project-management-toolbar--${view}`}
      ariaLabel={view === "git" ? "项目 Git 概览与配置" : "项目构建概览与配置"}
      metrics={metrics}
      actions={
        <WorkspacePageToolbarAction
          startIcon={<SettingsIcon sx={{ fontSize: 14 }} />}
          onClick={() => undefined}
        >
          {view === "git" ? "Git 配置" : "构建配置"}
        </WorkspacePageToolbarAction>
      }
    />
  );
}

function DocumentationGitPage() {
  return (
    <Box className="project-management-page" aria-label="Git 文档截图页面">
      <DocumentationProjectToolbar view="git" />
      <Box className="project-management-view">
        <MergePage
          projects={documentationProjects}
          activeWorkspace={
            smokeWorkspaces.find((workspace) => workspace.key === "demo-workspace") ?? null
          }
          selectedProject="demo-console"
          onProjectChange={() => undefined}
          mode="sync"
          onModeChange={() => undefined}
          syncProjects={["demo-console"]}
          onSyncProjectsChange={() => undefined}
          syncSource="release_demo_202608"
          onSyncSourceChange={() => undefined}
          onClearSyncSource={() => undefined}
          syncTargets={["main"]}
          onSyncTargetsChange={() => undefined}
          createProjects={["demo-console"]}
          onCreateProjectsChange={() => undefined}
          createSource="release_demo_202608"
          onCreateSourceChange={() => undefined}
          onClearCreateSource={() => undefined}
          createTarget="feature_demo_mobile"
          onCreateTargetChange={() => undefined}
          onClearCreateTarget={() => undefined}
          checkoutSource="release_demo_202608"
          onCheckoutSourceChange={() => undefined}
          onClearCheckoutSource={() => undefined}
          checkoutDestinationDir="/mock/demo-workspace/demo-console"
          onCheckoutDestinationChange={() => undefined}
          onClearCheckoutDestination={() => undefined}
          onChooseCheckoutDirectory={() => undefined}
          switchTarget="main"
          onSwitchTargetChange={() => undefined}
          onClearSwitchTarget={() => undefined}
          pushAction="commitAndPush"
          onPushActionChange={() => undefined}
          pushCommitMessage="docs: refresh interface guide"
          onPushCommitMessageChange={() => undefined}
          pushSelectedPaths={[]}
          onPushSelectedPathsChange={() => undefined}
          pushStatus={null}
          pushStatusLoading={false}
          pushStatusError=""
          pushStatusUpdatedAtMs={Date.now()}
          worktrees={documentationWorktrees}
          worktreesLoading={false}
          worktreesError=""
          selectedWorktreePath={documentationWorktrees[0].repoPath}
          onWorktreePathChange={() => undefined}
          onChooseWorktreeDirectory={() => undefined}
          onRepairWorktree={() => undefined}
          onRefreshWorktrees={() => undefined}
          onRefreshPushStatus={() => undefined}
          onSyncBranches={() => undefined}
          sourceBranchEntries={documentationBranchEntries}
          targetBranchEntries={documentationBranchEntries}
          sourceBranchOptions={documentationBranchEntries.map((entry) => entry.name)}
          targetBranchOptions={documentationBranchEntries.map((entry) => entry.name)}
          busy=""
          currentBranchTaskHistoryId="branch-history-batch-latest"
          currentBranchTask={null}
          branchTaskHistory={smokeBranchHistory}
          onPlanSync={async () => null}
          onExecuteSync={() => undefined}
          onExecuteCreate={() => undefined}
          onExecuteCheckout={() => undefined}
          onExecuteSwitch={() => undefined}
          onExecutePush={() => undefined}
          onReplayBranchTaskHistory={() => undefined}
          workflowReceiveRules={[]}
          workflowBroadcastRules={[]}
          workflowReceiveSignalIdsForBranchReplay={() => []}
          workflowBroadcastSignalIdsForBranchReplay={() => []}
          workflowSignalOptions={[]}
          workflowSignalSummaries={[]}
          onWorkflowBranchReplayRulesChange={() => undefined}
          onWorkflowReceiveRulesEnabledChange={() => undefined}
          onWorkflowReceiveRulesDelete={() => undefined}
          onWorkflowBroadcastRulesEnabledChange={() => undefined}
          onWorkflowBroadcastRulesDelete={() => undefined}
          onWorkflowSignalDelete={() => undefined}
          onWorkflowSignalsClear={() => undefined}
          onRefreshBranchTaskHistory={() => undefined}
          onClearBranchTaskHistory={() => undefined}
          onOpenTaskOutput={() => undefined}
          formatRelativeTime={(value) => value ?? ""}
        />
      </Box>
    </Box>
  );
}

function DocumentationBuildPage() {
  return (
    <Box className="project-management-page" aria-label="Build 文档截图页面">
      <DocumentationProjectToolbar view="build" />
      <Box className="project-management-view">
        <BuildPage
          projects={documentationBuildProjects}
          activeWorkspaceKey="demo-workspace"
          selectedProject="demo-console"
          onProjectChange={() => undefined}
          target="standard"
          onTargetChange={() => undefined}
          targetMeta={documentationBuildTargetMeta}
          paramValues={documentationBuildParamValues}
          defaultParamValues={documentationBuildParamValues}
          onParamChange={() => undefined}
          contextLoading={false}
          contextError={false}
          contextErrorText=""
          onSyncBranches={() => undefined}
          sourceBranchEntries={documentationBranchEntries}
          sourceBranchOptions={documentationBranchEntries.map((entry) => entry.name)}
          branchSyncText="分支已同步"
          busy=""
          onTriggerBuild={() => undefined}
          plan={null}
          buildResult={null}
          buildResultUpdatedAtMs={0}
          currentBuildHistoryKey=""
          onRefreshBuild={() => undefined}
          onOpenBuildRecord={() => undefined}
          onOpenBuildUrl={() => undefined}
          buildHistory={documentationBuildHistory}
          onReplayBuildHistory={() => undefined}
          workflowReceiveRules={[]}
          workflowSignalIdsForBuildReplay={() => []}
          workflowSignalOptions={[]}
          workflowSignalSummaries={[]}
          onWorkflowBuildReplayReceiversChange={() => undefined}
          onWorkflowReceiveRulesEnabledChange={() => undefined}
          onWorkflowReceiveRulesDelete={() => undefined}
          onWorkflowSignalDelete={() => undefined}
          onWorkflowSignalsClear={() => undefined}
          onRefreshBuildHistory={() => undefined}
          onClearBuildHistory={() => undefined}
          formatRelativeTime={(value) => value ?? ""}
        />
      </Box>
    </Box>
  );
}

function DocumentationProjectsPage() {
  return (
    <Box aria-label="项目列表文档截图页面" sx={{ height: "100%", minHeight: 0 }}>
      <ProjectsPage
        mode="projectManagement"
        finderTypeOptions={["项目", "网站", "目录", "工具"]}
        finderType="项目"
        finderTypeCounts={{ 项目: documentationProjectRuntimeEntries.length, 网站: 0, 目录: 0, 工具: 0 }}
        onFinderTypeChange={() => undefined}
        finderCategories={["全部", "前端", "后端"]}
        finderCategory="全部"
        finderCategoryCounts={{ 全部: documentationProjectRuntimeEntries.length, 前端: 3, 后端: 1 }}
        onFinderCategoryChange={() => undefined}
        finderQuery=""
        onFinderQueryChange={() => undefined}
        runtimeEntries={documentationProjectRuntimeEntries}
        filteredRuntimeEntries={documentationProjectRuntimeEntries}
        shortcutEntries={[]}
        filteredShortcutEntries={[]}
        favoriteProjectKeys={["demo-console"]}
        recentProjectKeys={["demo-console", "demo-mobile"]}
        favoriteShortcutKeys={[]}
        recentShortcutKeys={[]}
        selectedDebugProfileKeys={{ "demo-console": "uat3-vke", "demo-mobile": "env_demo_pre" }}
        runtimeStartPromptMode="auto"
        workflowReceiveRules={[]}
        workflowBroadcastRules={[]}
        workflowSignalOptions={[]}
        workflowSignalSummaries={[]}
        workflowReceiveSignalIdsForProjectReplay={() => []}
        workflowBroadcastSignalIdsForProjectReplay={() => []}
        onWorkflowProjectReplayRulesChange={() => undefined}
        onWorkflowReceiveRulesEnabledChange={() => undefined}
        onWorkflowReceiveRulesDelete={() => undefined}
        onWorkflowBroadcastRulesEnabledChange={() => undefined}
        onWorkflowBroadcastRulesDelete={() => undefined}
        onWorkflowSignalDelete={() => undefined}
        onWorkflowSignalsClear={() => undefined}
        onToggleProjectFavorite={() => undefined}
        onToggleShortcutFavorite={() => undefined}
        onProjectDebugProfileChange={() => undefined}
        onRuntimeStartPromptModeChange={() => undefined}
        onMarkShortcutUsed={() => undefined}
        onRefresh={() => undefined}
        onOpenFinderEntry={() => false}
        onStartRuntime={() => undefined}
        onStopRuntime={() => undefined}
        onAdoptRuntime={() => undefined}
        onOpenBuildOutput={() => undefined}
        onFocusRuntime={() => undefined}
        onOpenProjectDirectory={() => undefined}
        configWorkspaceKey="demo-workspace"
        projectConfigPanel={{
          styleMode: "mono",
          onStyleModeChange: () => undefined,
          exitRuntimePolicy: "ask",
          onExitRuntimePolicyChange: () => undefined,
          selectedProjectKey: "demo-console",
          onOpenConfigDir: () => undefined,
          onOpenConfigFile: () => undefined,
          onOpenProjectWorkspacesDir: () => undefined,
          onOpenNavigationConfigFile: () => undefined,
          onCreateProjectWorkspace: () => undefined,
          projectWorkspaces: smokeWorkspaces,
          activeProjectWorkspaceKey: "demo-workspace",
          activePage: "projectManagement",
          enabledPages: ["overview", "knowledge", "projectManagement", "resources", "proxy"],
          onEnabledPagesChange: () => undefined,
          defaultPage: "overview",
          onDefaultPageChange: () => undefined,
          onProjectConfigSaved: () => undefined,
        }}
      />
    </Box>
  );
}

function DocumentationResourcesPage() {
  const toolEntries = documentationResourceEntries.filter(
    (item) => item.entry.kind === "tool",
  );
  return (
    <Box aria-label="资源入口文档截图页面" sx={{ height: "100%", minHeight: 0 }}>
      <ProjectsPage
        mode="resources"
        finderTypeOptions={["网站", "目录", "工具"]}
        finderType="工具"
        finderTypeCounts={{ 项目: 0, 网站: 2, 目录: 1, 工具: toolEntries.length }}
        onFinderTypeChange={() => undefined}
        finderCategories={["全部", "项目入口", "自动化", "外部系统"]}
        finderCategory="全部"
        finderCategoryCounts={{ 全部: documentationResourceEntries.length, 项目入口: 2, 自动化: 2, 外部系统: 1 }}
        onFinderCategoryChange={() => undefined}
        finderQuery=""
        onFinderQueryChange={() => undefined}
        runtimeEntries={[]}
        filteredRuntimeEntries={[]}
        shortcutEntries={documentationResourceEntries}
        filteredShortcutEntries={toolEntries}
        favoriteProjectKeys={[]}
        recentProjectKeys={[]}
        favoriteShortcutKeys={[]}
        recentShortcutKeys={[]}
        selectedDebugProfileKeys={{}}
        runtimeStartPromptMode="auto"
        workflowReceiveRules={[]}
        workflowBroadcastRules={[]}
        workflowSignalOptions={[]}
        workflowSignalSummaries={[]}
        workflowReceiveSignalIdsForProjectReplay={() => []}
        workflowBroadcastSignalIdsForProjectReplay={() => []}
        onWorkflowProjectReplayRulesChange={() => undefined}
        onWorkflowReceiveRulesEnabledChange={() => undefined}
        onWorkflowReceiveRulesDelete={() => undefined}
        onWorkflowBroadcastRulesEnabledChange={() => undefined}
        onWorkflowBroadcastRulesDelete={() => undefined}
        onWorkflowSignalDelete={() => undefined}
        onWorkflowSignalsClear={() => undefined}
        onToggleProjectFavorite={() => undefined}
        onToggleShortcutFavorite={() => undefined}
        onProjectDebugProfileChange={() => undefined}
        onRuntimeStartPromptModeChange={() => undefined}
        onMarkShortcutUsed={() => undefined}
        onRefresh={() => undefined}
        onOpenFinderEntry={() => false}
        onStartRuntime={() => undefined}
        onStopRuntime={() => undefined}
        onAdoptRuntime={() => undefined}
        onOpenBuildOutput={() => undefined}
        onFocusRuntime={() => undefined}
        onOpenProjectDirectory={() => undefined}
        onOpenResourceConfig={() => undefined}
        configWorkspaceKey="demo-workspace"
      />
    </Box>
  );
}

const smokeArchivedWorkspaces: ProjectWorkspaceSummary[] = [
  createSmokeWorkspace({
    key: "feature-archived",
    name: "已上线需求工作区",
    projectCount: 2,
    archived: true,
    archivedAt: "2026-07-28T08:00:00Z",
    archiveReason: "需求已上线",
  }),
];

let projectEditorState: ProjectConfigEditorState = {
  configPath: "/mock/projects.toml",
  runtimeConfigPath: null,
  runtimeProfileScope: "global",
  jenkinsProfiles: ["default"],
  defaultBranchRules: { sourceKeywords: [], targetKeywords: [] },
  runtimeProfiles: [
    {
      key: "browser-proxy",
      label: "Chrome + 本地代理",
      browser: "Google Chrome",
      browserProfile: "Default",
      browserUserDataDir: null,
      webActionsEnabled: true,
      webActionsPort: 9223,
      webActionsUserDataDir: null,
      browserArgsText: "",
      proxyUrl: "http://127.0.0.1:8791",
      rdevProxyProfileId: "smoke-proxy",
      proxyBypass: "localhost;127.0.0.1",
      hostResolverRulesText: "",
      networkProxy: {
        enabled: true,
        proxyUrl: "http://127.0.0.1:8791",
        injectEnv: true,
        nodeHook: true,
        noProxy: "localhost,127.0.0.1",
      },
    },
  ],
  projects: [
    {
      key: "demo",
      name: "Demo",
      category: "工作",
      repoPath: "/mock/demo",
      gitUrl: "",
      dev: { command: "npm run dev", cwd: null, outputDir: null, envCount: 0 },
      build: {
        command: "npm run build",
        cwd: null,
        outputDir: "/mock/demo/dist",
        envCount: 0,
      },
      focus: { autoOnStart: false },
      branchRules: { sourceKeywords: [], targetKeywords: [] },
      deployTargets: [
        {
          key: "standard",
          label: "标准部署",
          adapter: "jenkins",
          actionKind: "deploy",
          jenkinsProfile: "default",
          jobName: "Demo/demo",
          artifactOutputDir: "/mock/demo/jenkins-output",
          params: [],
        },
      ],
      debugProfiles: [],
    },
  ],
};

const runtimeSmokeEntry: ProjectRuntimeEntry = {
  key: "demo",
  name: "示例控制台",
  category: "工作",
  repoPath: "/mock/workspaces/feature/demo",
  command: "npm run dev -- --mode uat3-vke",
  cwd: "/mock/workspaces/feature/demo",
  focusUrl: "http://127.0.0.1:5173/",
  readyUrl: null,
  statusKey: "stopped",
  statusLabel: "未启动",
  detail: "项目已配置，等待启动",
  pid: null,
  startedAtMs: null,
  logPath: "/mock/logs/demo-dev.log",
  buildCommand: "npm run build",
  buildCwd: "/mock/workspaces/feature/demo",
  buildOutputDir: "/mock/workspaces/feature/demo/dist",
  buildStatusKey: "idle",
  buildStatusLabel: "待构建",
  buildDetail: "尚未执行构建",
  buildPid: null,
  buildStartedAtMs: null,
  buildLogPath: "/mock/logs/demo-build.log",
  updatedAtMs: Date.now(),
  canStart: true,
  canStop: false,
  canAdopt: false,
  canBuild: true,
  canStopBuild: false,
  canOpenBuildOutput: false,
  canFocusRuntime: false,
  debugProfiles: [
    {
      key: "uat3-vke",
      label: "UAT3 VKE",
      command: "npm run dev -- --mode uat3-vke",
      cwd: ".",
      expectedPort: 5173,
      focusUrl: "http://127.0.0.1:5173/",
      readyProbe: null,
      runtimeProfile: "browser-proxy",
      env: {
        APP_ENV: "uat3-vke",
        API_REGION: "uat3",
      },
      envCount: 2,
      localFileCount: 1,
      browser: null,
      browserProfile: null,
      browserUserDataDir: null,
      browserArgs: [],
      networkProxy: {
        enabled: false,
        proxyUrl: "",
        injectEnv: true,
        nodeHook: false,
        noProxy: "localhost,127.0.0.1",
      },
      localProxy: {
        enabled: false,
        listen: "127.0.0.1:4173",
        frontendUrl: "http://127.0.0.1:5173",
        upstreamProxy: "",
        routes: [],
        authHelper: {
          enabled: false,
          path: "",
          redirectPath: "",
          items: [],
        },
      },
    },
  ],
};
runtimeSmokeEntry.debugProfiles.push({
  ...runtimeSmokeEntry.debugProfiles[0],
  key: "env_demo_pre",
  label: "DC2 VKE",
  command: "npm run dev -- --mode env_demo_pre",
  expectedPort: 5174,
  focusUrl: "http://127.0.0.1:5174/",
  env: {
    APP_ENV: "env_demo_pre",
    API_REGION: "dc2",
  },
});

const documentationProjectRuntimeEntries: ProjectRuntimeEntry[] = [
  {
    ...runtimeSmokeEntry,
    key: "demo-console",
    name: "示例控制台",
    category: "前端",
    repoPath: "/mock/demo-workspace/demo-console",
    cwd: "/mock/demo-workspace/demo-console",
    statusKey: "running",
    statusLabel: "运行中",
    detail: "http://127.0.0.1:5173 已通过 HTTP 验证",
    pid: 42180,
    startedAtMs: Date.now() - 42 * 60_000,
    canStart: false,
    canStop: true,
    canFocusRuntime: true,
    buildStatusKey: "succeeded",
    buildStatusLabel: "构建完成",
    buildDetail: "dist 已生成",
  },
  {
    ...runtimeSmokeEntry,
    key: "demo-mobile",
    name: "示例移动端",
    category: "前端",
    repoPath: "/mock/demo-workspace/demo-mobile",
    cwd: "/mock/demo-workspace/demo-mobile",
    command: "pnpm dev --host 127.0.0.1",
    focusUrl: "http://127.0.0.1:5174/",
    statusKey: "stopped",
    statusLabel: "未启动",
    detail: "选择 UAT3 VKE 启动档案后可启动",
    buildStatusKey: "idle",
    buildStatusLabel: "待构建",
    buildDetail: "尚未执行构建",
  },
  {
    ...runtimeSmokeEntry,
    key: "demo-service",
    name: "示例服务",
    category: "后端",
    repoPath: "/mock/demo-workspace/demo-service",
    cwd: "/mock/demo-workspace/demo-service",
    command: "npm run start:dev",
    focusUrl: "http://127.0.0.1:8080/",
    statusKey: "external",
    statusLabel: "运行中（外部）",
    detail: "端口 8080 由外部进程监听，可先检查归属",
    pid: 42201,
    canStart: false,
    canStop: false,
    canAdopt: true,
    canFocusRuntime: true,
  },
  {
    ...runtimeSmokeEntry,
    key: "demo-admin",
    name: "示例管理台",
    category: "前端",
    repoPath: "/mock/demo-workspace/demo-admin",
    cwd: "/mock/demo-workspace/demo-admin",
    command: "",
    focusUrl: "",
    statusKey: "notConfigured",
    statusLabel: "待配置",
    detail: "缺少启动命令，先进入项目配置补齐",
    canStart: false,
    canStop: false,
    canFocusRuntime: false,
  },
];

const documentationResourceEntries: FinderShortcutItem[] = [
  {
    categoryTitle: "项目入口",
    categoryLabel: "网站",
    sourceId: "default",
    entry: {
      name: "示例控制台 Pre",
      kind: "url",
      targetLabel: "预发环境",
      url: "https://demo.example.test/console",
      browser: "Google Chrome",
      browserProfile: "Default",
      runtimeProfile: "browser-proxy",
      note: "打开预发控制台并使用共享浏览器代理。",
    },
  },
  {
    categoryTitle: "项目入口",
    categoryLabel: "目录",
    sourceId: "default",
    entry: {
      name: "需求资料目录",
      kind: "directory",
      targetLabel: "工作区资料",
      path: "/mock/demo-workspace/resources",
      note: "需求文档、工作日志和联调材料。",
    },
  },
  {
    categoryTitle: "自动化",
    categoryLabel: "工具",
    sourceId: "default",
    entry: {
      name: "批量部署 Pre",
      kind: "tool",
      targetLabel: "部署动作",
      tool: "action",
      toolKey: "batch-deploy-pre",
      toolAction: "run",
      note: "选择项目和分支，检查计划后执行。",
    },
  },
  {
    categoryTitle: "自动化",
    categoryLabel: "工具",
    sourceId: "default",
    entry: {
      name: "示例联调链路",
      kind: "tool",
      targetLabel: "Link",
      tool: "link",
      toolKey: "demo-debug",
      toolAction: "run",
      note: "按顺序启动代理、Runtime 并打开页面。",
    },
  },
  {
    categoryTitle: "外部系统",
    categoryLabel: "网站",
    sourceId: "default",
    entry: {
      name: "Jenkins 示例 Job",
      kind: "url",
      targetLabel: "CI",
      url: "https://ci.example.test/job/demo-console",
      note: "打开项目构建任务。",
    },
  },
];

const smokeWorkspacePushAction: TrayPinnedAction = {
  kind: "branch.replay",
  label: "推送功能分支",
  workspaceKey: "feature_demo_checkout",
  projectKey: "demo",
  payload: {
    command: "execute_branch_push_task",
    request: {
      project: "demo",
      repoPath: "/mock/workspaces/feature/demo",
    },
  },
  dedupeKey: "branch:push:demo",
  updatedAtMs: Date.parse("2026-07-29T09:30:00+08:00"),
};

const smokeWorkspaceBuildAction: TrayPinnedAction = {
  kind: "build.replay",
  label: "构建 VKE",
  workspaceKey: "feature_demo_checkout",
  projectKey: "demo",
  payload: {
    project: "demo",
    target: "vke",
    params: { BRANCH: "feature/REQ-1234" },
  },
  dedupeKey: "build:demo:vke",
  updatedAtMs: Date.parse("2026-07-29T09:32:00+08:00"),
};

const smokeWorkspaceWorkflowChain: WorkspaceWorkflowChain = {
  id: "smoke-delivery",
  workspaceKey: "feature_demo_checkout",
  name: "推送并构建",
  enabled: true,
  steps: [
    {
      id: "push",
      label: smokeWorkspacePushAction.label,
      action: smokeWorkspacePushAction,
    },
    {
      id: "build",
      label: smokeWorkspaceBuildAction.label,
      action: smokeWorkspaceBuildAction,
    },
  ],
  createdAt: "2026-07-29T01:30:00.000Z",
  updatedAt: "2026-07-29T01:32:00.000Z",
};

const smokeWorkspaceWorkflowRunState: WorkspaceWorkflowRunState = {
  chainId: smokeWorkspaceWorkflowChain.id,
  runId: `workspace-chain:${smokeWorkspaceWorkflowChain.id}:smoke`,
  status: "running",
  completedStepCount: 1,
  totalStepCount: 2,
  activeStepLabel: "构建 VKE",
  detail: "正在等待构建任务进入队列",
  updatedAt: "2026-07-29T01:33:00.000Z",
};

function createWorkspaceIndexOverviewFixture({
  key,
  name,
  description,
  workspaceType,
  workspaceTypeLabel,
  projectCount,
  entryCount,
  actionCount,
}: {
  key: string;
  name: string;
  description: string;
  workspaceType: string;
  workspaceTypeLabel: string;
  projectCount: number;
  entryCount: number;
  actionCount: number;
}) {
  return {
    key,
    name,
    description,
    system: false,
    runtimeConfigSourceId: `workspace-${key}`,
    runtimeConfigSourceName: `${name}运行配置`,
    runtimeConfigSourceKind: "workspace",
    runtimeConfigPath: `/mock/workspaces/${key}/runtime_overrides.toml`,
    runtimeProfileScope: "workspaceOverride",
    rootDir: `/mock/workspaces/${key}`,
    resourceDir: `/mock/workspaces/${key}/resources`,
    worklogPath: `/mock/workspaces/${key}/resources/WORKLOG.md`,
    worklogExists: true,
    worklogAutoRecord: true,
    workspaceKind: "directory",
    workspaceType,
    workspaceTypeLabel,
    projectCount,
    entryCount,
    actionCount,
    proxyProfileCount: 0,
    resources: [],
    projectDirectories: [],
    proxyProfiles: [],
    actions: [],
  };
}

const workspaceRuntimeOverview = [
  {
    key: "system",
    name: "系统工作区",
    description: "显示全部工作区、项目和自动化入口。",
    system: true,
    runtimeConfigSourceId: "global",
    runtimeConfigSourceName: "全局配置",
    runtimeConfigSourceKind: "global",
    runtimeConfigPath: "/mock/config.toml",
    runtimeProfileScope: "global",
    rootDir: null,
    resourceDir: null,
    worklogPath: null,
    worklogExists: false,
    worklogAutoRecord: false,
    workspaceKind: "global",
    workspaceType: "system",
    workspaceTypeLabel: "全局",
    projectCount: 22,
    entryCount: 90,
    actionCount: 8,
    proxyProfileCount: 4,
    resources: [
      {
        key: "global-rdevtool-app",
        workspaceKey: "r-series",
        configSourceId: "global",
        category: "开发资源",
        label: "rDevTool App",
        kind: "directory",
        kindLabel: "目录",
        value: "/mock/r-series/rdevtool",
        detail: "R系列开发",
        openKind: "localPath",
        openable: true,
      },
      {
        key: "global-automation-docs",
        workspaceKey: "feature_demo_exchange",
        configSourceId: "global",
        category: "项目资料",
        label: "自动化知识库",
        kind: "url",
        kindLabel: "网站",
        value: "http://127.0.0.1:8888/",
        detail: "权益兑换工作区",
        openKind: "url",
        openable: true,
      },
      {
        key: "global-release-port-tool",
        workspaceKey: "r-series",
        configSourceId: "global",
        toolConfigSourceId: "global",
        category: "工具",
        label: "释放本地端口",
        kind: "tool",
        kindLabel: "工具",
        value: "release-local-port",
        detail: "清理被占用的本地开发端口",
        tool: "action",
        toolKey: "release-local-port",
        toolAction: "run",
        openKind: null,
        openable: false,
      },
    ],
    projectDirectories: [
      {
        projectKey: "pending-directory",
        projectName: "待配置项目",
        mode: "default",
        modeLabel: "项目目录",
        path: null,
        managed: false,
        statusKey: "missing",
        statusLabel: "目录待配置",
        running: false,
        canStart: false,
        canStop: false,
        canFocusRuntime: false,
      },
      {
        projectKey: "demo",
        projectName: "示例控制台",
        mode: "default",
        modeLabel: "全局项目",
        path: "/mock/demo",
        managed: false,
        statusKey: "stopped",
        statusLabel: "未启动",
        running: false,
        canStart: true,
        canStop: false,
        canFocusRuntime: false,
      },
    ],
    proxyProfiles: [
      {
        configSourceId: "global",
        id: "global-local-debug",
        name: "全局本地联调代理",
        listenHost: "127.0.0.1",
        listenPort: 8787,
        listenUrl: "http://127.0.0.1:8787",
        workspaceKey: null,
        workspaceLabel: "全局",
        ruleCount: 34,
        running: false,
        startedAt: null,
      },
    ],
    actions: [],
  },
  createWorkspaceIndexOverviewFixture({
    key: "feature_demo_exchange",
    name: "REQ-1234 全流量权益兑换流程优化V1.1",
    description:
      "REQ-1234 全流量权益兑换流程优化V1.1 专用工作区；关联分支 feature_demo_WORKSPACE。",
    workspaceType: "business",
    workspaceTypeLabel: "业务",
    projectCount: 1,
    entryCount: 10,
    actionCount: 3,
  }),
  createWorkspaceIndexOverviewFixture({
    key: "r-series",
    name: "R系列",
    description: "R 系列工具开发工作区，只显示当前工具家族相关项目和少量通用入口。",
    workspaceType: "custom",
    workspaceTypeLabel: "未分类",
    projectCount: 11,
    entryCount: 4,
    actionCount: 1,
  }),
  createWorkspaceIndexOverviewFixture({
    key: "release-20260716",
    name: "工作项目",
    description: "非 R 系列工作项目。",
    workspaceType: "custom",
    workspaceTypeLabel: "未分类",
    projectCount: 11,
    entryCount: 3,
    actionCount: 0,
  }),
  {
    key: "feature_demo_checkout",
    name: "示例需求工作区",
    description: "工作区运行来源烟雾测试",
    system: false,
    runtimeConfigSourceId: "workspace-feature",
    runtimeConfigSourceName: "需求工作区运行配置",
    runtimeConfigSourceKind: "workspace",
    runtimeConfigPath: "/mock/workspaces/feature/runtime_overrides.toml",
    runtimeProfileScope: "workspaceOverride",
    rootDir: "/mock/workspaces/feature",
    resourceDir: "/mock/workspaces/feature/resources",
    worklogPath: "/mock/workspaces/feature/resources/WORKLOG.md",
    worklogExists: true,
    worklogAutoRecord: true,
    workspaceKind: "directory",
    workspaceType: "business",
    workspaceTypeLabel: "业务",
    projectCount: 1,
    entryCount: 1,
    actionCount: 2,
    proxyProfileCount: 0,
    resources: [
      {
        key: "feature-resource-action-batch-deploy-pre",
        workspaceKey: "feature_demo_checkout",
        configSourceId: "workspace-feature",
        toolConfigSourceId: "workspace-feature",
        category: "工具",
        label: "批量部署 Pre",
        kind: "tool",
        kindLabel: "工具",
        value: "batch-deploy-pre",
        detail: "选择项目和分支，检查计划后执行",
        tool: "action",
        toolKey: "batch-deploy-pre",
        toolAction: "run",
        openKind: null,
        openable: false,
      },
    ],
    projectDirectories: [
      {
        projectKey: "demo",
        projectName: "示例控制台",
        mode: "managed",
        modeLabel: "工作区副本",
        path: "/mock/workspaces/feature/demo",
        managed: true,
        statusKey: "stopped",
        statusLabel: "未启动",
        running: false,
        canStart: true,
        canStop: false,
        canFocusRuntime: false,
      },
    ],
    proxyProfiles: [],
    actions: [
      {
        action: smokeWorkspacePushAction,
        kindLabel: "Git",
        label: smokeWorkspacePushAction.label,
        detail: "demo · 当前分支",
        projectKey: "demo",
        params: [],
        confirmRequired: true,
        updatedAtMs: smokeWorkspacePushAction.updatedAtMs,
      },
      {
        action: smokeWorkspaceBuildAction,
        kindLabel: "构建",
        label: smokeWorkspaceBuildAction.label,
        detail: "demo · vke",
        projectKey: "demo",
        params: [{ label: "BRANCH", value: "feature/REQ-1234" }],
        confirmRequired: true,
        updatedAtMs: smokeWorkspaceBuildAction.updatedAtMs,
      },
    ],
  },
];

const workspaceRuntimeEditor = {
  workspace: {
    key: "feature_demo_checkout",
    name: "示例需求工作区",
    description: "工作区运行来源烟雾测试",
    system: false,
    workspaceType: "business",
    workspaceTypeLabel: "业务",
    rootDir: "/mock/workspaces/feature",
    resourceDir: "/mock/workspaces/feature/resources",
    worklogFile: "WORKLOG.md",
    worklogAutoRecord: true,
    includeAllProjects: false,
    includeAllNavigation: false,
    projects: ["demo"],
    navigationCategories: [],
    navigationEntries: [],
    proxyProfiles: [],
    projectInstances: [
      {
        project: "demo",
        path: "/mock/workspaces/feature/demo",
        managed: true,
      },
    ],
    resourceCategories: [
      {
        title: "工作区资料",
        shortLabel: "资料",
        entries: [
          {
            name: "资料目录",
            kind: "directory",
            path: "/mock/workspaces/feature/resources",
            note: "工作区文档、附件、脚本和软链接",
          },
          {
            name: "工作日志",
            kind: "file",
            path: "/mock/workspaces/feature/resources/WORKLOG.md",
            note: "需求优化、问题修复和关键决策记录",
          },
        ],
      },
      {
        title: "联调入口",
        shortLabel: "联调",
        entries: [
          {
            name: "玩法规则联调页",
            kind: "url",
            url: "http://127.0.0.1:4173/#/debug/gameplay-rules",
            browser: "current_chrome",
            note: "工作区专属的玩法规则预览页",
          },
          {
            name: "活动规则联调页",
            kind: "url",
            url: "http://127.0.0.1:4173/#/debug/activity-rules",
            browser: "current_chrome",
            note: "工作区专属的活动规则预览页",
          },
        ],
      },
    ],
  },
  projects: [
    {
      key: "demo",
      name: "示例控制台",
      category: "工作",
      repoPath: "/mock/demo",
      selected: true,
    },
  ],
  navigationCategories: [],
  proxyProfiles: [],
};

const runtimeSmokeContext: ProjectRuntimeContextSnapshot = {
  schemaVersion: 2,
  workspace: {
    key: "feature_demo_checkout",
    name: "示例需求工作区",
    system: false,
    projectInstancePath: "/mock/workspaces/feature/demo",
    projectInstanceManaged: true,
    runtimeConfigSourceId: "workspace-feature_demo_checkout",
    runtimeConfigSourceName: "优客贷车后场景配置",
    runtimeConfigSourceKind: "workspace",
    runtimeConfigPath: "/mock/workspaces/feature/runtime_overrides.toml",
    runtimeProfileScope: "workspaceOverride",
  },
  requested: {
    projectKey: "demo",
    debugProfileKey: "uat3-vke",
    runtimeProfileKey: null,
    command: null,
    expectedPort: null,
    envKeys: [],
  },
  effective: {
    debugProfileKey: "uat3-vke",
    debugProfileLabel: "UAT3 VKE",
    runtimeProfileKey: "browser-proxy",
    runtimeProfileLabel: "Chrome + 本地代理",
    environment: [
      {
        key: "API_REGION",
        value: "uat3",
        source: "debugProfile.uat3-vke",
        masked: false,
      },
      {
        key: "APP_ENV",
        value: "uat3-vke",
        source: "debugProfile.uat3-vke",
        masked: false,
      },
      {
        key: "HTTP_PROXY",
        value: "http://127.0.0.1:8791",
        source: "runtimeProfile.networkProxy",
        masked: false,
      },
    ],
    browserSource: "runtimeProfile",
    proxySource: "runtimeProfile",
    target: {
      command: "npm run dev -- --mode uat3-vke",
      commandSource: "debugProfile",
      cwd: "/mock/workspaces/feature/demo",
      cwdSource: "workspaceProjectInstance.debugProfile",
      expectedPort: 5173,
      expectedPortSource: "debugProfile",
      focusUrl: "http://127.0.0.1:5173/",
      focusUrlSource: "debugProfile",
      readyProbe: null,
    },
  },
  observed: { available: true, sessions: [] },
  status: {
    key: "configured",
    label: "目标已解析",
    success: true,
    terminal: false,
    detail: "Runtime Target 已解析，当前未观测到运行会话。",
  },
  evidence: [],
  risks: [],
  managedArtifacts: [],
  recommendedActions: [],
};

const runtimeSmokePreflight: ProjectRuntimePreflightResponse = {
  projectKey: "demo",
  projectName: "示例控制台",
  debugProfileKey: "uat3-vke",
  debugProfileLabel: "UAT3 VKE",
  runtimeProfileKey: "browser-proxy",
  runtimeProfileLabel: "Chrome + 本地代理",
  statusKey: "warning",
  statusLabel: "可优化",
  summary: "1 个关注项",
  target: runtimeSmokeContext.effective.target,
  checks: [
    {
      key: "devCommand",
      title: "启动命令",
      category: "runtime",
      statusKey: "ok",
      statusLabel: "正常",
      detail: "npm run dev -- --mode uat3-vke",
      action: null,
    },
    {
      key: "networkProxy",
      title: "Node 网络代理",
      category: "network",
      statusKey: "info",
      statusLabel: "可选",
      detail: "当前未注入 Node 侧代理",
      action: "联调接口需要代理时，可在运行配置中启用。",
    },
    {
      key: "runtimeProxy",
      title: "本地代理服务",
      category: "network",
      statusKey: "warning",
      statusLabel: "未启动",
      detail: "本地联调代理尚未监听 http://127.0.0.1:8791",
      action: "可先启动该代理，再重新执行启动预检。",
      fix: {
        kind: "startProxy",
        label: "启动代理",
        description: "启动本地联调代理，成功后重新检查项目运行条件。",
        confirmationRequired: true,
        sourceId: "workspace-proxy",
        sourceName: "工作区代理",
        profileId: "local-debug",
        profileName: "本地联调代理",
        listenUrl: "http://127.0.0.1:8791",
      },
    },
  ],
};
let runtimePreflightMockCount = 0;
let runtimeSmokeProxyRunning = false;
let runtimeSmokePortConflict = false;
let runtimeSmokeProfileRepairMode: "" | "create" | "reset" = "";
let workspaceInstanceRepairMode = false;

const configFileDefinitions = [
  {
    key: "navigation",
    label: "资源入口",
    capability: "resource",
    fileName: "navigation.toml",
  },
  {
    key: "actions",
    label: "参数化 Action",
    capability: "resource",
    fileName: "actions.toml",
  },
  { key: "links", label: "链路", capability: "link", fileName: "links.toml" },
  { key: "proxy", label: "代理", capability: "proxy", fileName: "proxy.toml" },
  {
    key: "runtimeOverrides",
    label: "运行环境覆盖",
    capability: "runtime",
    fileName: "runtime_overrides.toml",
  },
] as const;

function configSourceFiles(baseDir: string): ConfigSource["files"] {
  return {
    navigation: `${baseDir}/navigation.toml`,
    actions: `${baseDir}/actions.toml`,
    links: `${baseDir}/links.toml`,
    proxy: `${baseDir}/proxy.toml`,
    runtimeOverrides: `${baseDir}/runtime_overrides.toml`,
  };
}

let mockSources: ConfigSource[] = [
  {
    id: "default",
    name: "默认配置",
    kind: "default",
    baseDir: "/mock/default",
    files: configSourceFiles("/mock/default"),
    uiProfile: "resource-basic",
    capabilities: ["resource", "link", "proxy", "runtime"],
    isDefault: true,
  },
  {
    id: "team",
    name: "团队配置",
    kind: "custom",
    baseDir: "/mock/team",
    files: configSourceFiles("/mock/team"),
    uiProfile: "resource-basic",
    capabilities: ["resource", "link", "proxy", "runtime"],
    isDefault: false,
  },
  {
    id: "workspace-feature-archived",
    name: "已上线需求工作区 配置",
    kind: "workspace",
    workspaceKey: "feature-archived",
    workspaceArchived: true,
    baseDir: "/mock/workspace-feature-archived",
    files: configSourceFiles("/mock/workspace-feature-archived"),
    uiProfile: "resource-basic",
    capabilities: ["resource", "link", "proxy", "runtime"],
    isDefault: false,
  },
];

const smokeProxyDashboard: ProxyDashboard = {
  configPath: "/mock/default/proxy.toml",
  config: {
    profiles: [
      {
        id: "smoke-proxy",
        workspaceKey: "feature_demo_checkout",
        name: "示例本地代理",
        listenHost: "127.0.0.1",
        listenPort: 8791,
        upstreamBaseUrl: "",
        upstreamProxy: "",
        captureBody: true,
        maxBodyBytes: 262_144,
      },
    ],
    rules: [
      {
        id: "smoke-rule-orders",
        profileId: "smoke-proxy",
        enabled: true,
        name: "订单查询 Mock",
        priority: 10,
        method: "GET",
        urlContains: "",
        pathPrefix: "/api/orders",
        headerName: "",
        headerContains: "",
        action: {
          kind: "mock",
          status: 200,
          contentType: "application/json; charset=utf-8",
          body: '{"ok":true}',
          headers: {},
          delayMs: 0,
        },
      },
      {
        id: "smoke-rule-profile",
        profileId: "smoke-proxy",
        enabled: false,
        name: "用户资料 Mock",
        priority: 20,
        method: "ANY",
        urlContains: "",
        pathPrefix: "/api/profile",
        headerName: "",
        headerContains: "",
        action: {
          kind: "mock",
          status: 200,
          contentType: "application/json; charset=utf-8",
          body: '{"name":"demo"}',
          headers: {},
          delayMs: 0,
        },
      },
    ],
  },
  statuses: [
    {
      profileId: "smoke-proxy",
      running: true,
      managed: false,
      versionCompatible: false,
      listenUrl: "http://127.0.0.1:8791",
      pid: null,
      startedAt: null,
      owner: "node (PID 42194)",
      detail: "port is listening but is not owned by rDevTool daemon",
    },
  ],
  events: [],
};

const managedArtifactInventory: ManagedArtifactInventoryResponse = {
  schemaVersion: 1,
  requested: { workspace: null, allWorkspaces: true, project: null, kinds: [] },
  effective: {
    workspaceKeys: smokeWorkspaces.map((workspace) => workspace.key),
    project: null,
    kinds: [],
    collectors: ["workspaceConfig", "runtimeDaemon", "proxyDaemon"],
  },
  observed: {
    artifacts: [
      {
        id: "artifact-smoke-proxy",
        source: "proxyDaemon",
        artifact: {
          kind: "proxyState",
          path: "/mock/proxy-runtime/proxy-smoke.json",
          ownership: "rdevtool",
          lifecycle: "proxySession",
        },
        workspaceKey: "system",
        projectKey: null,
        runId: null,
        scopePath: "/mock/proxy.toml",
        exists: true,
        objectType: "file",
        active: false,
        ownershipVerified: true,
        detail: "profile=smoke-proxy pid=42 compatible=true",
      },
    ],
    references: [],
    summary: {
      artifactCount: 1,
      existingCount: 1,
      missingCount: 0,
      activeCount: 0,
      referenceCount: 0,
    },
  },
  status: {
    key: "observed",
    label: "托管产物已盘点",
    success: true,
    terminal: true,
    detail: "发现 1 条托管产物和 0 条非托管引用",
  },
  evidence: [],
  risks: [],
  managedArtifacts: [
    {
      kind: "proxyState",
      path: "/mock/proxy-runtime/proxy-smoke.json",
      ownership: "rdevtool",
      lifecycle: "proxySession",
    },
  ],
  recommendedActions: [],
};

const managedWorkspaceInstanceInventory: ManagedArtifactInventoryResponse = {
  ...managedArtifactInventory,
  requested: {
    workspace: "feature_demo_checkout",
    allWorkspaces: false,
    project: "demo",
    kinds: ["workspaceProjectInstance"],
  },
  effective: {
    ...managedArtifactInventory.effective,
    workspaceKeys: ["feature_demo_checkout"],
    project: "demo",
    kinds: ["workspaceProjectInstance"],
  },
  observed: {
    artifacts: [
      {
        id: "artifact-smoke-workspace-instance",
        source: "workspaceConfig",
        artifact: {
          kind: "workspaceProjectInstance",
          path: "/mock/workspaces/feature/demo",
          ownership: "rdevtool",
          lifecycle: "workspace",
        },
        workspaceKey: "feature_demo_checkout",
        projectKey: "demo",
        runId: null,
        scopePath: "/mock/workspaces/feature/demo",
        exists: true,
        objectType: "directory",
        active: false,
        ownershipVerified: true,
        detail: "工作区项目实例显式记录 managed=true",
      },
    ],
    references: [],
    summary: {
      artifactCount: 1,
      existingCount: 1,
      missingCount: 0,
      activeCount: 0,
      referenceCount: 0,
    },
  },
  managedArtifacts: [
    {
      kind: "workspaceProjectInstance",
      path: "/mock/workspaces/feature/demo",
      ownership: "rdevtool",
      lifecycle: "workspace",
    },
  ],
};

const managedArtifactCleanupPlan: ManagedArtifactCleanupPlanResponse = {
  schemaVersion: 1,
  requested: {
    workspace: null,
    allWorkspaces: true,
    project: null,
    kinds: [],
    artifactIds: [],
  },
  effective: {
    workspaceKeys: smokeWorkspaces.map((workspace) => workspace.key),
    selectedArtifactIds: ["artifact-smoke-proxy"],
    missingArtifactIds: [],
    executionSupported: false,
  },
  observed: {
    actions: [
      {
        artifactId: "artifact-smoke-proxy",
        kind: "proxyState",
        path: "/mock/proxy-runtime/proxy-smoke.json",
        action: "removeFile",
        eligibility: "eligible",
        destructive: true,
        reason: "路径位于 rDevTool 受管目录且当前未活动",
        prerequisites: ["执行前重新读取当前观测"],
      },
    ],
    eligibleCount: 1,
    reviewRequiredCount: 0,
    blockedCount: 0,
  },
  status: {
    key: "planned",
    label: "清理评估已生成",
    success: true,
    terminal: true,
    detail: "已生成 1 条只读清理评估",
  },
  evidence: [],
  risks: [],
  managedArtifacts: managedArtifactInventory.managedArtifacts,
  recommendedActions: [],
};

function findMockSource(sourceId: string) {
  const source = mockSources.find((item) => item.id === sourceId);
  if (!source) {
    throw new Error(`未知配置源：${sourceId}`);
  }
  return source;
}

function inspectMockSource(sourceId: string): ConfigSourceInspection {
  const source = findMockSource(sourceId);
  const files: ConfigSourceFileInspection[] = configFileDefinitions.map(
    (file) => {
      const supported = source.capabilities.includes(file.capability);
      return {
        key: file.key,
        label: file.label,
        capability: file.capability,
        path: source.files[file.key],
        supported,
        exists: supported,
        status: supported ? "ready" : "unsupported",
        message: supported ? "文件可用" : "未启用该能力",
      };
    },
  );

  return {
    source,
    definition: source.isDefault
      ? null
      : {
          id: source.id,
          name: source.name,
          kind: "custom",
          baseDir: source.baseDir,
          files: Object.fromEntries(
            configFileDefinitions.map((file) => [file.key, file.fileName]),
          ),
          uiProfile: source.uiProfile,
          capabilities: [...source.capabilities],
        },
    editable: !source.isDefault,
    registryPath: "/mock/config_sources.toml",
    status: "ready",
    summary: "配置文件完整，可正常使用",
    issues: [],
    files,
    runtimeProfileScope: source.isDefault ? "global" : "override",
  };
}

function compareMockSources(
  leftSourceId: string,
  rightSourceId: string,
): ConfigSourceComparison {
  const left = findMockSource(leftSourceId);
  const right = findMockSource(rightSourceId);
  return {
    left: { id: left.id, name: left.name, kind: left.kind },
    right: { id: right.id, name: right.name, kind: right.kind },
    identical: false,
    summary: {
      total: configFileDefinitions.length,
      matching: configFileDefinitions.length - 1,
      differing: 1,
      missingLeft: 0,
      missingRight: 0,
      missingBoth: 0,
      capabilityMismatches: 0,
    },
    files: configFileDefinitions.map((file, index) => {
      const equivalent = index !== 0;
      return {
        key: file.key,
        capability: file.capability,
        left: { supported: true, exists: true, sizeBytes: 128 + index },
        right: {
          supported: true,
          exists: true,
          sizeBytes: equivalent ? 128 + index : 256,
        },
        sizeEqual: equivalent,
        contentEqual: equivalent,
        equivalent,
        status: equivalent ? "matching" : "differing",
        summary: equivalent ? "文件内容一致" : "文件内容不同",
      };
    }),
  };
}

function copyMockSource(
  request: ConfigSourceCopyRequest,
): ConfigSourceCopyResult {
  const source = findMockSource(request.sourceId);
  const baseDir = request.baseDir?.trim() || `/mock/${request.id}`;
  const target: ConfigSource = {
    id: request.id,
    name: request.name,
    kind: "custom",
    baseDir,
    files: configSourceFiles(baseDir),
    uiProfile: source.uiProfile,
    capabilities: [...source.capabilities],
    isDefault: false,
  };
  mockSources = [
    ...mockSources.filter((item) => item.id !== target.id),
    target,
  ];
  return {
    source: { id: source.id, name: source.name, kind: source.kind },
    target,
    copiedCount: configFileDefinitions.length,
    missingCount: 0,
    files: configFileDefinitions.map((file, index) => ({
      key: file.key,
      capability: file.capability,
      status: "copied",
      sizeBytes: 128 + index,
    })),
  };
}

function smokeHealthSnapshot() {
  return {
    schemaVersion: 1,
    generatedAtMs: Date.now(),
    statusKey: "warning",
    statusLabel: "需要关注",
    summary: "发现 1 个需要关注的问题",
    identity: {
      executablePath: "/Applications/rDevTool.app/Contents/MacOS/rdevtool",
      installKind: "app",
      version: "0.1.0",
      buildCommit: "019facef1234",
      buildDirty: false,
      buildProfile: "release",
      currentSourceCommit: "019facef1234",
      currentSourceDirty: false,
      sourceCommitMatchesBuild: true,
    },
    storageTotalBytes: 2_621_440,
    storage: [
      {
        key: "notes",
        label: "知识笔记",
        path: "/mock/notes",
        exists: true,
        objectType: "directory",
        sizeBytes: 16_384,
        fileCount: 3,
        largestFilePath: "/mock/notes/project.md",
        largestFileBytes: 8_192,
        statusKey: "ok",
        detail: "3 个文件",
      },
    ],
    risks: [
      {
        code: "runtimeLogOversized",
        severity: "warning",
        summary: "存在超过轮转阈值的运行日志",
        detail: "/mock/runtime-logs/demo.log 将在对应项目下次启动或重启时轮转",
      },
    ],
    recommendedActions: [
      {
        command: "rdevtool --json artifacts cleanup-plan --kind runtimeLog",
        reason: "先查看日志归属与活动状态，再决定是否清理",
        risk: "readOnly",
      },
    ],
  };
}

const mockRolledBackConfigPackTransactions = new Set<string>([
  "20260810T090000Z-oldbaseline",
]);
let mockConfigPackApplied = false;

function getMockConfigPackHistory() {
  const transactions = [
    ...(mockConfigPackApplied
      ? [
          {
            transactionId: "20260813T120000Z-123456789abc",
            createdAt: "2026-08-13T12:00:00Z",
            packName: "Team Development Baseline",
            packPath: "/mock/team.rdtpack",
            packSha256: "pack-sha256",
            planHash: "rdtpack-ready-plan",
            changedPaths: [
              "/mock/config/projects.toml",
              "/mock/config/workspaces/feature-a.toml",
            ],
            appliedCount: 2,
            skippedCount: 0,
            rolledBackAt: null,
          },
        ]
      : []),
    {
      transactionId: "20260812T103000Z-activebaseline",
      createdAt: "2026-08-12T10:30:00Z",
      packName: "Local Workbench Baseline",
      packPath: "/mock/local-workbench.rdtpack",
      packSha256: "local-pack-sha256",
      planHash: "rdtpack-local-plan",
      changedPaths: ["/mock/config/projects.toml"],
      appliedCount: 3,
      skippedCount: 1,
      rolledBackAt: null,
    },
    {
      transactionId: "20260810T090000Z-oldbaseline",
      createdAt: "2026-08-10T09:00:00Z",
      packName: "Previous Baseline",
      packPath: "/mock/previous.rdtpack",
      packSha256: "previous-pack-sha256",
      planHash: "rdtpack-previous-plan",
      changedPaths: ["/mock/config/workspace.toml"],
      appliedCount: 1,
      skippedCount: 0,
      rolledBackAt: "2026-08-10T09:15:00Z",
    },
  ];
  return {
    transactions: transactions.map((transaction) => ({
      ...transaction,
      rolledBackAt: mockRolledBackConfigPackTransactions.has(transaction.transactionId)
        ? (transaction.rolledBackAt ?? "2026-08-13T12:30:00Z")
        : transaction.rolledBackAt,
      canRollback: !mockRolledBackConfigPackTransactions.has(transaction.transactionId),
    })),
    issues: [],
  };
}

mockIPC(
  (command, payload) => {
    const args = payload as Record<string, unknown> | undefined;
    switch (command) {
      case "plugin:dialog|open": {
        const options = args?.options as { title?: string } | undefined;
        return options?.title?.includes("配置包") ? "/mock/team.rdtpack" : null;
      }
      case "plugin:dialog|save": {
        const options = args?.options as { title?: string } | undefined;
        return options?.title?.includes("配置包") ? "/mock/export.rdtpack" : null;
      }
      case "storage_get_json":
      case "storage_set_json":
      case "storage_delete_json":
      case "open_local_path":
        return null;
      case "get_app_language_preference":
        return null;
      case "save_app_language_preference":
        return args?.record ?? null;
      case "storage_prepend_json_array":
        return [args?.value];
      case "list_operation_event_history":
        return [];
      case "list_config_sources":
        return mockSources;
      case "get_config_pack_inventory":
        return {
          projects: [
            { key: "demo", name: "示例控制台", detail: "本地项目" },
            { key: "portal", name: "示例门户", detail: "Web" },
          ],
          workspaces: [
            { key: "feature-a", name: "Feature A", detail: "需求工作区" },
          ],
          configSources: [
            {
              key: "default",
              name: "默认配置",
              detail: "resource, link, proxy, runtime",
            },
            {
              key: "team",
              name: "团队配置",
              detail: "resource, link, proxy, runtime",
            },
          ],
        };
      case "export_config_pack_file":
        return {
          outputPath: "/mock/export.rdtpack",
          sizeBytes: 4096,
        };
      case "inspect_config_pack_file":
        return {
          path: "/mock/team.rdtpack",
          sizeBytes: 4096,
          sha256: "pack-sha256",
          valid: true,
          manifest: {
            packId: "pack-smoke",
            name: "Team Development Baseline",
            createdAt: "2026-08-13T12:00:00Z",
            schemaVersion: 1,
            modules: [
              { key: "projects", itemCount: 2 },
              { key: "workspaces", itemCount: 1 },
              { key: "config_sources", itemCount: 2 },
            ],
            security: {
              sensitiveValuesRemoved: 2,
              requiredEnvironment: ["JENKINS_PASSWORD", "GITLAB_TOKEN"],
              portablePathCount: 5,
            },
          },
          projectKeys: ["demo", "portal"],
          workspaceKeys: ["feature-a"],
          configSourceIds: ["default", "team"],
          issues: [],
        };
      case "plan_config_pack_import_file": {
        const request = args?.request as {
          projectRootMappings?: Record<string, string>;
          includedOperationIds?: string[] | null;
        };
        const operationIds = request?.includedOperationIds ?? [
          "projects:demo",
          "workspaces:feature-a",
        ];
        const demoSelected = operationIds.includes("projects:demo");
        const mapped = !demoSelected || Boolean(request?.projectRootMappings?.demo);
        const operations = [
          {
            id: "projects:demo",
            module: "projects",
            key: "demo",
            action: "merge",
            target: "/mock/config/projects.toml",
            summary: "merge project demo",
            selected: demoSelected,
          },
          {
            id: "workspaces:feature-a",
            module: "workspaces",
            key: "feature-a",
            action: "add",
            target: "/mock/config/workspaces/feature-a.toml",
            summary: "add workspace feature-a",
            selected: operationIds.includes("workspaces:feature-a"),
          },
        ];
        return {
          planHash: mapped ? "rdtpack-ready-plan" : "rdtpack-blocked-plan",
          packName: "Team Development Baseline",
          expiresAt: "2026-08-14T12:00:00Z",
          operations,
          issues: mapped
            ? [
                {
                  severity: "warning",
                  code: "secret_omitted",
                  module: "security",
                  path: "projects.demo.env.API_TOKEN",
                  message: "敏感值已省略，可在导入后配置。",
                },
              ]
            : [
                {
                  severity: "error",
                  code: "path_mapping_required",
                  module: "projects",
                  path: "projects.demo.repo_path",
                  message: "项目 demo 需要本机路径映射。",
                },
              ],
          requiredMappings: mapped
            ? []
            : [
                {
                  kind: "project",
                  key: "demo",
                  placeholder: "${PROJECT_ROOT:demo}",
                  suggestedPath: "/mock/projects/demo",
                },
              ],
          requiredEnvironment: ["JENKINS_PASSWORD", "GITLAB_TOKEN"],
          blockerCount: mapped ? 0 : 1,
          changeCount: operations.filter(
            (operation) => operation.selected && operation.action !== "skip",
          ).length,
          skipCount: 0,
          excludedCount: operations.filter((operation) => !operation.selected).length,
        };
      }
      case "apply_config_pack_import_plan":
        mockConfigPackApplied = true;
        return {
          planHash: String(args?.planHash ?? ""),
          transactionId: "20260813T120000Z-123456789abc",
          backupDir: "/mock/config/config-pack-backups/20260813T120000Z-123456789abc",
          changedPaths: [
            "/mock/config/projects.toml",
            "/mock/config/workspaces/feature-a.toml",
          ],
          appliedCount: 2,
          skippedCount: 0,
        };
      case "list_config_pack_import_history":
        return getMockConfigPackHistory();
      case "rollback_config_pack_import_transaction":
        mockRolledBackConfigPackTransactions.add(String(args?.transactionId ?? ""));
        return {
          transactionId: String(args?.transactionId ?? ""),
          restoredPaths: [
            "/mock/config/projects.toml",
            "/mock/config/workspaces/feature-a.toml",
          ],
        };
      case "list_resource_actions":
        return {
          configPath: "/mock/actions.toml",
          schemaVersion: 1,
          actions: [
            {
              key: "batch-deploy-pre",
              name: "批量部署 Pre",
              description: "按各项目标准配置检查部署计划，全部通过后逐个触发 pre 环境部署。",
              effect: "remote_write",
              executionMode: "plan_apply",
              runnerKind: "process",
              paramCount: 6,
            },
          ],
        };
      case "get_resource_action":
        if (args?.key === "refresh-deploy-cache") {
          return {
            configPath: "/mock/actions.toml",
            key: "refresh-deploy-cache",
            name: "刷新部署缓存",
            description: "无参数 Action 使用同一执行面板。",
            effect: "read",
            execution: {
              mode: "direct",
              planTtlSeconds: 300,
            },
            runner: {
              kind: "process",
              program: "/bin/zsh",
              args: ["scripts/refresh-deploy-cache.sh"],
              cwd: "/mock",
              input: "json_stdin",
              output: "structured_json",
              timeoutSeconds: 60,
            },
            params: [],
          };
        }
        return {
          configPath: "/mock/actions.toml",
          key: "batch-deploy-pre",
          name: "批量部署 Pre",
          description: "按各项目标准配置检查部署计划，全部通过后逐个触发 pre 环境部署。",
          effect: "remote_write",
          execution: {
            mode: "plan_apply",
            planTtlSeconds: 300,
          },
          runner: {
            kind: "process",
            program: "/bin/zsh",
            args: ["scripts/preview-deploy.sh"],
            cwd: "/mock",
            input: "json_stdin",
            output: "structured_json",
            timeoutSeconds: 900,
          },
          params: [
            {
              key: "projects",
              label: "项目",
              kind: "project_multi",
              required: true,
              options: [
                { value: "demo-console", label: "示例控制台" },
                { value: "demo-portal", label: "示例门户" },
                { value: "demo-mobile", label: "示例移动端" },
              ],
            },
            {
              key: "branchOverride",
              label: "统一分支覆盖",
              kind: "branch",
              description: "仅覆盖声明了分支参数的项目；留空则沿用项目配置。",
              required: false,
              options: [],
            },
            {
              key: "planOnly",
              label: "仅检查计划",
              kind: "boolean",
              defaultValue: true,
              required: false,
              role: "dry_run",
              options: [],
            },
            {
              key: "workspace",
              label: "工作区",
              kind: "hidden",
              defaultValue: "demo-workspace",
              required: false,
              options: [],
            },
            {
              key: "target",
              label: "部署目标",
              kind: "hidden",
              defaultValue: "standard",
              required: false,
              options: [],
            },
            {
              key: "environment",
              label: "部署环境",
              kind: "hidden",
              defaultValue: "pre",
              required: false,
              options: [],
            },
          ],
        };
      case "plan_resource_action":
        {
          const request = args?.request as
            | { params?: { projects?: string[] } }
            | undefined;
          const projects = request?.params?.projects ?? [];
          const labels = new Map([
            ["demo-console", "示例控制台"],
            ["demo-portal", "示例门户"],
            ["demo-mobile", "示例移动端"],
          ]);
          return {
            schemaVersion: 1,
            planId: "action-plan-smoke",
            actionKey: "batch-deploy-pre",
            actionName: "批量部署 Pre",
            effect: "remote_write",
            workspaceKey: "demo-workspace",
            configPath: "/mock/actions.toml",
            configFingerprint: "sha256:config",
            paramsFingerprint: "sha256:params",
            effectiveParams: request?.params ?? {},
            secretParams: [],
            planOperationId: "action-plan-operation-smoke",
            planResult: {
              schemaVersion: 1,
              summary: "已识别即将提交的实际部署目标",
              items: projects.map((project) => ({
                key: project,
                label: labels.get(project) ?? project,
                status: "warning",
                summary: "等待确认提交部署任务",
                detail: "计划已固化工作区、环境与分支。",
                parameters: [
                  { key: "environment", label: "环境", value: "pre" },
                  { key: "branch", label: "分支", value: "feature/shared" },
                ],
              })),
            },
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
            consumedAt: null,
          };
        }
      case "run_resource_action":
      case "apply_resource_action_plan":
        {
          const request = args?.request as
            | {
                operationId?: string;
                params?: {
                  projects?: string[];
                  planOnly?: boolean;
                  branchOverride?: string;
                };
              }
            | undefined;
          if (request?.params?.branchOverride === "simulate-action-error") {
            throw new Error("模拟 Action 执行失败");
          }
          const projects = request?.params?.projects ?? [];
          const failedProjects =
            projects.length > 1 && projects.includes("demo-portal")
              ? ["demo-portal"]
              : [];
          const labels = new Map([
            ["demo-console", "示例控制台"],
            ["demo-portal", "示例门户"],
            ["demo-mobile", "示例移动端"],
          ]);
          const items = projects.map((project) => ({
            key: project,
            label: labels.get(project) ?? project,
            status: failedProjects.includes(project) ? "failed" : "success",
            summary: failedProjects.includes(project) ? "计划被阻断" : "计划可以执行",
            detail: failedProjects.includes(project) ? "缺少必要部署参数" : "参数解析完成",
            url: `https://jenkins.example.test/job/${project}`,
            parameters: [
              { key: "environment", label: "环境", value: "pre" },
              { key: "branch", label: "分支", value: "feature/shared" },
            ],
          }));
          const operationId = request?.operationId ?? "action-smoke";
          const result = {
            operationId,
            key: "batch-deploy-pre",
            name: "批量部署 Pre",
            success: failedProjects.length === 0,
            exitCode: failedProjects.length === 0 ? 0 : 1,
            timedOut: false,
            cancelled: false,
            stdout: "",
            stderr: "",
            stdoutTruncated: false,
            stderrTruncated: false,
            structuredResult: {
              schemaVersion: 1,
              summary:
                failedProjects.length === 0
                  ? request?.params?.planOnly === false
                    ? "部署任务已提交"
                    : "计划检查完成"
                  : "部分项目计划未通过",
              items,
              retry:
                failedProjects.length > 0
                  ? { param: "projects", values: failedProjects }
                  : null,
            },
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: 120,
          };
          if (request?.params?.branchOverride === "simulate-action-running") {
            window.setTimeout(() => {
              void emit("rdevtool://resource-action-progress", {
                operationId,
                sequence: 1,
                stream: "stderr",
                chunk: "checking plan: demo / standard / pre\n",
                outputSuppressed: false,
                occurredAt: new Date().toISOString(),
              });
            }, 30);
            return new Promise((resolve) => {
              pendingResourceActionCancellation = () => {
                pendingResourceActionCancellation = null;
                resolve({
                  ...result,
                  success: false,
                  exitCode: null,
                  cancelled: true,
                  structuredResult: null,
                  stderr: "checking plan: demo / standard / pre\n",
                  finishedAt: new Date().toISOString(),
                });
              };
            });
          }
          return result;
        }
      case "cancel_resource_action": {
        const accepted = pendingResourceActionCancellation !== null;
        pendingResourceActionCancellation?.();
        return {
          operationId: String(args?.operationId ?? ""),
          accepted,
        };
      }
      case "get_config_source_preference":
        return "default";
      case "preflight_project_runtime":
        runtimePreflightMockCount += 1;
        if (runtimeSmokeProfileRepairMode === "create") {
          return {
            ...runtimeSmokePreflight,
            debugProfileKey: null,
            debugProfileLabel: null,
            statusKey: "warning",
            statusLabel: "可优化",
            summary: `可生成 1 个启动档案 · 第 ${runtimePreflightMockCount} 次检查`,
            checks: [
              {
                key: "debugProfile",
                title: "启动档案",
                category: "context",
                statusKey: "info",
                statusLabel: "建议",
                detail: "使用项目默认启动配置",
                action: "可将检测结果保存为可复用启动档案。",
                fix: {
                  kind: "createProfile",
                  label: "生成启动档案",
                  description:
                    "继承项目基础命令，仅固定已检测的本地端口 5173。",
                  confirmationRequired: true,
                  profileKey: "demo-local",
                  profileLabel: "示例控制台 本地启动",
                  command: "npm run dev",
                  cwd: "/mock/projects/demo",
                  focusUrl: "http://127.0.0.1:5173",
                  nodeVersion: "20",
                  packageManager: "npm",
                  suggestedPort: 5173,
                },
              },
              runtimeSmokePreflight.checks[0],
            ],
          };
        }
        if (runtimeSmokeProfileRepairMode === "reset") {
          return {
            ...runtimeSmokePreflight,
            debugProfileKey: null,
            debugProfileLabel: null,
            statusKey: "error",
            statusLabel: "不可启动",
            summary: `启动档案已失效 · 第 ${runtimePreflightMockCount} 次检查`,
            checks: [
              {
                key: "debugProfile",
                title: "启动档案",
                category: "context",
                statusKey: "error",
                statusLabel: "异常",
                detail: "启动档案不存在: removed",
                action: "重新选择可用档案，或恢复项目基础配置。",
                fix: {
                  kind: "resetProfile",
                  label: "使用基础配置",
                  description:
                    "清除已失效的工作区档案选择 removed，恢复项目基础启动配置。",
                  confirmationRequired: true,
                },
              },
            ],
          };
        }
        if (runtimeSmokePortConflict) {
          return {
            ...runtimeSmokePreflight,
            statusKey: "error",
            statusLabel: "不可启动",
            summary: `1 个阻断项 · 第 ${runtimePreflightMockCount} 次检查`,
            checks: [
              runtimeSmokePreflight.checks[0],
              {
                key: "devPort",
                title: "预期端口",
                category: "runtime",
                statusKey: "error",
                statusLabel: "异常",
                detail: "端口 5173 已被 node (PID 1420) 占用",
                action: "停止占用进程，或为本次启动选择其他预期端口。",
                fix: {
                  kind: "changePort",
                  label: "换用 5175",
                  description:
                    "端口 5173 已被占用。使用空闲端口 5175 启动，并保持 Vite 严格端口模式。",
                  confirmationRequired: true,
                  currentPort: 5173,
                  suggestedPort: 5175,
                },
              },
              {
                ...runtimeSmokePreflight.checks[2],
                statusKey: "ok",
                statusLabel: "正常",
                detail: "本地联调代理正在监听 http://127.0.0.1:8791",
                action: null,
                fix: null,
              },
            ],
          };
        }
        return {
          ...runtimeSmokePreflight,
          statusKey: runtimeSmokeProxyRunning ? "ok" : "warning",
          statusLabel: runtimeSmokeProxyRunning ? "可启动" : "可优化",
          summary: `${
            runtimeSmokeProxyRunning ? "关键链路正常" : "1 个关注项"
          } · 第 ${runtimePreflightMockCount} 次检查`,
          checks: runtimeSmokePreflight.checks.map((check) =>
            check.key === "runtimeProxy" && runtimeSmokeProxyRunning
              ? {
                  ...check,
                  statusKey: "ok",
                  statusLabel: "正常",
                  detail: "本地联调代理正在监听 http://127.0.0.1:8791",
                  action: null,
                  fix: null,
                }
              : check,
          ),
        };
      case "get_project_runtime_context": {
        const envOverrides =
          (args?.envOverrides as Record<string, string> | null | undefined) ??
          {};
        const environment = new Map(
          runtimeSmokeContext.effective.environment.map((item) => [
            item.key,
            item,
          ]),
        );
        Object.entries(envOverrides).forEach(([key, value]) => {
          environment.set(key, {
            key,
            value,
            source: "launchOverride",
            masked: false,
          });
        });
        return {
          ...runtimeSmokeContext,
          requested: {
            ...runtimeSmokeContext.requested,
            envKeys: Object.keys(envOverrides),
          },
          effective: {
            ...runtimeSmokeContext.effective,
            environment: Array.from(environment.values()).sort((left, right) =>
              left.key.localeCompare(right.key),
            ),
          },
        };
      }
      case "list_web_actions":
        return {
          configPath: "/mock/web_actions.toml",
          actions: [
            {
              key: "read-page",
              name: "读取页面信息",
              kind: "script",
              scope: "project:demo",
              matchPatterns: ["http://*"],
              runManually: true,
              params: [],
              script: [
                "return {",
                "  title: document.title,",
                "  url: location.href,",
                "  readyState: document.readyState",
                "};",
              ].join("\n"),
              request: null,
            },
          ],
        };
      case "list_links":
        return [
          {
            key: "demo-debug",
            name: "示例联调链路",
            kind: "debug",
            uiProfile: "resource-basic",
            schemaVersion: 1,
            workspaceKey: "demo-workspace",
            project: "示例控制台",
            stepCount: 3,
            proxyProfiles: [
              {
                id: "smoke-proxy",
                name: "本地联调代理",
                listenUrl: "http://127.0.0.1:8791",
              },
            ],
            runtime: {
              status: "planned",
              label: "可启动",
              runningSteps: 0,
              controllableSteps: 3,
              blockedSteps: 0,
              canRun: true,
              canStop: false,
            },
            warnings: [],
          },
        ];
      case "list_web_action_navigation_targets":
        return [
          {
            id: "runtime-smoke-page",
            title: "示例控制台",
            url: "http://127.0.0.1:5173/",
            type: "page",
            webSocketDebuggerUrl: "ws://127.0.0.1/mock-runtime",
          },
        ];
      case "get_workspace_pinned_actions_overview":
        return workspaceRuntimeOverview;
      case "get_workspace_pinned_actions_overview_summary":
        return workspaceRuntimeOverview.map((group) => ({
          ...group,
          proxyProfileCount: 0,
          projectDirectories: [],
          proxyProfiles: [],
        }));
      case "get_workspace_pinned_actions_overview_details": {
        const workspaceKeys = Array.isArray(args?.workspaceKeys)
          ? args.workspaceKeys.map(String)
          : [];
        return workspaceRuntimeOverview.filter((group) =>
          workspaceKeys.includes(group.key),
        );
      }
      case "get_project_workspace_editor":
        return workspaceRuntimeEditor;
      case "save_project_workspace_editor":
        return {
          ...workspaceRuntimeEditor,
          workspace: {
            ...workspaceRuntimeEditor.workspace,
            ...((args?.draft as Record<string, unknown> | undefined) ?? {}),
          },
        };
      case "list_project_workspace_instance_statuses":
        return [
          workspaceInstanceRepairMode
            ? {
                projectKey: "demo",
                projectName: "示例控制台",
                path: "/mock/workspaces/feature/demo",
                managed: true,
                statusKey: "missing",
                statusLabel: "目录缺失",
                detail:
                  "目录已被删除，但 Git 仍保留工作副本登记；可按原路径和分支修复",
                exists: false,
                canOpen: false,
                repositoryRoot: null,
                remoteMatches: null,
                observedRemoteCount: 0,
                repairSupported: true,
                repairBranch: "feature/REQ-1234",
              }
            : {
                projectKey: "demo",
                projectName: "示例控制台",
                path: "/mock/workspaces/feature/demo",
                managed: true,
                statusKey: "healthy",
                statusLabel: "正常",
                detail: "Git 仓库根目录与 Remote 已验证",
                exists: true,
                canOpen: true,
                repositoryRoot: "/mock/workspaces/feature/demo",
                remoteMatches: true,
                observedRemoteCount: 1,
                repairSupported: false,
                repairBranch: null,
              },
        ];
      case "repair_project_workspace_project_instance":
        workspaceInstanceRepairMode = false;
        return workspaceRuntimeEditor;
      case "inspect_project_workspace_project_directory":
        return {
          projectKey: String(args?.project ?? "demo"),
          requestedPath: String(args?.path ?? ""),
          effectivePath: String(args?.path ?? ""),
          repositoryRoot: String(args?.path ?? ""),
          configuredRemote: "example.com/team/demo",
          observedRemoteCount: 1,
          remoteMatches: true,
          requiresRemoteMismatchConfirmation: false,
        };
      case "plan_project_workspace_archive": {
        const workspaceKey = String(args?.workspaceKey ?? "");
        const workspace =
          smokeWorkspaces.find((item) => item.key === workspaceKey) ??
          smokeArchivedWorkspaces.find((item) => item.key === workspaceKey);
        return {
          workspaceKey,
          workspaceName: workspace?.name ?? workspaceKey,
          alreadyArchived: false,
          active: false,
          canArchive: true,
          blockers: [],
          warnings: [],
        };
      }
      case "save_project_runtime_launch_profile":
        return {
          projectKey: "demo",
          profileKey: String(
            (args?.request as { profileKey?: string } | undefined)
              ?.profileKey ?? "uat3-vke-custom",
          ),
          profileLabel: String(
            (args?.request as { label?: string } | undefined)?.label ??
              "UAT3 VKE 自定义",
          ),
          mode: "create",
          envCount: 3,
          expectedPort:
            (args?.request as { expectedPort?: number } | undefined)
              ?.expectedPort ?? null,
          configPath: "/mock/projects.toml",
          scope: "project",
          availableInAllWorkspaces: true,
        } satisfies SaveProjectRuntimeLaunchProfileResponse;
      case "inspect_config_source":
        return inspectMockSource(String(args?.sourceId ?? ""));
      case "compare_config_sources":
        return compareMockSources(
          String(args?.leftSourceId ?? ""),
          String(args?.rightSourceId ?? ""),
        );
      case "copy_config_source":
        return copyMockSource(args?.request as ConfigSourceCopyRequest);
      case "list_managed_artifacts":
        return args?.project === "demo" &&
          Array.isArray(args?.kinds) &&
          args.kinds.includes("workspaceProjectInstance")
          ? managedWorkspaceInstanceInventory
          : managedArtifactInventory;
      case "plan_managed_artifact_cleanup": {
        const artifactIds = Array.isArray(args?.artifactIds)
          ? args.artifactIds.map(String)
          : [];
        const workspaceInstanceSelected = artifactIds.includes(
          "artifact-smoke-workspace-instance",
        );
        return {
          ...managedArtifactCleanupPlan,
          requested: {
            workspace: args?.workspace ?? null,
            allWorkspaces: Boolean(args?.allWorkspaces),
            project: args?.project ?? null,
            kinds: Array.isArray(args?.kinds) ? args.kinds.map(String) : [],
            artifactIds,
          },
          effective: {
            ...managedArtifactCleanupPlan.effective,
            selectedArtifactIds:
              artifactIds.length > 0
                ? artifactIds
                  : managedArtifactCleanupPlan.effective.selectedArtifactIds,
          },
          observed: workspaceInstanceSelected
            ? {
                actions: [
                  {
                    artifactId: "artifact-smoke-workspace-instance",
                    kind: "workspaceProjectInstance",
                    path: "/mock/workspaces/feature/demo",
                    action: "removeWorkspaceProjectInstance",
                    eligibility: "eligible",
                    destructive: true,
                    reason:
                      "项目实例归属已验证，位于工作区直属目录且 Git 工作树干净",
                    prerequisites: [
                      "再次确认分支不再需要",
                      "移除工作区绑定后使用 Git-aware 清理",
                    ],
                  },
                ],
                eligibleCount: 1,
                reviewRequiredCount: 0,
                blockedCount: 0,
              }
            : managedArtifactCleanupPlan.observed,
        };
      }
      case "get_project_config_editor":
        return projectEditorState;
      case "get_notes_file_index": {
        const scope = String(args?.scope ?? "");
        const query = String(args?.query ?? "").trim().toLowerCase();
        const documents = smokeKnowledgeDocuments
          .filter((document) => {
            const scopeMatches = !scope || document.scope === scope;
            const queryMatches =
              !query ||
              `${document.title} ${document.summary} ${document.relativePath} ${
                smokeKnowledgeContent[document.path]
              }`
                .toLowerCase()
                .includes(query);
            return scopeMatches && queryMatches;
          })
          .map((document) => ({
            ...document,
            matchExcerpt: query
              ? smokeKnowledgeContent[document.path]
                  .split("\n")
                  .find((line) => line.toLowerCase().includes(query)) ?? null
              : null,
          }));
        return {
          schemaVersion: 1,
          notesRoot: "/mock/notes",
          projectKey: args?.project ?? null,
          scope: scope || null,
          query: query || null,
          scannedCount: smokeKnowledgeDocuments.length,
          matchedCount: documents.length,
          truncated: false,
          documents,
        };
      }
      case "get_note_document": {
        const path = String(args?.path ?? "");
        const summary =
          smokeKnowledgeDocuments.find((document) => document.path === path) ??
          smokeKnowledgeDocuments[0];
        smokeKnowledgeReadCount += 1;
        globalThis.document.documentElement.dataset.knowledgeReadCount =
          String(smokeKnowledgeReadCount);
        return {
          schemaVersion: 1,
          summary,
          content: smokeKnowledgeContent[summary.path],
        };
      }
      case "resolve_note_document_link": {
        const href = String(args?.href ?? "");
        const summary = href.includes("release-check.md")
          ? smokeKnowledgeDocuments[1]
          : smokeKnowledgeDocuments.find(
              (document) => document.path === String(args?.sourcePath ?? ""),
            ) ?? smokeKnowledgeDocuments[0];
        return {
          document: {
            schemaVersion: 1,
            summary,
            content: smokeKnowledgeContent[summary.path],
          },
          fragment: href.split("#")[1] ?? null,
        };
      }
      case "create_note_document": {
        const request = args?.request as {
          scope?: string;
          projectKey?: string | null;
          title?: string;
        };
        const title = String(request?.title ?? "新知识");
        const scope = String(request?.scope ?? "inbox");
        const path = `/mock/notes/${scope}/${title}.md`;
        return {
          created: true,
          document: {
            schemaVersion: 1,
            summary: {
              source: "file",
              scope,
              projectKey: request?.projectKey ?? null,
              title,
              summary: "",
              matchExcerpt: null,
              path,
              relativePath: path.replace("/mock/notes/", ""),
              updatedAtMs: Date.now(),
              score: 0,
            },
            content: `# ${title}\n\n## 记录\n\n`,
          },
        };
      }
      case "delete_note_document": {
        const path = String(args?.path ?? "");
        return {
          deleted: true,
          path,
          relativePath: path.replace("/mock/notes/", ""),
        };
      }
      case "get_doctor_snapshot": {
        smokeDoctorCheckCount += 1;
        const rechecked = smokeDoctorCheckCount > 1;
        return {
          schemaVersion: 1,
          status: "warning",
          errorCount: 0,
          warningCount: 2,
          paths: {
            configDir: "/mock/config",
            projects: "/mock/config/projects.toml",
            workspace: "/mock/config/workspace.toml",
            workspacesDir: "/mock/config/workspaces",
            navigation: "/mock/config/navigation.toml",
            proxy: "/mock/config/proxy.toml",
            configSources: "/mock/config/config-sources.toml",
            proxyActive: "/mock/config/proxy.toml",
            webActions: "/mock/config/web-actions.toml",
            storage: "/mock/data/rdevtool.db",
          },
          health: smokeHealthSnapshot(),
          activeWorkspace: {
            key: String(args?.workspace ?? "system"),
            name: "系统工作区",
            system: true,
            projectCount: 21,
            includeAllProjects: true,
            includeAllNavigation: true,
          },
          checks: [
            {
              status: rechecked ? "ok" : "warning",
              code: "project_repo_paths",
              message: rechecked
                ? "configured repo paths exist"
                : "1 project repository path needs attention",
              detail: rechecked ? null : "demo: /mock/projects/demo is missing",
            },
            {
              status: "warning",
              code: "proxy_workspaces",
              message: "1 proxy workspace reference needs attention",
              detail: "legacy-workspace is not in the workspace catalog",
            },
            ...(rechecked
              ? [
                  {
                    status: "warning",
                    code: "proxy_ports",
                    message: "1 proxy listen port is occupied",
                    detail: "127.0.0.1:8791 is owned by another process",
                  },
                ]
              : []),
            {
              status: "ok",
              code: "storage",
              message: "storage is available",
              detail: "/mock/data/rdevtool.db",
            },
          ],
        };
      }
      case "get_health_snapshot":
        return smokeHealthSnapshot();
      case "get_proxy_dashboard":
        return smokeProxyDashboard;
      case "list_controlled_browser_sessions":
        return [{
          id: "browser:9223",
          port: 9223,
          endpoint: "http://127.0.0.1:9223",
          browserName: "Chrome",
          browserVersion: "139.0.7258.67",
          protocolVersion: "1.3",
          pageCount: 3,
          pages: [
            {
              id: "page-portal",
              title: "Portal Dashboard",
              url: "http://127.0.0.1:1420/dashboard",
            },
            {
              id: "page-docs",
              title: "API Documentation",
              url: "https://docs.example.com/api",
            },
          ],
          runtimeProfileKeys: ["web-cdp"],
          activeProjects: [{ key: "rdevtool", name: "rDevTool" }],
          configuredProjects: [
            { key: "rdevtool", name: "rDevTool" },
            { key: "portal", name: "Portal" },
          ],
        }];
      case "save_project_deploy_targets": {
        const request = args?.request as {
          projectKey: string;
          deployTargets: DeployTargetConfigSummary[];
        };
        projectEditorState = {
          ...projectEditorState,
          projects: projectEditorState.projects.map((project) =>
            project.key === request.projectKey
              ? { ...project, deployTargets: request.deployTargets }
              : project,
          ),
        };
        return projectEditorState;
      }
      default:
        return null;
    }
  },
  { shouldMockEvents: true },
);

function ConfirmationSmokeHarness() {
  const [confirm, confirmDialog] = useAppConfirmDialog();
  const [buildRuns, setBuildRuns] = useState(0);
  const [branchRuns, setBranchRuns] = useState(0);

  async function runConfirmation(
    preferenceKey: "build.run" | "branch.mutate",
    label: string,
    onRun: () => void,
  ) {
    const accepted = await confirm({
      title: "确认运行",
      description: `确认运行“${label}”？`,
      confirmLabel: "运行",
      preferenceKey,
    });
    if (accepted) {
      onRun();
    }
  }

  return (
    <section aria-label="确认策略测试">
      <Button
        onClick={() =>
          void runConfirmation("build.run", "测试构建", () =>
            setBuildRuns((current) => current + 1),
          )
        }
      >
        测试构建确认
      </Button>
      <Button
        onClick={() =>
          void runConfirmation("branch.mutate", "测试分支合并", () =>
            setBranchRuns((current) => current + 1),
          )
        }
      >
        测试分支确认
      </Button>
      <output data-testid="build-confirmation-runs">{buildRuns}</output>
      <output data-testid="branch-confirmation-runs">{branchRuns}</output>
      {confirmDialog}
    </section>
  );
}

function SidebarSmokeHarness() {
  const smokeParams = new URLSearchParams(window.location.search);
  const documentationScreenshot = smokeParams.get("docsScreenshot");
  const documentationActionScreenshot = documentationScreenshot === "action";
  const documentationGitScreenshot = documentationScreenshot === "git";
  const documentationBuildScreenshot = documentationScreenshot === "build";
  const documentationProjectsScreenshot = documentationScreenshot === "projects";
  const documentationRuntimeScreenshot = documentationScreenshot === "runtime";
  const documentationResourcesScreenshot = documentationScreenshot === "resources";
  const documentationProxyScreenshot = documentationScreenshot === "proxy";
  const documentationKnowledgeScreenshot = documentationScreenshot === "knowledge";
  const documentationActivityScreenshot = documentationScreenshot === "activity";
  const documentationProjectConfigScreenshot = documentationScreenshot === "project-config";
  const documentationConfigSourceScreenshot = documentationScreenshot === "config-source";
  const documentationProjectScreenshot =
    documentationGitScreenshot ||
    documentationBuildScreenshot ||
    documentationProjectsScreenshot ||
    documentationRuntimeScreenshot;
  const [activePage, setActivePage] = useState<PageKey>(
    documentationProjectScreenshot
      ? "projectManagement"
      : documentationResourcesScreenshot
        ? "resources"
        : documentationProxyScreenshot
          ? "proxy"
          : documentationKnowledgeScreenshot
            ? "knowledge"
            : "overview",
  );
  const [projectManagementView, setProjectManagementView] =
    useState<ProjectManagementViewKey>(
      documentationBuildScreenshot
        ? "build"
        : documentationGitScreenshot
          ? "git"
          : "projects",
    );
  const [styleMode, setStyleMode] = useState<AppStyleMode>(() =>
    documentationScreenshot || smokeParams.get("style") === "mono"
      ? "mono"
      : "light",
  );
  const [activeWorkspaceKey, setActiveWorkspaceKey] = useState(
    documentationActionScreenshot
      ? "r-series"
      : documentationProjectScreenshot
        ? "demo-workspace"
        : documentationResourcesScreenshot
          ? "demo-workspace"
          : documentationProxyScreenshot
            ? "system"
            : documentationKnowledgeScreenshot
              ? "demo-workspace"
        : "system",
  );
  const [exitRuntimePolicy, setExitRuntimePolicy] = useState<
    "ask" | "keep" | "stop"
  >("ask");
  const [enabledPages, setEnabledPages] = useState<PageKey[]>(() =>
    visibleNavItems.map((item) => item.key),
  );
  const [defaultPage, setDefaultPage] = useState<PageKey>("overview");
  const [selectedProxyProfileId, setSelectedProxyProfileId] =
    useState("smoke-proxy");
  const [configSourceManagerOpen, setConfigSourceManagerOpen] = useState(
    documentationConfigSourceScreenshot,
  );
  const [configSourceCompareOnOpen, setConfigSourceCompareOnOpen] =
    useState(false);
  const [projectBuildConfigOpen, setProjectBuildConfigOpen] = useState(
    documentationProjectConfigScreenshot,
  );
  const [runtimeConfigSmokeOpen, setRuntimeConfigSmokeOpen] = useState(false);
  const [resourceActionSmokeTarget, setResourceActionSmokeTarget] = useState<{
    key: string;
    entryName: string;
  } | null>(
    documentationActionScreenshot
      ? { key: "batch-deploy-pre", entryName: "批量部署 Pre" }
      : null,
  );
  const [branchHistorySmokeOpen, setBranchHistorySmokeOpen] = useState(false);
  const [buildHistorySmokeOpen, setBuildHistorySmokeOpen] = useState(false);
  const [workspaceRuntimeSmokeOpen, setWorkspaceRuntimeSmokeOpen] = useState(
    documentationActionScreenshot || documentationActivityScreenshot,
  );
  const [workspaceConfigFocusRequest, setWorkspaceConfigFocusRequest] =
    useState<WorkspaceConfigFocusRequest | null>(null);
  const [workspaceRuntimeStartState, setWorkspaceRuntimeStartState] =
    useState("");
  const [workspaceRuntimeActionState, setWorkspaceRuntimeActionState] =
    useState("");
  const [workspaceRuntimeProxyState, setWorkspaceRuntimeProxyState] =
    useState("");
  const [workspaceRuntimeSelectedProfile, setWorkspaceRuntimeSelectedProfile] =
    useState("");
  const missingWorktreePath = "/mock/worktrees/example-pre";
  const [selectedWorktreePath, setSelectedWorktreePath] =
    useState(missingWorktreePath);
  const [worktreeItems, setWorktreeItems] = useState<BranchWorktreeSummary[]>([
    {
      projectKey: "example",
      projectName: "示例项目",
      repoPath: missingWorktreePath,
      label: "pre",
      currentBranch: "pre",
      detached: false,
      clean: false,
      ahead: 0,
      behind: 0,
      isDefault: false,
      isGitWorktree: true,
      isWorkspaceInstance: true,
      managed: true,
      statusKey: "missing",
      statusLabel: "目录缺失",
      detail: "目录已被删除，但 Git 仍保留工作副本登记；可直接修复并重建。",
      latestCommit: null,
    },
  ]);
  const [activityItems, setActivityItems] = useState<ActivityEntry[]>(() => [
    createActivityEntry({
      id: "config-change:workspace",
      kind: "config",
      origin: "app",
      status: "running",
      title: "工作区配置已变更",
      summary: "检测到外部修改，请重新加载最新配置",
      target: { page: "overview" },
      action: {
        kind: "reloadConfig",
        label: "重新加载",
        scope: "workspace",
      },
    }),
    createActivityEntry({
      id: "config-change:projects",
      kind: "config",
      origin: "app",
      status: "running",
      title: "项目配置已变更",
      summary: "检测到外部修改，请重新加载最新配置",
      target: { page: "projectManagement" },
      action: {
        kind: "reloadConfig",
        label: "重新加载",
        scope: "projects",
      },
    }),
    createActivityEntry({
      id: "config-change:project-workspaces",
      kind: "config",
      origin: "app",
      status: "running",
      title: "项目工作区配置已变更",
      summary: "检测到外部修改，请重新加载最新配置",
      target: { page: "overview" },
      action: {
        kind: "reloadConfig",
        label: "重新加载",
        scope: "projectWorkspaces",
      },
    }),
    createActivityEntry({
      id: "deploy-success-with-params",
      kind: "build",
      origin: "cli",
      status: "success",
      title: "触发部署",
      summary: "构建成功 · 构建 #4118 当前结果：SUCCESS",
      detail:
        "https://ci.example.test/job/demo-console/4118/",
      executionKey: "build:demo-console:vke:smoke",
      projectKey: "demo-console",
      projectName: "示例控制台",
      parameters: [
        { key: "target", label: "目标", value: "vke" },
        { key: "environment", label: "环境", value: "dc2" },
        { key: "branch", label: "分支", value: "env_demo_pre" },
        { key: "IS_GRAY", label: "灰度", value: "false" },
        { key: "API_TOKEN", label: "令牌", value: "已配置", masked: true },
      ],
      target: { page: "build", projectKey: "demo-console" },
      resource: {
        kind: "url",
        label: "打开构建记录",
        value:
          "https://ci.example.test/job/demo-console/4118/",
      },
      createdAt: "2026-07-21T07:05:00.000Z",
      updatedAt: "2026-07-21T07:05:00.000Z",
    }),
    createActivityEntry({
      id: "deploy-running-no-attention",
      kind: "build",
      origin: "tray",
      status: "running",
      title: "触发部署（进行中测试）",
      summary: "示例控制台 · vke 正在构建",
      executionKey: "build:demo-console:vke:running-smoke",
      projectKey: "demo-console",
      projectName: "示例控制台",
      parameters: [
        { key: "target", label: "目标", value: "vke" },
        { key: "environment", label: "环境", value: "dc2" },
      ],
      createdAt: "2026-07-21T07:10:00.000Z",
      updatedAt: "2026-07-21T07:10:00.000Z",
    }),
    createActivityEntry({
      id: "build-app-failed-recoverable",
      kind: "build",
      origin: "app",
      status: "failed",
      title: "触发部署",
      summary: "部署触发失败",
      detail: "构建计划已阻断：目标分支 feature/missing 不存在",
      executionKey: "build:demo-console:vke:failed-smoke",
      projectKey: "demo-console",
      projectName: "示例控制台",
      parameters: [
        { key: "target", label: "目标", value: "vke" },
        { key: "environment", label: "环境", value: "dc2" },
        { key: "branch", label: "分支", value: "feature/missing" },
      ],
      target: { page: "build", projectKey: "demo-console" },
      action: {
        kind: "buildRecover",
        label: "重新规划并重试部署",
        projectKey: "demo-console",
        projectName: "示例控制台",
        workspaceKey: "system",
        request: {
          project: "demo-console",
          target: "vke",
          env: "dc2",
          branch: "feature/missing",
          params: {
            ENV_PROFILE: "dc2",
            BRANCH: "feature/missing",
          },
        },
      },
      createdAt: "2026-07-22T02:10:00.000Z",
      updatedAt: "2026-07-22T02:10:00.000Z",
    }),
    createActivityEntry({
      id: "proxy-tray-failed-recoverable",
      kind: "proxy",
      origin: "tray",
      status: "failed",
      title: "启动代理服务",
      summary: "本地联调代理 · 启动失败",
      detail: "127.0.0.1:8791 被外部进程占用",
      executionKey: "proxy:start:workspace-proxy:local-debug",
      diagnostics: [
        {
          id: "proxy:start:local-debug",
          type: "proxy.start",
          label: "本地联调代理",
          status: "failed",
          summary: "监听端口已被占用",
          risks: ["监听进程不受 rDevTool 管理"],
        },
      ],
      target: { page: "proxy" },
      action: {
        kind: "proxyRecover",
        label: "检查并重新启动",
        profileId: "local-debug",
        profileName: "本地联调代理",
        sourceId: "workspace-proxy",
        replayAction: "start",
      },
      createdAt: "2026-07-22T02:05:00.000Z",
      updatedAt: "2026-07-22T02:05:00.000Z",
    }),
    createActivityEntry({
      id: "link-tray-failed-recoverable",
      kind: "link",
      origin: "tray",
      status: "failed",
      title: "启动联调链路",
      summary: "示例联调 · 完成 1 / 失败 1 / 跳过 0",
      detail: "启动代理：端口已被占用",
      executionKey: "link:run:demo-debug",
      projectKey: "demo-service",
      diagnostics: [
        {
          id: "proxy",
          type: "proxy.start",
          label: "启动代理",
          status: "failed",
          summary: "端口已被占用",
          risks: ["127.0.0.1:8791 已被外部进程占用"],
        },
        {
          id: "runtime",
          type: "runtime.start",
          label: "启动项目",
          status: "skipped",
          summary: "前置步骤失败，未启动项目",
          risks: [],
        },
      ],
      warnings: ["请先确认本地代理端口的归属"],
      target: { page: "overview", projectKey: "demo-service" },
      action: {
        kind: "linkRecover",
        label: "检查并重新启动",
        linkKey: "demo-debug",
        linkName: "示例联调",
        sourceId: "workspace-links",
        replayAction: "run",
      },
      createdAt: "2026-07-22T02:00:00.000Z",
      updatedAt: "2026-07-22T02:00:00.000Z",
    }),
    createActivityEntry({
      id: "merge-failed-latest",
      kind: "branch",
      origin: "cli",
      status: "failed",
      title: "合并分支",
      summary: "成功 0 / 失败 1",
      detail:
        "消息中心: release -> master [失败]\n原因：GitLab 身份验证失败（HTTP 401），请检查访问令牌是否有效或已过期。",
      executionKey: "branch:sync:message-center",
      projectKey: "message-center",
      projectName: "消息中心",
      diagnostics: [
        {
          id: "sync:message-center:0",
          type: "git.sync",
          label: "消息中心",
          status: "failed",
          summary: "合并失败",
          risks: [
            "GitLab 身份验证失败（HTTP 401），请检查访问令牌是否有效或已过期。",
          ],
        },
      ],
      action: {
        kind: "branchReplay",
        label: "检查并重试 Git 操作",
        replay: {
          command: "execute_branch_sync_task",
          busyText: "正在重新合并分支",
          request: {
            projects: ["message-center"],
            sourceBranch: "release-20260716",
            targetBranch: "master",
          },
        },
      },
      createdAt: "2026-07-17T00:39:13.657Z",
      updatedAt: "2026-07-17T00:39:13.657Z",
    }),
    createActivityEntry({
      id: "merge-failed-older",
      kind: "branch",
      origin: "cli",
      status: "failed",
      title: "合并分支",
      summary: "成功 0 / 失败 1",
      detail: "消息中心: release -> pre [失败]\n原因：目标分支不存在。",
      executionKey: "branch:sync:message-center",
      projectKey: "message-center",
      projectName: "消息中心",
      createdAt: "2026-07-16T23:39:13.657Z",
      updatedAt: "2026-07-16T23:39:13.657Z",
    }),
    createActivityEntry({
      id: "runtime-failed-single",
      kind: "runtime",
      origin: "app",
      status: "failed",
      title: "dev 服务启动失败",
      summary: "rdevtool-web：启动命令执行失败，请检查本地环境后重试。",
      detail:
        "启动命令: npm run dev\n工作目录: /mock/demo/rdevtool-web\n错误: 端口 1420 已被其他进程占用。\n请停止占用进程或修改端口后重试。\n完整详情结束",
      executionKey: "runtime:smoke:single",
      projectKey: "rdevtool-web",
      projectName: "rdevtool-web",
      diagnostics: [
        {
          id: "runtime-port",
          type: "runtime.preflight.port",
          label: "端口检查",
          status: "failed",
          summary: "端口 1420 已被其他进程占用",
          risks: ["必须先释放端口或调整运行档案"],
        },
      ],
      action: {
        kind: "runtimeRecover",
        label: "检查并重新启动",
        projectKey: "rdevtool-web",
        projectName: "rdevtool-web",
        debugProfileKey: "default",
        envOverrides: { PORT: "1420" },
        replayAction: "start",
      },
      createdAt: "2026-07-16T22:39:13.657Z",
      updatedAt: "2026-07-16T22:39:13.657Z",
    }),
  ]);
  const { preferences: activityPreferences } = useActivityPreferences();
  const theme = useMemo(
    () => createAppTheme(styleMode === "mono" ? "mono" : "light"),
    [styleMode],
  );
  useEffect(() => {
    document.documentElement.dataset.style =
      styleMode === "mono" ? "mono" : "light";
  }, [styleMode]);
  const enabledNavItems = useMemo(
    () => visibleNavItems.filter((item) => enabledPages.includes(item.key)),
    [enabledPages],
  );
  const visibleActivityItems = useMemo(
    () =>
      activityItems.filter((item) =>
        activityVisibleWithPreferences(item, activityPreferences),
      ),
    [activityItems, activityPreferences],
  );
  const content =
    activePage === "projectManagement"
      ? projectManagementContent[projectManagementView]
      : "总览内容";
  const renderSmokeOverview = () => (
    <OverviewPage
      projectWorkspaces={smokeWorkspaces}
      archivedProjectWorkspaces={smokeArchivedWorkspaces}
      activeProjectWorkspaceKey={
        smokeWorkspaces.some(
          (workspace) => workspace.key === smokeParams.get("overviewWorkspace"),
        )
          ? (smokeParams.get("overviewWorkspace") as string)
          : "feature_demo_checkout"
      }
      onProjectWorkspaceChange={() => undefined}
      onNavigateToPage={() => undefined}
      onProjectManagementViewChange={() => undefined}
      onProjectChange={() => undefined}
      onOpenProjectManagementTarget={(projectKey, target) => {
        setWorkspaceRuntimeActionState(
          target.kind === "projectSettings"
            ? `${projectKey}:projectSettings:${target.section}`
            : `${projectKey}:runtimePanel:${target.tab}`,
        );
      }}
      onCreateProjectWorkspace={() => undefined}
      onInitDemandWorkspace={() => ({
        key: "feature_demo_checkout",
        name: "需求工作区",
        demandId: "REQ-1234",
        project: {
          key: "demo",
          name: "示例控制台",
          repoPath: "/mock/workspaces/feature/demo",
        },
        requirementEntry: {
          category: "需求",
          shortLabel: "REQ-1234",
          name: "需求记录",
          path: "/mock/workspaces/feature/resources/WORKLOG.md",
        },
        resources: {
          workspaceKey: "feature_demo_checkout",
          workspaceName: "需求工作区",
          resourceDir: "/mock/workspaces/feature/resources",
          worklogFile: "WORKLOG.md",
          worklogPath: "/mock/workspaces/feature/resources/WORKLOG.md",
          worklogExists: true,
          worklogCreated: true,
          autoRecordEnabled: true,
        },
        branch: {
          expected: "feature/REQ-1234",
          current: "feature/REQ-1234",
          matches: true,
        },
        metadata: {},
        warnings: [],
      })}
      onProjectConfigSaved={() => undefined}
      workspaceConfigOpenSignal={workspaceConfigFocusRequest?.nonce ?? 0}
      workspaceConfigFocusRequest={workspaceConfigFocusRequest}
      onWorkspaceConfigOpenHandled={() => undefined}
      runtimeEntries={[runtimeSmokeEntry]}
      selectedDebugProfileKeys={{
        demo:
          runtimeSmokeProfileRepairMode === "create"
            ? ""
            : runtimeSmokeProfileRepairMode === "reset"
              ? "removed"
              : "uat3-vke",
      }}
      runtimeStartPromptMode="auto"
      projectRuntimePreferencesHydrated
      onProjectDebugProfileChange={(_projectKey, profileKey) =>
        setWorkspaceRuntimeSelectedProfile(profileKey)
      }
      onRuntimeStartPromptModeChange={() => undefined}
      onStartProjectRuntime={(
        projectKey,
        debugProfileKey,
        _envOverrides,
        expectedPort,
      ) => {
        setWorkspaceRuntimeStartState(
          [projectKey, debugProfileKey || "base", expectedPort || ""]
            .filter(Boolean)
            .join(":"),
        );
      }}
      onStartProxyProfile={(profileId, sourceId) => {
        runtimeSmokeProxyRunning = true;
        setWorkspaceRuntimeProxyState(`${profileId}:${sourceId || "default"}`);
      }}
      onStopProxyProfile={() => undefined}
      onFocusProjectRuntime={() => undefined}
      onExecutePinnedAction={async () => undefined}
      workflowChains={[smokeWorkspaceWorkflowChain]}
      workflowRunStates={
        new URLSearchParams(window.location.search).get("workflowRun") ===
        "running"
          ? [smokeWorkspaceWorkflowRunState]
          : []
      }
      onSaveWorkflowChain={async () => undefined}
      onDeleteWorkflowChain={async () => undefined}
      onWorkflowChainEnabledChange={async () => undefined}
      onRunWorkflowChain={async () => "smoke-workflow-run"}
      onCancelWorkflowRun={async () => undefined}
    />
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppShellLayout
        visibleNavItems={enabledNavItems}
        activePage={activePage}
        onPageChange={setActivePage}
        projectManagementView={projectManagementView}
        onProjectManagementViewChange={setProjectManagementView}
        enabledPages={enabledPages}
        onEnabledPagesChange={setEnabledPages}
        defaultPage={defaultPage}
        onDefaultPageChange={setDefaultPage}
        styleMode={styleMode}
        onStyleModeChange={setStyleMode}
        exitRuntimePolicy={exitRuntimePolicy}
        onExitRuntimePolicyChange={setExitRuntimePolicy}
        projectWorkspaces={smokeWorkspaces}
        activeProjectWorkspaceKey={activeWorkspaceKey}
        onProjectWorkspaceChange={setActiveWorkspaceKey}
        selectedProjectKey=""
        onOpenConfigDir={() => undefined}
        onOpenConfigFile={() => undefined}
        onOpenProjectWorkspacesDir={() => undefined}
        onOpenNavigationConfigFile={() => undefined}
        onOpenWorkspaceConfig={() => undefined}
        onOpenResourceConfig={() => undefined}
        onCreateProjectWorkspace={() => undefined}
        onProjectConfigSaved={() => undefined}
        activityItems={visibleActivityItems}
        activeSessions={[
          {
            id: "runtime:rdevtool",
            kind: "runtime",
            scope: "current",
            name: "rDevTool",
            statusKey: "running",
            statusLabel: "运行中",
            detail: "dev 服务正在监听",
            projectKey: "rdevtool",
            endpoint: "http://127.0.0.1:1420",
            port: 1420,
            pid: 42180,
            startedAtMs: Date.now() - 48 * 60_000,
            observedAtMs: Date.now(),
            logPath: "/tmp/rdevtool-runtime.log",
            directoryPath: "/workspace/rdevtool",
            managed: true,
            external: false,
            canAdopt: false,
            canFocus: true,
            canStop: true,
            canOpenLog: true,
            canOpenDirectory: true,
            canOpenOutput: false,
          },
          {
            id: "runtime:legacy-portal",
            kind: "runtime",
            scope: "current",
            name: "Legacy Portal",
            statusKey: "external",
            statusLabel: "运行中（外部）",
            detail: "检测到可认领的外部 dev 服务",
            projectKey: "legacy-portal",
            endpoint: "http://127.0.0.1:1420",
            port: 1420,
            pid: 42201,
            startedAtMs: null,
            observedAtMs: Date.now(),
            directoryPath: "/workspace/legacy-portal",
            managed: false,
            external: true,
            canAdopt: true,
            canFocus: true,
            canStop: false,
            canOpenLog: false,
            canOpenDirectory: true,
            canOpenOutput: false,
          },
          {
            id: "proxy:default:local-api",
            kind: "proxy",
            scope: "shared",
            name: "Local API",
            statusKey: "running",
            statusLabel: "运行中",
            detail: "http://127.0.0.1:8791",
            proxyProfileId: "local-api",
            proxySourceId: "default",
            endpoint: "http://127.0.0.1:8791",
            port: 8791,
            pid: 42194,
            startedAtMs: Date.now() - 26 * 60_000,
            observedAtMs: Date.now(),
            managed: true,
            external: false,
            canAdopt: false,
            canFocus: false,
            canStop: true,
            canOpenLog: false,
            canOpenDirectory: false,
            canOpenOutput: false,
            proxyActivity: {
              requestCount: 12,
              errorCount: 1,
              lastRequestAtMs: Date.now() - 34_000,
              lastRequestMethod: "GET",
              lastRequestPath: "/api/orders",
              lastRequestStatus: 200,
            },
          },
          {
            id: "browser:9223",
            kind: "browser",
            scope: "shared",
            name: "Chrome",
            statusKey: "connected",
            statusLabel: "CDP 已连接",
            detail: "",
            endpoint: "http://127.0.0.1:9223",
            port: 9223,
            observedAtMs: Date.now(),
            managed: false,
            external: false,
            canAdopt: false,
            canFocus: false,
            canStop: false,
            canOpenLog: false,
            canOpenDirectory: false,
            canOpenOutput: false,
            browserInfo: {
              id: "browser:9223",
              port: 9223,
              endpoint: "http://127.0.0.1:9223",
              browserName: "Chrome",
              browserVersion: "139.0.7258.67",
              protocolVersion: "1.3",
              pageCount: 3,
              pages: [
                {
                  id: "page-portal",
                  title: "Portal Dashboard",
                  url: "http://127.0.0.1:1420/dashboard",
                },
                {
                  id: "page-docs",
                  title: "API Documentation",
                  url: "https://docs.example.com/api",
                },
              ],
              runtimeProfileKeys: ["web-cdp"],
              activeProjects: [{ key: "rdevtool", name: "rDevTool" }],
              configuredProjects: [
                { key: "rdevtool", name: "rDevTool" },
                { key: "portal", name: "Portal" },
              ],
            },
          },
        ]}
        activeSessionsLoading={false}
        activeSessionsError=""
        onOpenActivityEntry={() => undefined}
        onOpenActivityResource={() => undefined}
        onRefreshActiveSessions={() => undefined}
        onRunActiveSessionAction={(session, action) => ({
          ok: true,
          inspection:
            action === "inspect"
              ? {
                  port: session.port ?? 1420,
                  inspectedAtMs: Date.now(),
                  platformSupported: true,
                  listening: true,
                  ownershipKey:
                    session.id === "runtime:rdevtool" ? "expectedPid" : "mismatch",
                  ownershipVerified: session.id === "runtime:rdevtool",
                  expectedPid: session.pid ?? null,
                  expectedDirectoryPath: session.directoryPath ?? null,
                  listeners: [
                    {
                      pid: 42180,
                      ppid: 42000,
                      pgid: 42180,
                      name: "node",
                      command: "node ./node_modules/vite/bin/vite.js --port 1420",
                      cwd: "/workspace/rdevtool",
                      startedAt: "Sun Aug 3 10:12:00 2026",
                      matchesExpectedPid: session.id === "runtime:rdevtool",
                      matchesExpectedDirectory: session.id === "runtime:rdevtool",
                    },
                  ],
                }
              : null,
          message:
            action === "stop"
              ? "运行资源已停止"
              : action === "adopt"
                ? "已纳入 rDevTool 管理"
                : null,
        })}
        onRunActivityAction={(entry) => {
          if (entry.action?.kind === "linkRecover") {
            const checkedAt = new Date().toISOString();
            const recoveredAt = new Date(Date.now() + 1).toISOString();
            setActivityItems((current) => [
              createActivityEntry({
                id: "link-check-success",
                kind: "link",
                origin: "app",
                status: "success",
                title: "检查联调链路",
                summary: `${entry.action?.kind === "linkRecover" ? entry.action.linkName : "联调链路"} · 检查通过`,
                executionKey: entry.executionKey,
                diagnostics: [
                  {
                    id: "proxy",
                    type: "proxy.start",
                    label: "启动代理",
                    status: "ready",
                    summary: "代理配置有效，可以安全启动",
                    risks: [],
                  },
                ],
                target: entry.target,
                createdAt: checkedAt,
                updatedAt: checkedAt,
              }),
              createActivityEntry({
                id: "link-retry-success",
                kind: "link",
                origin: "app",
                status: "success",
                title: "启动联调链路",
                summary: `${entry.action?.kind === "linkRecover" ? entry.action.linkName : "联调链路"} · 重试成功`,
                executionKey: entry.executionKey,
                target: entry.target,
                createdAt: recoveredAt,
                updatedAt: recoveredAt,
              }),
              ...current.map((item) =>
                item.id === entry.id
                  ? {
                      ...item,
                      action: null,
                      acknowledgedAt: recoveredAt,
                    }
                  : item,
              ),
            ]);
            return;
          }
          if (
            entry.action?.kind === "branchReplay" ||
            entry.action?.kind === "buildRecover" ||
            entry.action?.kind === "runtimeRecover" ||
            entry.action?.kind === "proxyRecover"
          ) {
            const recoveredAt = new Date().toISOString();
            const recoveredKind = entry.action.kind;
            const recoveredTitle =
              recoveredKind === "branchReplay"
                ? "Git 操作重试成功"
                : recoveredKind === "buildRecover"
                  ? "构建已重新触发"
                  : recoveredKind === "runtimeRecover"
                    ? "dev 服务已启动"
                    : "代理服务已启动";
            setActivityItems((current) => [
              createActivityEntry({
                id: `${entry.id}:recovered`,
                kind: entry.kind,
                origin: "app",
                status:
                  recoveredKind === "buildRecover" ? "running" : "success",
                title: recoveredTitle,
                summary:
                  recoveredKind === "buildRecover"
                    ? `${entry.projectName || entry.summary.split(" · ")[0]} · 重新规划通过，已触发新构建`
                    : `${entry.projectName || entry.summary.split(" · ")[0]} · 检查通过并重试成功`,
                executionKey: entry.executionKey,
                projectKey: entry.projectKey,
                projectName: entry.projectName,
                target: entry.target,
                createdAt: recoveredAt,
                updatedAt: recoveredAt,
              }),
              ...current.map((item) =>
                item.id === entry.id
                  ? {
                      ...item,
                      action: null,
                      acknowledgedAt: recoveredAt,
                    }
                  : item,
              ),
            ]);
            return;
          }
          setActivityItems((current) =>
            current.map((item) =>
              item.action?.kind === "reloadConfig"
                ? {
                    ...item,
                    status: "success",
                    summary: "已重新加载并应用最新配置",
                    action: null,
                    acknowledgedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                  }
                : item,
            ),
          );
        }}
        onRefreshActivities={() => undefined}
        onResolveActivityEntry={(entry) => {
          const resolvedAt = new Date().toISOString();
          setActivityItems((current) =>
            current.map((item) =>
              item.id === entry.id
                ? {
                    ...item,
                    status:
                      item.kind === "config" && item.status === "running"
                        ? "info"
                        : item.status,
                    action: null,
                    acknowledgedAt: resolvedAt,
                    updatedAt: resolvedAt,
                  }
                : item,
            ),
          );
        }}
        onResolveActivityEntries={(entries) => {
          const targetIds = new Set(entries.map((entry) => entry.id));
          const resolvedAt = new Date().toISOString();
          setActivityItems((current) =>
            current.map((item) =>
              targetIds.has(item.id)
                ? {
                    ...item,
                    status:
                      item.kind === "config" && item.status === "running"
                        ? "info"
                        : item.status,
                    action: null,
                    acknowledgedAt: resolvedAt,
                    updatedAt: resolvedAt,
                  }
                : item,
            ),
          );
        }}
        onClearHandledActivities={() => {
          setActivityItems((current) =>
            current.filter(
              (item) =>
                activityRequiresAttention(item) || item.status === "running",
            ),
          );
        }}
        busy=""
        error=""
      >
        {activePage === "knowledge" ? (
          <KnowledgePage
            projects={[{ key: "demo", name: "示例项目" }]}
            selectedProject="demo"
          />
        ) : null}
        {activePage === "proxy" ? (
          <ProxyPage
            dashboard={smokeProxyDashboard}
            activeProjectWorkspaceKey={activeWorkspaceKey}
            selectedProfileId={selectedProxyProfileId}
            loading={false}
            busy=""
            error=""
            onSelectedProfileChange={setSelectedProxyProfileId}
            onRefresh={() => undefined}
            onSaveProfile={async () => smokeProxyDashboard}
            onDeleteProfile={async () => smokeProxyDashboard}
            onSaveRule={async () => smokeProxyDashboard}
            onDeleteRule={async () => smokeProxyDashboard}
            onStartProfile={async () => smokeProxyDashboard}
            onStopProfile={async () => smokeProxyDashboard}
            onClearEvents={async () => smokeProxyDashboard}
            onExportProfilePack={async () => smokeProxyDashboard}
            onImportProfilePack={async () => smokeProxyDashboard}
            onDiagnoseRequest={async () => {
              throw new Error("Smoke 中未执行请求诊断");
            }}
          />
        ) : null}
        {documentationGitScreenshot ? <DocumentationGitPage /> : null}
        {documentationBuildScreenshot ? <DocumentationBuildPage /> : null}
        {documentationProjectsScreenshot ? <DocumentationProjectsPage /> : null}
        {documentationRuntimeScreenshot ? <DocumentationProjectsPage /> : null}
        {documentationResourcesScreenshot ? <DocumentationResourcesPage /> : null}
        {documentationActivityScreenshot ? (
          <Box
            className="activity-documentation-overview"
            sx={{ height: "100%", minHeight: 0, overflow: "hidden" }}
          >
            {renderSmokeOverview()}
          </Box>
        ) : null}
        <section
          aria-label="烟雾测试内容"
          hidden={
            Boolean(documentationScreenshot) ||
            activePage === "knowledge" ||
            activePage === "proxy"
          }
        >
          <h1>{content}</h1>
          <output data-testid="active-state">
            {activePage}/{projectManagementView}
          </output>
          <output data-testid="config-activity-state">
            {activityItems[0]?.status ?? "missing"}
          </output>
          <output data-testid="active-workspace-state">
            {activeWorkspaceKey}
          </output>
          <ConfirmationSmokeHarness />
          <Button
            variant="outlined"
            onClick={() => {
              setConfigSourceCompareOnOpen(false);
              setConfigSourceManagerOpen(true);
            }}
          >
            打开配置源管理
          </Button>
          <Button
            variant="outlined"
            onClick={() => {
              setConfigSourceCompareOnOpen(true);
              setConfigSourceManagerOpen(true);
            }}
          >
            比较配置变更
          </Button>
          <Button
            variant="outlined"
            onClick={() => setProjectBuildConfigOpen(true)}
          >
            打开构建配置测试
          </Button>
          <Button
            variant="outlined"
            onClick={() => setRuntimeConfigSmokeOpen(true)}
          >
            打开运行配置来源测试
          </Button>
          <Button
            variant="outlined"
            onClick={() =>
              setResourceActionSmokeTarget({
                key: "batch-deploy-pre",
                entryName: "批量部署 Pre",
              })
            }
          >
            打开参数化 Action 测试
          </Button>
          <Button
            variant="outlined"
            onClick={() =>
              setResourceActionSmokeTarget({
                key: "refresh-deploy-cache",
                entryName: "刷新部署缓存",
              })
            }
          >
            打开无参数 Action 测试
          </Button>
          <Button
            variant="outlined"
            onClick={() => setBranchHistorySmokeOpen(true)}
          >
            打开分支 Record 测试
          </Button>
          <Button
            variant="outlined"
            onClick={() => setBuildHistorySmokeOpen(true)}
          >
            打开 Build Record 测试
          </Button>
          <Button
            variant="outlined"
            onClick={() => {
              setWorkspaceConfigFocusRequest(null);
              runtimeSmokeProxyRunning = false;
              runtimeSmokePortConflict = false;
              runtimeSmokeProfileRepairMode = "";
              workspaceInstanceRepairMode = false;
              setWorkspaceRuntimeProxyState("");
              setWorkspaceRuntimeSelectedProfile("");
              setWorkspaceRuntimeSmokeOpen(true);
            }}
          >
            打开工作区运行来源测试
          </Button>
          <Button
            variant="outlined"
            onClick={() => {
              setWorkspaceConfigFocusRequest(null);
              workspaceInstanceRepairMode = true;
              setWorkspaceRuntimeSmokeOpen(true);
            }}
          >
            打开工作区副本修复测试
          </Button>
          <Button
            variant="outlined"
            onClick={() => {
              setWorkspaceConfigFocusRequest({
                nonce: Date.now(),
                view: "archived",
                workspaceKey: "feature-archived",
              });
              setWorkspaceRuntimeSmokeOpen(true);
            }}
          >
            打开归档工作区定位测试
          </Button>
          <Button
            variant="outlined"
            onClick={() => {
              runtimeSmokeProxyRunning = true;
              runtimeSmokePortConflict = true;
              runtimeSmokeProfileRepairMode = "";
              setWorkspaceRuntimeStartState("");
              setWorkspaceRuntimeSelectedProfile("");
              setWorkspaceRuntimeSmokeOpen(true);
            }}
          >
            打开端口冲突修复测试
          </Button>
          <Button
            variant="outlined"
            onClick={() => {
              runtimeSmokeProxyRunning = true;
              runtimeSmokePortConflict = false;
              runtimeSmokeProfileRepairMode = "create";
              setWorkspaceRuntimeSelectedProfile("");
              setWorkspaceRuntimeSmokeOpen(true);
            }}
          >
            打开启动档案生成测试
          </Button>
          <Button
            variant="outlined"
            onClick={() => {
              runtimeSmokeProxyRunning = true;
              runtimeSmokePortConflict = false;
              runtimeSmokeProfileRepairMode = "reset";
              setWorkspaceRuntimeSelectedProfile("removed");
              setWorkspaceRuntimeSmokeOpen(true);
            }}
          >
            打开失效档案修复测试
          </Button>
          {branchHistorySmokeOpen ? (
            <Box
              aria-label="分支 Record 测试"
              sx={{
                position: "fixed",
                inset: 0,
                zIndex: 1100,
                bgcolor: "background.default",
                overflow: "hidden",
                p: 1.5,
              }}
            >
              <Box className="workspace workspace--workflow" sx={{ height: "100%" }}>
                <BranchHistoryPanel
                  expanded
                  history={smokeBranchHistory}
                  currentHistoryId="branch-history-batch-latest"
                  currentTask={null}
                  busy=""
                  workflowGroupCount={0}
                  workflowSignalIdsForBranchReplay={() => []}
                  onToggleExpanded={() => undefined}
                  onOpenWorkflowList={() => undefined}
                  onRefreshHistory={() => undefined}
                  onClearHistory={() => undefined}
                  onReplayHistory={() => undefined}
                  onConfigureWorkflow={() => undefined}
                  onOpenTaskOutput={() => undefined}
                  formatRelativeTime={(value) => value ?? ""}
                />
              </Box>
              <Button
                size="small"
                variant="outlined"
                onClick={() => setBranchHistorySmokeOpen(false)}
                sx={{ position: "fixed", right: 22, bottom: 18, zIndex: 2 }}
              >
                关闭分支 Record 测试
              </Button>
            </Box>
          ) : null}
          {buildHistorySmokeOpen ? (
            <Box
              aria-label="Build Record 测试"
              sx={{
                position: "fixed",
                inset: 0,
                zIndex: 1100,
                bgcolor: "background.default",
                overflow: "hidden",
                p: 1.5,
              }}
            >
              <Box className="workspace workspace--workflow" sx={{ height: "100%" }}>
                <BuildRecordSmokePanel />
              </Box>
              <Button
                size="small"
                variant="outlined"
                onClick={() => setBuildHistorySmokeOpen(false)}
                sx={{ position: "fixed", right: 22, bottom: 18, zIndex: 2 }}
              >
                关闭 Build Record 测试
              </Button>
            </Box>
          ) : null}
          {workspaceRuntimeSmokeOpen ? (
            <Box
              aria-label="工作区运行来源测试"
              sx={{
                position:
                  documentationActionScreenshot || documentationActivityScreenshot
                    ? "relative"
                    : "fixed",
                inset:
                  documentationActionScreenshot || documentationActivityScreenshot
                    ? "auto"
                    : 0,
                zIndex:
                  documentationActionScreenshot || documentationActivityScreenshot
                    ? "auto"
                    : 1100,
                bgcolor: "background.default",
                overflow: "auto",
                p:
                  documentationActionScreenshot || documentationActivityScreenshot
                    ? 0
                    : 1,
              }}
            >
              {documentationActionScreenshot || documentationActivityScreenshot ? null : (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setWorkspaceRuntimeSmokeOpen(false)}
                  sx={{ position: "fixed", right: 12, bottom: 12, zIndex: 2 }}
                >
                  关闭工作区运行来源测试
                </Button>
              )}
              {renderSmokeOverview()}
              <output data-testid="workspace-runtime-start-state">
                {workspaceRuntimeStartState}
              </output>
              <output data-testid="workspace-runtime-action-state">
                {workspaceRuntimeActionState}
              </output>
              <output data-testid="workspace-runtime-proxy-state">
                {workspaceRuntimeProxyState}
              </output>
              <output data-testid="workspace-runtime-profile-state">
                {workspaceRuntimeSelectedProfile || "base"}
              </output>
            </Box>
          ) : null}
          {runtimeConfigSmokeOpen ? (
            <Box
              aria-label="运行配置来源测试"
              sx={{
                position: "fixed",
                inset: 0,
                zIndex: 1100,
                bgcolor: "background.default",
                overflow: "hidden",
                p: 1,
              }}
            >
              <Button
                size="small"
                variant="outlined"
                onClick={() => setRuntimeConfigSmokeOpen(false)}
                sx={{ position: "absolute", top: 10, right: 12, zIndex: 2 }}
              >
                关闭运行配置测试
              </Button>
              <ProjectsPage
                mode="projectManagement"
                finderTypeOptions={["项目", "网站", "目录", "工具"]}
                finderType="项目"
                finderTypeCounts={{ 项目: 1, 网站: 0, 目录: 0, 工具: 0 }}
                onFinderTypeChange={() => undefined}
                finderCategories={["全部", "工作"]}
                finderCategory="全部"
                finderCategoryCounts={{ 全部: 1, 工作: 1 }}
                onFinderCategoryChange={() => undefined}
                finderQuery=""
                onFinderQueryChange={() => undefined}
                runtimeEntries={[runtimeSmokeEntry]}
                filteredRuntimeEntries={[runtimeSmokeEntry]}
                shortcutEntries={[]}
                filteredShortcutEntries={[]}
                favoriteProjectKeys={[]}
                recentProjectKeys={[]}
                favoriteShortcutKeys={[]}
                recentShortcutKeys={[]}
                selectedDebugProfileKeys={{ demo: "uat3-vke" }}
                runtimeStartPromptMode="auto"
                workflowReceiveRules={[]}
                workflowBroadcastRules={[]}
                workflowSignalOptions={[]}
                workflowSignalSummaries={[]}
                workflowReceiveSignalIdsForProjectReplay={() => []}
                workflowBroadcastSignalIdsForProjectReplay={() => []}
                onWorkflowProjectReplayRulesChange={() => undefined}
                onWorkflowReceiveRulesEnabledChange={() => undefined}
                onWorkflowReceiveRulesDelete={() => undefined}
                onWorkflowBroadcastRulesEnabledChange={() => undefined}
                onWorkflowBroadcastRulesDelete={() => undefined}
                onWorkflowSignalDelete={() => undefined}
                onWorkflowSignalsClear={() => undefined}
                onToggleProjectFavorite={() => undefined}
                onToggleShortcutFavorite={() => undefined}
                onProjectDebugProfileChange={() => undefined}
                onRuntimeStartPromptModeChange={() => undefined}
                onMarkShortcutUsed={() => undefined}
                onRefresh={() => undefined}
                onOpenFinderEntry={() => false}
                onStartRuntime={() => undefined}
                onStopRuntime={() => undefined}
                onAdoptRuntime={() => undefined}
                onOpenBuildOutput={() => undefined}
                onFocusRuntime={() => undefined}
                onOpenProjectDirectory={() => undefined}
                configWorkspaceKey="feature_demo_checkout"
                projectConfigPanel={{
                  styleMode,
                  onStyleModeChange: setStyleMode,
                  exitRuntimePolicy,
                  onExitRuntimePolicyChange: setExitRuntimePolicy,
                  selectedProjectKey: "demo",
                  onOpenConfigDir: () => undefined,
                  onOpenConfigFile: () => undefined,
                  onOpenProjectWorkspacesDir: () => undefined,
                  onOpenNavigationConfigFile: () => undefined,
                  onCreateProjectWorkspace: () => undefined,
                  projectWorkspaces: smokeWorkspaces,
                  activeProjectWorkspaceKey: "feature_demo_checkout",
                  activePage,
                  enabledPages,
                  onEnabledPagesChange: setEnabledPages,
                  defaultPage,
                  onDefaultPageChange: setDefaultPage,
                  onProjectConfigSaved: () => undefined,
                }}
              />
            </Box>
          ) : null}
          {projectBuildConfigOpen ? (
            <SettingsPanel
              surface="projectManagement"
              styleMode={styleMode}
              onStyleModeChange={setStyleMode}
              exitRuntimePolicy={exitRuntimePolicy}
              onExitRuntimePolicyChange={setExitRuntimePolicy}
              selectedProjectKey="demo"
              onOpenConfigDir={() => undefined}
              onOpenConfigFile={() => undefined}
              onOpenProjectWorkspacesDir={() => undefined}
              onOpenNavigationConfigFile={() => undefined}
              onCreateProjectWorkspace={() => undefined}
              projectWorkspaces={smokeWorkspaces}
              activeProjectWorkspaceKey={activeWorkspaceKey}
              initialSection="projectBuild"
              activePage={activePage}
              enabledPages={enabledPages}
              onEnabledPagesChange={setEnabledPages}
              defaultPage={defaultPage}
              onDefaultPageChange={setDefaultPage}
              onProjectConfigSaved={() => undefined}
              onClose={() => setProjectBuildConfigOpen(false)}
            />
          ) : null}
          <ResourceActionDialog
            open={Boolean(resourceActionSmokeTarget)}
            target={
              resourceActionSmokeTarget
                ? {
                    key: resourceActionSmokeTarget.key,
                    sourceId: "default",
                    entryName: resourceActionSmokeTarget.entryName,
                    mode: "run",
                  }
                : null
            }
            onClose={() => setResourceActionSmokeTarget(null)}
          />
          <section
            aria-label="工作副本恢复测试"
            style={{ maxWidth: 760, marginTop: 16 }}
          >
            <WorktreeSelector
              items={worktreeItems}
              value={selectedWorktreePath}
              loading={false}
              error=""
              disabled={false}
              onChange={setSelectedWorktreePath}
              onChooseDirectory={() => undefined}
              onRefresh={() => undefined}
              onRepair={(repoPath) => {
                setWorktreeItems((current) =>
                  current.map((item) =>
                    item.repoPath === repoPath
                      ? {
                          ...item,
                          clean: true,
                          statusKey: "clean",
                          statusLabel: "干净",
                          detail: "工作副本已恢复，可以继续切换分支。",
                        }
                      : item,
                  ),
                );
              }}
            />
          </section>
          <ConfigSourceManagerDialog
            open={configSourceManagerOpen}
            initialSourceId="default"
            compareOnOpen={configSourceCompareOnOpen}
            onClose={() => {
              setConfigSourceManagerOpen(false);
              setConfigSourceCompareOnOpen(false);
            }}
          />
        </section>
      </AppShellLayout>
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <I18nProvider systemLanguageOverride="zh-CN">
    <SidebarSmokeHarness />
  </I18nProvider>,
);
