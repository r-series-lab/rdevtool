import { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { Box, Button, CssBaseline, ThemeProvider } from "@mui/material";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { PageKey } from "./app-shell";
import type {
  ConfigSource,
  ConfigSourceComparison,
  ConfigSourceCopyRequest,
  ConfigSourceCopyResult,
  ConfigSourceFileInspection,
  ConfigSourceInspection,
  BranchWorktreeSummary,
  ManagedArtifactInventoryResponse,
  ProjectConfigEditorState,
  DeployTargetConfigSummary,
  ProjectManagementViewKey,
  ProjectRuntimeContextSnapshot,
  ProjectRuntimeEntry,
  ProjectRuntimePreflightResponse,
  SaveProjectRuntimeLaunchProfileResponse,
  ProjectWorkspaceSummary,
  WorkspaceConfigFocusRequest,
} from "./app-types";
import { AppShellLayout } from "./components/AppShellLayout";
import { SettingsPanel } from "./components/SettingsPanel";
import { useAppConfirmDialog } from "./components/AppConfirmDialog";
import { ConfigSourceManagerDialog } from "./components/ConfigSourceManagerDialog";
import { useActivityPreferences } from "./hooks/useActivityPreferences";
import { WorktreeSelector } from "./pages/MergePage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { OverviewPage } from "./pages/OverviewPage";
import { KnowledgePage } from "./pages/KnowledgePage";
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
import { I18nProvider } from "./i18n";
import "./styles.css";

const visibleNavItems: Array<{
  key: PageKey;
  label: string;
  shortLabel: string;
}> = [
  { key: "overview", label: "总览", shortLabel: "总览" },
  { key: "knowledge", label: "知识库", shortLabel: "知识库" },
  {
    key: "projectManagement",
    label: "项目管理",
    shortLabel: "项目管理",
  },
  { key: "resources", label: "资源管理", shortLabel: "资源管理" },
  { key: "proxy", label: "代理配置", shortLabel: "代理配置" },
];

const projectManagementContent: Record<ProjectManagementViewKey, string> = {
  projects: "项目内容",
  build: "构建内容",
  git: "Git 内容",
};

const smokeKnowledgeDocuments = [
  {
    source: "file",
    scope: "project",
    projectKey: "demo",
    title: "本地代理排障",
    summary: "遇到接口 500 时，先确认代理监听、匹配规则和下一跳。",
    path: "/mock/notes/projects/demo/proxy-debug.md",
    relativePath: "projects/demo/proxy-debug.md",
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

let smokeKnowledgeReadCount = 0;

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
    key: "feature_cr2605096894",
    name: "CR2605096894 履约邮礼",
    projectCount: 1,
    workspaceKind: "directory",
  }),
  createSmokeWorkspace({
    key: "feature_cr2606117424_exchange",
    name: "CR2606117424 全流量权益兑换流程优化V1.1",
    projectCount: 1,
    workspaceType: "business",
    workspaceKind: "directory",
  }),
  createSmokeWorkspace({
    key: "feature_cr2606150041_ykd_car",
    name: "CR2606150041 优客贷车后消费场景引流",
    projectCount: 2,
    workspaceKind: "directory",
  }),
  createSmokeWorkspace({ key: "r-series", name: "R系列", projectCount: 11 }),
  createSmokeWorkspace({
    key: "t",
    name: "t",
    projectCount: 0,
    workspaceType: "business",
  }),
];

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
  name: "智能营销",
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
  key: "dc2-vke",
  label: "DC2 VKE",
  command: "npm run dev -- --mode dc2-vke",
  expectedPort: 5174,
  focusUrl: "http://127.0.0.1:5174/",
  env: {
    APP_ENV: "dc2-vke",
    API_REGION: "dc2",
  },
});

const smokeWorkspacePushAction: TrayPinnedAction = {
  kind: "branch.replay",
  label: "推送功能分支",
  workspaceKey: "feature_cr2606150041_ykd_car",
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
  workspaceKey: "feature_cr2606150041_ykd_car",
  projectKey: "demo",
  payload: {
    project: "demo",
    target: "vke",
    params: { BRANCH: "feature/CR2606150041" },
  },
  dedupeKey: "build:demo:vke",
  updatedAtMs: Date.parse("2026-07-29T09:32:00+08:00"),
};

