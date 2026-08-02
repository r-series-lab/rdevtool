import { describe, expect, it } from "vitest";
import { hasTranslationMessage } from "./index";

type ImportGlob = (
  patterns: string[],
  options: { query: string; import: string; eager: boolean },
) => Record<string, unknown>;

const SOURCE_MODULES = (import.meta as unknown as { glob: ImportGlob }).glob(
  ["../components/**/*.tsx", "../pages/*.tsx"],
  {
  query: "?raw",
  import: "default",
  eager: true,
  },
) as Record<string, string>;

const TRANSLATED_SURFACES = [
  "components/branch/BranchChangedFilesList.tsx",
  "components/branch/BranchHistoryPanel.tsx",
  "components/branch/BranchModeTabs.tsx",
  "components/branch/BranchPushStatusCard.tsx",
  "components/branch/PushCommitConfirmContent.tsx",
  "components/branch/LocalWorkspaceStatusCard.tsx",
  "components/ActivityAttentionQueue.tsx",
  "components/web-actions/FetchImportEditor.tsx",
  "components/ActivityCenter.tsx",
  "components/AppCards.tsx",
  "components/AppExitDialog.tsx",
  "components/AppShellLayout.tsx",
  "components/CommandPalette.tsx",
  "components/ConfigSourceBar.tsx",
  "components/ConfigSourceManagerDialog.tsx",
  "components/LinkToolWizardDialog.tsx",
  "components/ManagedArtifactsPanel.tsx",
  "components/ResourceConfigDialog.tsx",
  "components/RuntimeContextCard.tsx",
  "components/SystemDiagnosticsPanel.tsx",
  "components/WebActionsDialog.tsx",
  "components/WorkflowLinksDialog.tsx",
  "components/WorkflowRulesConfigDialog.tsx",
  "components/WorkspaceWorkflowPanel.tsx",
  "components/LinkPlanDialog.tsx",
  "components/ProjectRuntimeStartDialog.tsx",
  "components/WorkspaceRuntimePreflightStatus.tsx",
  "components/SettingsPanel.tsx",
  "components/WorkspaceRuntimePreflightFixDialog.tsx",
  "components/WorkspaceProjectRuntimeRow.tsx",
  "components/WorkspaceConfigSidebar.tsx",
  "components/WorkspaceSwitcherMenu.tsx",
  "components/WorkspaceTypeSelect.tsx",
  "components/build/BuildResultPanel.tsx",
  "pages/BuildPage.tsx",
  "pages/KnowledgePage.tsx",
  "pages/MergePage.tsx",
  "pages/NavigationPage.tsx",
  "pages/OverviewPage.tsx",
  "pages/ProjectsPage.tsx",
  "pages/ProjectManagementPage.tsx",
  "pages/ProxyPage.tsx",
] as const;

function staticTranslationKeys(source: string): string[] {
  const keys: string[] = [];
  const pattern = /\bt\(\s*"((?:[^"\\]|\\.)+)"/g;
  for (const match of source.matchAll(pattern)) {
    keys.push(JSON.parse(`"${match[1]}"`) as string);
  }
  return keys;
}

describe("translation coverage", () => {
  it("has an English message for every static t() key on translated surfaces", () => {
    const missing = TRANSLATED_SURFACES.flatMap((relativePath) => {
      const source = SOURCE_MODULES[`../${relativePath}`];
      if (typeof source !== "string") {
        return [`${relativePath}: source unavailable`];
      }
      return staticTranslationKeys(source)
        .filter((key) => !hasTranslationMessage("en-US", key))
        .map((key) => `${relativePath}: ${key}`);
    });

    expect(missing).toEqual([]);
  });
});
