import { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { Button, CssBaseline, ThemeProvider } from "@mui/material";
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
  ProjectWorkspaceSummary,
} from "./app-types";
import { AppShellLayout } from "./components/AppShellLayout";
import { SettingsPanel } from "./components/SettingsPanel";
import { useAppConfirmDialog } from "./components/AppConfirmDialog";
import { ConfigSourceManagerDialog } from "./components/ConfigSourceManagerDialog";
import { useActivityPreferences } from "./hooks/useActivityPreferences";
import { WorktreeSelector } from "./pages/MergePage";
import { createActivityEntry, type ActivityEntry } from "./lib/activityCenter";
import { activityVisibleWithPreferences } from "./lib/activityPreferences";
import { createAppTheme, type AppStyleMode } from "./theme";
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
];

const projectManagementContent: Record<ProjectManagementViewKey, string> = {
  projects: "项目内容",
  build: "构建内容",
  git: "Git 内容",
};

function createSmokeWorkspace(
  workspace: Pick<ProjectWorkspaceSummary, "key" | "name" | "projectCount"> &
    Partial<ProjectWorkspaceSummary>,
): ProjectWorkspaceSummary {
  return {
    description: null,
    active: false,
    system: false,
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

let projectEditorState: ProjectConfigEditorState = {
  configPath: "/mock/projects.toml",
  runtimeConfigPath: null,
  runtimeProfileScope: "global",
  jenkinsProfiles: ["default"],
  defaultBranchRules: { sourceKeywords: [], targetKeywords: [] },
  runtimeProfiles: [],
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
    label: "运行配置覆盖",
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
  const files: ConfigSourceFileInspection[] = configFileDefinitions.map((file) => {
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
  });

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

function compareMockSources(leftSourceId: string, rightSourceId: string): ConfigSourceComparison {
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
        right: { supported: true, exists: true, sizeBytes: equivalent ? 128 + index : 256 },
        sizeEqual: equivalent,
        contentEqual: equivalent,
        equivalent,
        status: equivalent ? "matching" : "differing",
        summary: equivalent ? "文件内容一致" : "文件内容不同",
      };
    }),
  };
}

function copyMockSource(request: ConfigSourceCopyRequest): ConfigSourceCopyResult {
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
  mockSources = [...mockSources.filter((item) => item.id !== target.id), target];
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
    new URLSearchParams(window.location.search).get("style") === "mono" ? "mono" : "light",
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
  const [configSourceCompareOnOpen, setConfigSourceCompareOnOpen] = useState(false);
  const [projectBuildConfigOpen, setProjectBuildConfigOpen] = useState(false);
  const missingWorktreePath = "/mock/worktrees/example-pre";
  const [selectedWorktreePath, setSelectedWorktreePath] = useState(missingWorktreePath);
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
      id: "deploy-success-with-params",
      kind: "build",
      origin: "cli",
      status: "success",
      title: "触发部署",
      summary: "构建成功 · 构建 #4118 当前结果：SUCCESS",
      detail: "http://10.192.165.3:8080/job/Marketing/job/imp-admin-front-web-vke/4118/",
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
        value: "http://10.192.165.3:8080/job/Marketing/job/imp-admin-front-web-vke/4118/",
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
      diagnostics: [{
        id: "proxy:start:local-debug",
        type: "proxy.start",
        label: "本地联调代理",
        status: "failed",
        summary: "监听端口已被占用",
        risks: ["监听进程不受 rDevTool 管理"],
      }],
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
      detail: "消息中心: release -> master [失败]\n原因：GitLab 身份验证失败（HTTP 401），请检查访问令牌是否有效或已过期。",
      executionKey: "branch:sync:message-center",
      projectKey: "message-center",
      projectName: "消息中心",
      diagnostics: [{
        id: "sync:message-center:0",
        type: "git.sync",
        label: "消息中心",
        status: "failed",
        summary: "合并失败",
        risks: ["GitLab 身份验证失败（HTTP 401），请检查访问令牌是否有效或已过期。"],
      }],
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
      detail: "启动命令: npm run dev\n工作目录: /mock/demo/rdevtool-web\n错误: 端口 1420 已被其他进程占用。\n请停止占用进程或修改端口后重试。\n完整详情结束",
      executionKey: "runtime:smoke:single",
      projectKey: "rdevtool-web",
      projectName: "rdevtool-web",
      diagnostics: [{
        id: "runtime-port",
        type: "runtime.preflight.port",
        label: "端口检查",
        status: "failed",
        summary: "端口 1420 已被其他进程占用",
        risks: ["必须先释放端口或调整运行档案"],
      }],
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
    document.documentElement.dataset.style = styleMode === "mono" ? "mono" : "light";
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
        activityAlertCount={visibleActivityItems.filter((item) =>
          Boolean(item.action) ||
          (item.status === "failed" && !item.acknowledgedAt),
        ).length}
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
                diagnostics: [{
                  id: "proxy",
                  type: "proxy.start",
                  label: "启动代理",
                  status: "ready",
                  summary: "代理配置有效，可以安全启动",
                  risks: [],
                }],
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
            const recoveredTitle = recoveredKind === "branchReplay"
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
                status: recoveredKind === "buildRecover" ? "running" : "success",
                title: recoveredTitle,
                summary: recoveredKind === "buildRecover"
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
              item.id === entry.id
                ? {
                    ...item,
                    status: "success",
                    summary: "已重新加载并应用最新配置",
                    action: null,
                    updatedAt: new Date().toISOString(),
                  }
                : item,
            ),
          );
        }}
        onRefreshActivities={() => undefined}
        onAcknowledgeActivityEntry={() => undefined}
        onAcknowledgeActivityEntries={() => undefined}
        onClearActivities={() => undefined}
        busy=""
        error=""
      >
        <section aria-label="烟雾测试内容">
          <h1>{content}</h1>
          <output data-testid="active-state">
            {activePage}/{projectManagementView}
          </output>
          <output data-testid="config-activity-state">
            {activityItems[0]?.status ?? "missing"}
          </output>
          <output data-testid="active-workspace-state">{activeWorkspaceKey}</output>
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
          <Button variant="outlined" onClick={() => setProjectBuildConfigOpen(true)}>
            打开构建配置测试
          </Button>
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
          <section aria-label="工作副本恢复测试" style={{ maxWidth: 760, marginTop: 16 }}>
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
  <SidebarSmokeHarness />,
);