const smokeWorkspaceWorkflowChain: WorkspaceWorkflowChain = {
  id: "smoke-delivery",
  workspaceKey: "feature_cr2606150041_ykd_car",
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

const workspaceRuntimeOverview = [
  {
    key: "feature_cr2606150041_ykd_car",
    name: "CR2606150041 优客贷车后消费场景引流",
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
    entryCount: 0,
    actionCount: 2,
    proxyProfileCount: 0,
    resources: [],
    projectDirectories: [
      {
        projectKey: "demo",
        projectName: "智能营销",
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
        params: [{ label: "BRANCH", value: "feature/CR2606150041" }],
        confirmRequired: true,
        updatedAtMs: smokeWorkspaceBuildAction.updatedAtMs,
      },
    ],
  },
];

const workspaceRuntimeEditor = {
  workspace: {
    key: "feature_cr2606150041_ykd_car",
    name: "CR2606150041 优客贷车后消费场景引流",
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
  },
  projects: [
    {
      key: "demo",
      name: "智能营销",
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
    key: "feature_cr2606150041_ykd_car",
    name: "CR2606150041 优客贷车后消费场景引流",
    system: false,
    projectInstancePath: "/mock/workspaces/feature/demo",
    projectInstanceManaged: true,
    runtimeConfigSourceId: "workspace-feature_cr2606150041_ykd_car",
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
  projectName: "智能营销",
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

const configFileDefinitions = [
  {
    key: "navigation",
    label: "资源入口",
    capability: "resource",
    fileName: "navigation.toml",
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
      total: 4,
      matching: 3,
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

mockIPC(
  (command, payload) => {
    const args = payload as Record<string, unknown> | undefined;
    switch (command) {
      case "storage_get_json":
      case "storage_set_json":
      case "storage_delete_json":
        return null;
      case "storage_prepend_json_array":
        return [args?.value];
      case "list_operation_event_history":
        return [];
      case "list_config_sources":
        return mockSources;
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
                  profileLabel: "智能营销 本地启动",
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
      case "list_web_action_navigation_targets":
        return [
          {
            id: "runtime-smoke-page",
            title: "智能营销",
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
        return managedArtifactInventory;
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
      case "get_health_snapshot":
        return {
          schemaVersion: 1,
          generatedAtMs: Date.now(),
          statusKey: "ok",
          statusLabel: "正常",
          summary: "rDevTool 本机状态正常。",
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
              largestFileBytes: 8_192,
              statusKey: "ok",
              detail: "3 个文件",
            },
          ],
          risks: [],
        };
      case "get_proxy_dashboard":
        return {
          configPath: "/mock/proxy.toml",
          config: {
            profiles: [
              {
                id: "smoke-proxy",
                workspaceKey: "feature_cr2606150041_ykd_car",
                name: "优客贷车后本地代理",
                listenHost: "127.0.0.1",
                listenPort: 8791,
                upstreamBaseUrl: "",
                upstreamProxy: "",
                captureBody: true,
                maxBodyBytes: 262_144,
              },
            ],
            rules: [],
          },
          statuses: [
            {
              profileId: "smoke-proxy",
              running: true,
              listenUrl: "http://127.0.0.1:8791",
              startedAt: "2026-07-27T10:00:00+08:00",
            },
          ],
          events: [],
        };
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
  const [activePage, setActivePage] = useState<PageKey>("overview");
  const [projectManagementView, setProjectManagementView] =
    useState<ProjectManagementViewKey>("projects");
  const [styleMode, setStyleMode] = useState<AppStyleMode>(() =>
    new URLSearchParams(window.location.search).get("style") === "mono"
      ? "mono"
      : "light",
  );
  const [activeWorkspaceKey, setActiveWorkspaceKey] = useState("system");
  const [exitRuntimePolicy, setExitRuntimePolicy] = useState<
    "ask" | "keep" | "stop"
  >("ask");
  const [enabledPages, setEnabledPages] = useState<PageKey[]>(() =>
    visibleNavItems.map((item) => item.key),
  );
  const [defaultPage, setDefaultPage] = useState<PageKey>("overview");
  const [configSourceManagerOpen, setConfigSourceManagerOpen] = useState(false);
  const [configSourceCompareOnOpen, setConfigSourceCompareOnOpen] =
    useState(false);
  const [projectBuildConfigOpen, setProjectBuildConfigOpen] = useState(false);
  const [runtimeConfigSmokeOpen, setRuntimeConfigSmokeOpen] = useState(false);
  const [workspaceRuntimeSmokeOpen, setWorkspaceRuntimeSmokeOpen] =
    useState(false);
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
        "http://10.192.165.3:8080/job/Marketing/job/imp-admin-front-web-vke/4118/",
      executionKey: "build:smart-marketing:vke:smoke",
      projectKey: "smart-marketing",
      projectName: "智能营销",
      parameters: [
        { key: "target", label: "目标", value: "vke" },
        { key: "environment", label: "环境", value: "dc2" },
        { key: "branch", label: "分支", value: "env-dc2-vke" },
        { key: "IS_GRAY", label: "灰度", value: "false" },
        { key: "API_TOKEN", label: "令牌", value: "已配置", masked: true },
      ],
      target: { page: "build", projectKey: "smart-marketing" },
      resource: {
        kind: "url",
        label: "打开构建记录",
        value:
          "http://10.192.165.3:8080/job/Marketing/job/imp-admin-front-web-vke/4118/",
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
      summary: "智能营销 · vke 正在构建",
      executionKey: "build:smart-marketing:vke:running-smoke",
      projectKey: "smart-marketing",
      projectName: "智能营销",
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
      executionKey: "build:smart-marketing:vke:failed-smoke",
      projectKey: "smart-marketing",
      projectName: "智能营销",
      parameters: [
        { key: "target", label: "目标", value: "vke" },
        { key: "environment", label: "环境", value: "dc2" },
        { key: "branch", label: "分支", value: "feature/missing" },
      ],
      target: { page: "build", projectKey: "smart-marketing" },
      action: {
        kind: "buildRecover",
        label: "重新规划并重试部署",
        projectKey: "smart-marketing",
        projectName: "智能营销",
        workspaceKey: "system",
        request: {
          project: "smart-marketing",
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
      summary: "合作渠道联调 · 完成 1 / 失败 1 / 跳过 0",
      detail: "启动代理：端口已被占用",
      executionKey: "link:run:cooperation-debug",
      projectKey: "cooperation-admin",
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
      target: { page: "overview", projectKey: "cooperation-admin" },
      action: {
        kind: "linkRecover",
        label: "检查并重新启动",
        linkKey: "cooperation-debug",
        linkName: "合作渠道联调",
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
        activityAlertCount={
          visibleActivityItems.filter(activityRequiresAttention).length
        }
        onOpenActivityEntry={() => undefined}
        onOpenActivityResource={() => undefined}
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
        <section
          aria-label="烟雾测试内容"
          hidden={activePage === "knowledge"}
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
            onClick={() => {
              setWorkspaceConfigFocusRequest(null);
              runtimeSmokeProxyRunning = false;
              runtimeSmokePortConflict = false;
              runtimeSmokeProfileRepairMode = "";
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
          {workspaceRuntimeSmokeOpen ? (
            <Box
              aria-label="工作区运行来源测试"
              sx={{
                position: "fixed",
                inset: 0,
                zIndex: 1100,
                bgcolor: "background.default",
                overflow: "auto",
                p: 1,
              }}
            >
              <Button
                size="small"
                variant="outlined"
                onClick={() => setWorkspaceRuntimeSmokeOpen(false)}
                sx={{ position: "fixed", right: 12, bottom: 12, zIndex: 2 }}
              >
                关闭工作区运行来源测试
              </Button>
              <OverviewPage
                projectWorkspaces={smokeWorkspaces}
                archivedProjectWorkspaces={smokeArchivedWorkspaces}
                activeProjectWorkspaceKey="feature_cr2606150041_ykd_car"
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
                  key: "feature_cr2606150041_ykd_car",
                  name: "需求工作区",
                  demandId: "CR2606150041",
                  project: {
                    key: "demo",
                    name: "智能营销",
                    repoPath: "/mock/workspaces/feature/demo",
                  },
                  requirementEntry: {
                    category: "需求",
                    shortLabel: "CR2606150041",
                    name: "需求记录",
                    path: "/mock/workspaces/feature/resources/WORKLOG.md",
                  },
                  resources: {
                    workspaceKey: "feature_cr2606150041_ykd_car",
                    workspaceName: "需求工作区",
                    resourceDir: "/mock/workspaces/feature/resources",
                    worklogFile: "WORKLOG.md",
                    worklogPath:
                      "/mock/workspaces/feature/resources/WORKLOG.md",
                    worklogExists: true,
                    worklogCreated: true,
                    autoRecordEnabled: true,
                  },
                  branch: {
                    expected: "feature/CR2606150041",
                    current: "feature/CR2606150041",
                    matches: true,
                  },
                  metadata: {},
                  warnings: [],
                })}
                onProjectConfigSaved={() => undefined}
                workspaceConfigOpenSignal={
                  workspaceConfigFocusRequest?.nonce ?? 0
                }
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
                  setWorkspaceRuntimeProxyState(
                    `${profileId}:${sourceId || "default"}`,
                  );
                }}
                onStopProxyProfile={() => undefined}
                onFocusProjectRuntime={() => undefined}
                onExecutePinnedAction={async () => undefined}
                workflowChains={[smokeWorkspaceWorkflowChain]}
                workflowRunStates={
                  new URLSearchParams(window.location.search).get(
                    "workflowRun",
                  ) === "running"
                    ? [smokeWorkspaceWorkflowRunState]
                    : []
                }
                onSaveWorkflowChain={async () => undefined}
                onDeleteWorkflowChain={async () => undefined}
                onWorkflowChainEnabledChange={async () => undefined}
                onRunWorkflowChain={async () => "smoke-workflow-run"}
                onCancelWorkflowRun={async () => undefined}
              />
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
                configWorkspaceKey="feature_cr2606150041_ykd_car"
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
                  activeProjectWorkspaceKey: "feature_cr2606150041_ykd_car",
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
