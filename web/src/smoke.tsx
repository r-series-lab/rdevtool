import { useMemo, useState } from "react";
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
  ProjectManagementViewKey,
} from "./app-types";
import { AppShellLayout } from "./components/AppShellLayout";
import { ConfigSourceManagerDialog } from "./components/ConfigSourceManagerDialog";
import { WorktreeSelector } from "./pages/MergePage";
import { createActivityEntry, type ActivityEntry } from "./lib/activityCenter";
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
      default:
        return null;
    }
  },
  { shouldMockEvents: true },
);

function SidebarSmokeHarness() {
  const [activePage, setActivePage] = useState<PageKey>("overview");
  const [projectManagementView, setProjectManagementView] =
    useState<ProjectManagementViewKey>("projects");
  const [styleMode, setStyleMode] = useState<AppStyleMode>("light");
  const [exitRuntimePolicy, setExitRuntimePolicy] = useState<
    "ask" | "keep" | "stop"
  >("ask");
  const [enabledPages, setEnabledPages] = useState<PageKey[]>(() =>
    visibleNavItems.map((item) => item.key),
  );
  const [defaultPage, setDefaultPage] = useState<PageKey>("overview");
  const [configSourceManagerOpen, setConfigSourceManagerOpen] = useState(false);
  const [configSourceCompareOnOpen, setConfigSourceCompareOnOpen] = useState(false);
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
  ]);
  const theme = useMemo(
    () => createAppTheme(styleMode === "mono" ? "mono" : "light"),
    [styleMode],
  );
  const enabledNavItems = useMemo(
    () => visibleNavItems.filter((item) => enabledPages.includes(item.key)),
    [enabledPages],
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
        projectWorkspaces={[]}
        activeProjectWorkspaceKey=""
        onProjectWorkspaceChange={() => undefined}
        selectedProjectKey=""
        onOpenConfigDir={() => undefined}
        onOpenConfigFile={() => undefined}
        onOpenProjectWorkspacesDir={() => undefined}
        onOpenNavigationConfigFile={() => undefined}
        onOpenWorkspaceConfig={() => undefined}
        onOpenResourceConfig={() => undefined}
        onCreateProjectWorkspace={() => undefined}
        onProjectConfigSaved={() => undefined}
        activityItems={activityItems}
        activityAlertCount={activityItems.filter((item) => item.status === "running").length}
        onOpenActivityEntry={() => undefined}
        onOpenActivityResource={() => undefined}
        onRunActivityAction={(entry) => {
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
