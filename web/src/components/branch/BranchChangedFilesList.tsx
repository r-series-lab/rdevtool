import {
  Box,
  Button,
  Checkbox,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import type {
  BranchFileDiffResponse,
  BranchPushFileStatus,
  BranchPushStatus,
} from "../../app-types";
import { useI18n } from "../../i18n";
import { CopyIcon } from "../AppIcons";

const BRANCH_CHANGED_FILE_VISIBLE_ROWS = 10;
const BRANCH_CHANGED_FILE_LIST_MAX_HEIGHT = 320;
const BRANCH_CHANGED_FILE_SEARCH_THRESHOLD = 6;
const BRANCH_FILE_DIFF_MAX_BYTES = 300 * 1024;
const BRANCH_FILE_DIFF_MAX_LINES = 3_000;

type BranchChangedFileFilter =
  | "all"
  | "risk"
  | "conflicted"
  | "staged"
  | "unstaged"
  | "untracked";

type BranchChangedFileGroupKey =
  | "conflicted"
  | "risk"
  | "mixed"
  | "staged"
  | "unstaged"
  | "untracked"
  | "other";

type BranchChangedFileRisk = "conflict" | "delete" | "sensitive";

const BRANCH_CHANGED_FILE_FILTERS: Array<{
  key: BranchChangedFileFilter;
  label: string;
}> = [
  { key: "all", label: "全部" },
  { key: "risk", label: "风险" },
  { key: "conflicted", label: "冲突" },
  { key: "staged", label: "已暂存" },
  { key: "unstaged", label: "未暂存" },
  { key: "untracked", label: "新文件" },
];

const BRANCH_CHANGED_FILE_GROUPS: Array<{
  key: BranchChangedFileGroupKey;
  label: string;
  tone: "error" | "warning" | "primary" | "default";
}> = [
  { key: "conflicted", label: "冲突", tone: "error" },
  { key: "risk", label: "风险文件", tone: "warning" },
  { key: "mixed", label: "部分暂存", tone: "primary" },
  { key: "staged", label: "已暂存", tone: "default" },
  { key: "unstaged", label: "未暂存", tone: "default" },
  { key: "untracked", label: "新文件", tone: "default" },
  { key: "other", label: "其他变更", tone: "default" },
];

type BranchFileDiffState =
  | { status: "loading" }
  | { status: "loaded"; data: BranchFileDiffResponse }
  | { status: "error"; message: string };

type BranchDiffViewMode = "unified" | "split";

function branchChangedFileCodeLabel(code: string) {
  if (code === "M") return "修改";
  if (code === "A") return "新增";
  if (code === "D") return "删除";
  if (code === "R") return "重命名";
  if (code === "C") return "复制";
  if (code === "T") return "类型变更";
  if (code === "U") return "冲突";
  if (code === "?") return "未跟踪";
  if (code === "!") return "忽略";
  return code.trim() || "变更";
}

function branchChangedFileChangeLabel(item: BranchPushFileStatus) {
  if (item.conflicted) {
    return "冲突";
  }
  if (item.untracked) {
    return "新增";
  }
  const stagedCode = item.code.charAt(0) || " ";
  const unstagedCode = item.code.charAt(1) || " ";
  const labels = [stagedCode, unstagedCode]
    .filter((code) => code.trim())
    .map(branchChangedFileCodeLabel);
  return Array.from(new Set(labels)).join(" / ") || item.code || "变更";
}

function branchChangedFileStatusLabel(item: BranchPushFileStatus) {
  if (item.conflicted) {
    return "冲突";
  }
  if (item.untracked) {
    return "新文件";
  }
  if (item.staged && item.unstaged) {
    return "已暂存 + 未暂存";
  }
  if (item.staged) {
    return "已暂存";
  }
  if (item.unstaged) {
    return "未暂存";
  }
  return item.code || "变更";
}

function branchChangedFileRisks(item: BranchPushFileStatus) {
  const risks: BranchChangedFileRisk[] = [];
  const path = item.path.toLowerCase();
  if (item.conflicted) {
    risks.push("conflict");
  }
  if (item.code.includes("D")) {
    risks.push("delete");
  }
  if (
    /(^|\/)\.env($|[.-])/.test(path) ||
    path.includes("vite.config") ||
    path.includes("webpack") ||
    path.includes("package-lock.json") ||
    path.includes("pnpm-lock.yaml") ||
    path.includes("yarn.lock") ||
    path.includes("cargo.lock") ||
    path.includes("assets.car") ||
    path.includes("src-tauri/icons/")
  ) {
    risks.push("sensitive");
  }
  return risks;
}

function branchChangedFileRiskLabel(risk: BranchChangedFileRisk) {
  if (risk === "conflict") return "冲突";
  if (risk === "delete") return "删除";
  return "敏感配置";
}

function branchChangedFileMatchesFilter(
  item: BranchPushFileStatus,
  filter: BranchChangedFileFilter,
) {
  if (filter === "all") return true;
  if (filter === "risk") return branchChangedFileRisks(item).length > 0;
  if (filter === "conflicted") return item.conflicted;
  if (filter === "staged") return item.staged;
  if (filter === "unstaged") return item.unstaged;
  if (filter === "untracked") return item.untracked;
  return true;
}

function branchChangedFileSummary(files: BranchPushFileStatus[]) {
  return {
    conflicted: files.filter((item) => item.conflicted).length,
    staged: files.filter((item) => item.staged).length,
    unstaged: files.filter((item) => item.unstaged).length,
    untracked: files.filter((item) => item.untracked).length,
    risk: files.filter((item) => branchChangedFileRisks(item).length > 0).length,
  };
}

function branchChangedFileGroupKey(item: BranchPushFileStatus): BranchChangedFileGroupKey {
  const risks = branchChangedFileRisks(item).filter((risk) => risk !== "conflict");
  if (item.conflicted) {
    return "conflicted";
  }
  if (risks.length > 0) {
    return "risk";
  }
  if (item.staged && item.unstaged) {
    return "mixed";
  }
  if (item.staged) {
    return "staged";
  }
  if (item.unstaged) {
    return "unstaged";
  }
  if (item.untracked) {
    return "untracked";
  }
  return "other";
}

function branchChangedFileGrouped(files: BranchPushFileStatus[]) {
  return BRANCH_CHANGED_FILE_GROUPS.map((group) => ({
    ...group,
    files: files.filter((item) => branchChangedFileGroupKey(item) === group.key),
  })).filter((group) => group.files.length > 0);
}

async function copyChangedFilePath(path: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(path);
    return;
  }
  const input = document.createElement("textarea");
  input.value = path;
  input.style.position = "fixed";
  input.style.left = "-9999px";
  document.body.appendChild(input);
  input.focus();
  input.select();
  document.execCommand("copy");
  document.body.removeChild(input);
}

function branchFileDiffModeLabel(mode: string) {
  if (mode === "staged") return "已暂存";
  if (mode === "unstaged") return "未暂存";
  if (mode === "combined") return "完整变更";
  if (mode === "untracked") return "新文件";
  return mode || "差异";
}

type BranchDiffLineKind = "meta" | "hunk" | "add" | "delete" | "context" | "notice";

type BranchDiffLine = {
  key: string;
  kind: BranchDiffLineKind;
  oldLine?: number;
  newLine?: number;
  marker: string;
  text: string;
};

type BranchSplitDiffCell = {
  kind: BranchDiffLineKind | "empty";
  line?: number;
  marker: string;
  text: string;
};

type BranchSplitDiffRow =
  | {
      key: string;
      kind: "meta" | "hunk" | "notice";
      text: string;
    }
  | {
      key: string;
      kind: "context" | "change";
      left: BranchSplitDiffCell;
      right: BranchSplitDiffCell;
    };

function parseBranchDiffHunk(line: string) {
  const match = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
  if (!match) {
    return null;
  }
  return {
    oldLine: Number(match[1]),
    newLine: Number(match[2]),
  };
}

function buildBranchDiffLines(diff: string): BranchDiffLine[] {
  let oldLine: number | null = null;
  let newLine: number | null = null;

  return diff.split("\n").map((line, index) => {
    const key = `${index}-${line.slice(0, 24)}`;

    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("new file mode ") ||
      line.startsWith("deleted file mode ") ||
      line.startsWith("similarity index ") ||
      line.startsWith("rename from ") ||
      line.startsWith("rename to ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      return {
        key,
        kind: "meta",
        marker: "",
        text: line || " ",
      };
    }

    if (line.startsWith("@@")) {
      const hunk = parseBranchDiffHunk(line);
      if (hunk) {
        oldLine = hunk.oldLine;
        newLine = hunk.newLine;
      }
      return {
        key,
        kind: "hunk",
        marker: "@@",
        text: line || " ",
      };
    }

    if (line.startsWith("\\")) {
      return {
        key,
        kind: "notice",
        marker: "",
        text: line || " ",
      };
    }

    if (oldLine !== null && newLine !== null && line.startsWith("+")) {
      const currentNewLine = newLine;
      newLine += 1;
      return {
        key,
        kind: "add",
        newLine: currentNewLine,
        marker: "+",
        text: line.slice(1) || " ",
      };
    }

    if (oldLine !== null && newLine !== null && line.startsWith("-")) {
      const currentOldLine = oldLine;
      oldLine += 1;
      return {
        key,
        kind: "delete",
        oldLine: currentOldLine,
        marker: "-",
        text: line.slice(1) || " ",
      };
    }

    if (oldLine !== null && newLine !== null) {
      const currentOldLine = oldLine;
      const currentNewLine = newLine;
      oldLine += 1;
      newLine += 1;
      return {
        key,
        kind: "context",
        oldLine: currentOldLine,
        newLine: currentNewLine,
        marker: " ",
        text: line.startsWith(" ") ? line.slice(1) || " " : line || " ",
      };
    }

    return {
      key,
      kind: "context",
      marker: "",
      text: line || " ",
    };
  });
}

function emptyBranchSplitDiffCell(): BranchSplitDiffCell {
  return {
    kind: "empty",
    marker: "",
    text: "",
  };
}

function branchDiffLineToSplitCell(
  line: BranchDiffLine,
  side: "left" | "right",
): BranchSplitDiffCell {
  return {
    kind: line.kind,
    line: side === "left" ? line.oldLine : line.newLine,
    marker: line.marker,
    text: line.text,
  };
}

function buildBranchSplitDiffRows(lines: BranchDiffLine[]): BranchSplitDiffRow[] {
  const rows: BranchSplitDiffRow[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.kind === "meta" || line.kind === "hunk" || line.kind === "notice") {
      rows.push({
        key: line.key,
        kind: line.kind,
        text: line.text,
      });
      index += 1;
      continue;
    }

    if (line.kind === "context") {
      rows.push({
        key: line.key,
        kind: "context",
        left: branchDiffLineToSplitCell(line, "left"),
        right: branchDiffLineToSplitCell(line, "right"),
      });
      index += 1;
      continue;
    }

    if (line.kind === "delete") {
      const deletes: BranchDiffLine[] = [];
      const adds: BranchDiffLine[] = [];

      while (lines[index]?.kind === "delete") {
        deletes.push(lines[index]);
        index += 1;
      }
      while (lines[index]?.kind === "add") {
        adds.push(lines[index]);
        index += 1;
      }

      const rowCount = Math.max(deletes.length, adds.length);
      for (let offset = 0; offset < rowCount; offset += 1) {
        rows.push({
          key: `change-${deletes[offset]?.key || "empty"}-${adds[offset]?.key || "empty"}`,
          kind: "change",
          left: deletes[offset]
            ? branchDiffLineToSplitCell(deletes[offset], "left")
            : emptyBranchSplitDiffCell(),
          right: adds[offset]
            ? branchDiffLineToSplitCell(adds[offset], "right")
            : emptyBranchSplitDiffCell(),
        });
      }
      continue;
    }

    if (line.kind === "add") {
      rows.push({
        key: line.key,
        kind: "change",
        left: emptyBranchSplitDiffCell(),
        right: branchDiffLineToSplitCell(line, "right"),
      });
      index += 1;
      continue;
    }

    index += 1;
  }

  return rows;
}

function BranchUnifiedDiffViewer({ lines, panel }: { lines: BranchDiffLine[]; panel: boolean }) {
  return (
    <Box className="branch-diff-viewer branch-diff-viewer--unified" sx={{ maxHeight: panel ? "100%" : 280, height: panel ? "100%" : "auto" }}>
      {lines.map((line) => (
        <Box key={line.key} className={`branch-diff-line is-${line.kind}`}>
          <Box component="span" className="branch-diff-line-number">
            {line.oldLine ?? ""}
          </Box>
          <Box component="span" className="branch-diff-line-number">
            {line.newLine ?? ""}
          </Box>
          <Box component="span" className="branch-diff-marker">
            {line.marker}
          </Box>
          <Box component="span" className="branch-diff-text">
            {line.text}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function BranchSplitDiffCellView({ cell }: { cell: BranchSplitDiffCell }) {
  return (
    <Box className={`branch-split-diff-cell is-${cell.kind}`}>
      <Box component="span" className="branch-split-diff-line-number">
        {cell.line ?? ""}
      </Box>
      <Box component="span" className="branch-split-diff-marker">
        {cell.marker}
      </Box>
      <Box component="span" className="branch-split-diff-text">
        {cell.text || " "}
      </Box>
    </Box>
  );
}

function BranchSplitDiffViewer({ lines, panel }: { lines: BranchDiffLine[]; panel: boolean }) {
  const rows = buildBranchSplitDiffRows(lines);

  return (
    <Box className="branch-diff-viewer branch-diff-viewer--split" sx={{ maxHeight: panel ? "100%" : 280, height: panel ? "100%" : "auto" }}>
      {rows.map((row) => {
        if ("left" in row) {
          return (
            <Box key={row.key} className={`branch-split-diff-row is-${row.kind}`}>
              <BranchSplitDiffCellView cell={row.left} />
              <BranchSplitDiffCellView cell={row.right} />
            </Box>
          );
        }
        return (
          <Box key={row.key} className={`branch-split-diff-banner is-${row.kind}`}>
            {row.text}
          </Box>
        );
      })}
    </Box>
  );
}

function BranchFileDiffPreview({
  state,
  panel = false,
}: {
  state?: BranchFileDiffState;
  panel?: boolean;
}) {
  const { t } = useI18n();
  const [viewMode, setViewMode] = useState<BranchDiffViewMode>("unified");

  if (!state || state.status === "loading") {
    return (
      <Box
        sx={{
          mt: panel ? 0 : 0.7,
          px: 0.85,
          py: 0.7,
          borderRadius: "10px",
          bgcolor: "rgba(0,0,0,0.035)",
        }}
      >
        <Typography variant="caption" color="text.secondary">
          {t("正在加载差异...")}
        </Typography>
      </Box>
    );
  }

  if (state.status === "error") {
    return (
      <Box
        sx={{
          mt: 0.7,
          ...(panel ? { mt: 0 } : {}),
          px: 0.85,
          py: 0.7,
          borderRadius: "10px",
          border: "1px solid",
          borderColor: "error.light",
        }}
      >
        <Typography variant="caption" color="error" sx={{ overflowWrap: "anywhere" }}>
          {state.message}
        </Typography>
      </Box>
    );
  }

  const { data } = state;
  const emptyDiff = !data.diff.trim();
  const diffLines = emptyDiff ? [] : buildBranchDiffLines(data.diff);

  return (
    <Box
      className={`branch-file-diff-preview${panel ? " is-panel" : ""}`}
      sx={{
        mt: 0.7,
        ...(panel ? { mt: 0, minHeight: 0, height: "100%" } : {}),
        px: panel ? 0 : 0.85,
        py: panel ? 0 : 0.75,
        borderRadius: "8px",
        border: "1px solid",
        borderColor: "divider",
        bgcolor: panel ? "transparent" : "rgba(0,0,0,0.03)",
        minWidth: 0,
      }}
    >
      <Stack spacing={panel ? 0 : 0.55}>
        <Stack
          className="branch-diff-toolbar"
          direction="row"
          columnGap={0.45}
          rowGap={0.45}
          flexWrap="wrap"
        >
          <Stack direction="row" columnGap={0.45} rowGap={0.45} flexWrap="wrap" sx={{ flex: "1 1 auto", minWidth: 0 }}>
            {!panel ? (
              <Chip
                size="small"
                label={t(branchFileDiffModeLabel(data.mode))}
                color="primary"
                variant="outlined"
                sx={{ height: 21, fontSize: "0.68rem" }}
              />
            ) : null}
            {data.truncated ? (
              <Chip
                size="small"
                label={t("已截断")}
                color="warning"
                variant="outlined"
                sx={{ height: 21, fontSize: "0.68rem" }}
              />
            ) : null}
            {data.binary ? (
              <Chip
                size="small"
                label={t("二进制")}
                color="default"
                variant="outlined"
                sx={{ height: 21, fontSize: "0.68rem" }}
              />
            ) : null}
            {data.warnings.map((warning) => (
              <Chip
                key={warning}
                size="small"
                label={warning}
                color="warning"
                variant="outlined"
                sx={{ height: 21, maxWidth: "100%", fontSize: "0.68rem" }}
              />
            ))}
          </Stack>
          {!data.binary && !emptyDiff ? (
            <ToggleButtonGroup
              className="branch-diff-view-toggle"
              size="small"
              exclusive
              value={viewMode}
              onChange={(_, value: BranchDiffViewMode | null) => {
                if (value) {
                  setViewMode(value);
                }
              }}
            >
              <ToggleButton value="unified">{t("统一")}</ToggleButton>
              <ToggleButton value="split">{t("左右")}</ToggleButton>
            </ToggleButtonGroup>
          ) : null}
        </Stack>

        {data.binary ? (
          <Typography variant="caption" color="text.secondary">
            {t("二进制文件不展示文本差异。")}
          </Typography>
        ) : emptyDiff ? (
          <Typography variant="caption" color="text.secondary">
            {t("没有可展示的文本差异。")}
          </Typography>
        ) : viewMode === "split" ? (
          <BranchSplitDiffViewer lines={diffLines} panel={panel} />
        ) : (
          <BranchUnifiedDiffViewer lines={diffLines} panel={panel} />
        )}
      </Stack>
    </Box>
  );
}

type BranchChangesDialogProps = {
  open: boolean;
  onClose: () => void;
  status: BranchPushStatus;
  selectable?: boolean;
  selectedPaths?: string[];
  onSelectedPathsChange?: (value: string[]) => void;
};

export function BranchChangesDialog({
  open,
  onClose,
  status,
  selectable = false,
  selectedPaths = [],
  onSelectedPathsChange,
}: BranchChangesDialogProps) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<BranchChangedFileFilter>("all");
  const [query, setQuery] = useState("");
  const [activePath, setActivePath] = useState("");
  const [copiedPath, setCopiedPath] = useState("");
  const [diffCache, setDiffCache] = useState<Record<string, BranchFileDiffState>>({});
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<
    Partial<Record<BranchChangedFileGroupKey, boolean>>
  >({});
  const summary = useMemo(() => branchChangedFileSummary(status.files), [status.files]);
  const selectedPathSet = new Set(selectedPaths);
  const selectableFiles = status.files.filter((item) => !item.conflicted);
  const allSelectableSelected =
    selectableFiles.length > 0 &&
    selectableFiles.every((item) => selectedPathSet.has(item.path));
  const normalizedQuery = query.trim().toLowerCase();
  const filteredFiles = useMemo(
    () =>
      status.files.filter((item) => {
        if (!branchChangedFileMatchesFilter(item, filter)) {
          return false;
        }
        if (!normalizedQuery) {
          return true;
        }
        return (
          item.path.toLowerCase().includes(normalizedQuery) ||
          item.code.toLowerCase().includes(normalizedQuery) ||
          t(branchChangedFileChangeLabel(item)).toLowerCase().includes(normalizedQuery) ||
          t(branchChangedFileStatusLabel(item)).toLowerCase().includes(normalizedQuery)
        );
      }),
    [filter, normalizedQuery, status.files, t],
  );
  const groupedFiles = useMemo(() => branchChangedFileGrouped(filteredFiles), [filteredFiles]);
  const activeItem = useMemo(
    () =>
      status.files.find((item) => item.path === activePath) ||
      filteredFiles[0] ||
      status.files[0] ||
      null,
    [activePath, filteredFiles, status.files],
  );
  const activeDiffKey = activeItem
    ? `${status.repoPath}:${activeItem.code}:${activeItem.path}`
    : "";
  const activeDiffState = activeDiffKey ? diffCache[activeDiffKey] : undefined;

  useEffect(() => {
    if (!open) {
      return;
    }
    setActivePath((current) =>
      current && status.files.some((item) => item.path === current)
        ? current
        : status.files[0]?.path || "",
    );
  }, [open, status.files]);

  useEffect(() => {
    setDiffCache({});
  }, [status.repoPath, status.files]);

  useEffect(() => {
    if (!open || !activeItem || !activeDiffKey || diffCache[activeDiffKey]) {
      return;
    }
    setDiffCache((current) => ({
      ...current,
      [activeDiffKey]: { status: "loading" },
    }));
    void invoke<BranchFileDiffResponse>("get_project_file_diff", {
      request: {
        project: status.projectKey,
        repoPath: status.repoPath,
        path: activeItem.path,
        mode: "auto",
        maxBytes: BRANCH_FILE_DIFF_MAX_BYTES,
        maxLines: BRANCH_FILE_DIFF_MAX_LINES,
      },
    })
      .then((data) => {
        setDiffCache((current) => ({
          ...current,
          [activeDiffKey]: { status: "loaded", data },
        }));
      })
      .catch((reason) => {
        setDiffCache((current) => ({
          ...current,
          [activeDiffKey]: { status: "error", message: String(reason) },
        }));
      });
  }, [activeDiffKey, activeItem, diffCache, open, status.projectKey, status.repoPath]);

  function updateSelectedPaths(paths: string[]) {
    onSelectedPathsChange?.(Array.from(new Set(paths)));
  }

  function toggleSelectedPath(path: string, checked: boolean) {
    if (checked) {
      updateSelectedPaths([...selectedPaths, path]);
      return;
    }
    updateSelectedPaths(selectedPaths.filter((item) => item !== path));
  }

  function toggleGroup(key: BranchChangedFileGroupKey) {
    setCollapsedGroupKeys((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  function selectGroupPaths(paths: string[]) {
    updateSelectedPaths([...selectedPaths, ...paths]);
  }

  function clearGroupPaths(paths: string[]) {
    const groupPathSet = new Set(paths);
    updateSelectedPaths(selectedPaths.filter((path) => !groupPathSet.has(path)));
  }

  function renderChangedFileRow(item: BranchPushFileStatus) {
    const risks = branchChangedFileRisks(item);
    const selected = selectedPathSet.has(item.path);
    const active = activeItem?.path === item.path;

    return (
      <Box
        key={`${item.code}-${item.path}`}
        className={`branch-changes-file-row${active ? " is-active" : ""}${selected ? " is-selected" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => setActivePath(item.path)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setActivePath(item.path);
          }
        }}
      >
        {selectable ? (
          <Checkbox
            size="small"
            checked={selected}
            disabled={item.conflicted}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => toggleSelectedPath(item.path, event.target.checked)}
            sx={{ p: 0.25 }}
          />
        ) : null}
        <Box minWidth={0}>
          <Typography className="branch-changes-file-path" title={item.path}>
            {item.path}
          </Typography>
          <Stack direction="row" columnGap={0.35} rowGap={0.35} flexWrap="wrap" sx={{ mt: 0.35 }}>
            <Chip size="small" label={t(branchChangedFileChangeLabel(item))} variant="outlined" />
            <Chip
              size="small"
              label={t(branchChangedFileStatusLabel(item))}
              color={item.conflicted ? "error" : "default"}
              variant={item.conflicted ? "filled" : "outlined"}
            />
            {risks.map((risk) => (
              <Chip
                key={risk}
                size="small"
                label={t(branchChangedFileRiskLabel(risk))}
                color={risk === "conflict" ? "error" : "warning"}
                variant="outlined"
              />
            ))}
          </Stack>
        </Box>
      </Box>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      fullWidth
      className="branch-changes-dialog"
      PaperProps={{ className: "branch-changes-dialog-paper" }}
    >
      <DialogTitle className="branch-changes-dialog-title">
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1.2}>
          <Box minWidth={0}>
            <Typography variant="subtitle1" fontWeight={860} noWrap>
              {t("变更文件")}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 0.2, overflowWrap: "anywhere" }}
            >
              {status.projectName} · {status.currentBranch || "-"} · {status.repoPath}
            </Typography>
          </Box>
          <Stack
            className="branch-changes-title-stats"
            direction="row"
            columnGap={0.5}
            rowGap={0.45}
            flexWrap="wrap"
            justifyContent="flex-end"
          >
            <Chip size="small" label={t("全部 {count}", { count: status.files.length })} variant="outlined" />
            <Chip size="small" label={t("已选 {count}", { count: selectedPaths.length })} color={selectedPaths.length > 0 ? "primary" : "default"} variant="outlined" />
            <Chip size="small" label={t("冲突 {count}", { count: summary.conflicted })} color={summary.conflicted > 0 ? "error" : "default"} variant="outlined" />
          </Stack>
        </Stack>
      </DialogTitle>
      <DialogContent className="branch-changes-dialog-content">
        <Box className="branch-changes-layout">
          <Box className="branch-changes-sidebar">
            <Stack className="branch-changes-sidebar-stack" spacing={0.75} sx={{ minHeight: 0, height: "100%" }}>
              <Stack className="branch-changes-summary-strip" direction="row" columnGap={0.45} rowGap={0.45} flexWrap="wrap">
                <Chip size="small" label={t("风险 {count}", { count: summary.risk })} color={summary.risk > 0 ? "warning" : "default"} variant={summary.risk > 0 ? "filled" : "outlined"} />
                <Chip size="small" label={t("已暂存 {count}", { count: summary.staged })} variant="outlined" />
                <Chip size="small" label={t("未暂存 {count}", { count: summary.unstaged })} variant="outlined" />
                <Chip size="small" label={t("新文件 {count}", { count: summary.untracked })} variant="outlined" />
              </Stack>
              {selectable ? (
                <Stack className="branch-changes-selection-actions" direction="row" columnGap={0.45} rowGap={0.45} flexWrap="wrap">
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={selectableFiles.length === 0 || allSelectableSelected}
                    onClick={() => updateSelectedPaths(selectableFiles.map((item) => item.path))}
                  >
                    {t("全选可提交")}
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    disabled={selectedPaths.length === 0}
                    onClick={() => updateSelectedPaths([])}
                  >
                    {t("清空选择")}
                  </Button>
                </Stack>
              ) : null}
              <Stack className="branch-changes-filter-bar" direction="row" columnGap={0.35} rowGap={0.35} flexWrap="wrap">
                {BRANCH_CHANGED_FILE_FILTERS.map((item) => (
                  <Chip
                    key={item.key}
                    size="small"
                    label={t(item.label)}
                    clickable
                    color={filter === item.key ? "primary" : "default"}
                    variant={filter === item.key ? "filled" : "outlined"}
                    onClick={() => setFilter(item.key)}
                  />
                ))}
              </Stack>
              <TextField
                className="branch-changes-search"
                size="small"
                value={query}
                placeholder={t("筛选文件路径、状态或 Git 代码")}
                onChange={(event) => setQuery(event.target.value)}
                fullWidth
              />
              <Box className="branch-changes-file-list">
                <Stack spacing={0.55}>
                  {filteredFiles.length === 0 ? (
                    <Typography variant="caption" color="text.secondary">
                      {t("当前筛选没有匹配的变更文件。")}
                    </Typography>
                  ) : null}
                  {groupedFiles.map((group) => {
                    const collapsed = Boolean(collapsedGroupKeys[group.key]);
                    const selectableGroupPaths = group.files
                      .filter((item) => !item.conflicted)
                      .map((item) => item.path);
                    const selectedGroupCount = selectableGroupPaths.filter((path) =>
                      selectedPathSet.has(path),
                    ).length;
                    const allGroupSelected =
                      selectableGroupPaths.length > 0 &&
                      selectedGroupCount === selectableGroupPaths.length;
                    return (
                      <Box key={group.key} className={`branch-changes-file-group is-${group.key}`}>
                        <Box
                          className="branch-changes-file-group-header"
                          role="button"
                          tabIndex={0}
                          onClick={() => toggleGroup(group.key)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              toggleGroup(group.key);
                            }
                          }}
                        >
                          <Box className={`branch-changes-file-group-caret${collapsed ? "" : " is-open"}`}>
                            ›
                          </Box>
                          <Typography className="branch-changes-file-group-title">
                            {t(group.label)}
                          </Typography>
                          <Stack className="branch-changes-file-group-actions" direction="row" spacing={0.35} alignItems="center">
                            <Chip
                              size="small"
                              label={
                                selectable && selectedGroupCount > 0
                                  ? `${selectedGroupCount}/${selectableGroupPaths.length}`
                                  : group.files.length
                              }
                              color={group.tone}
                              variant={group.tone === "default" ? "outlined" : "filled"}
                            />
                            {selectable && selectableGroupPaths.length > 0 ? (
                              <Button
                                size="small"
                                variant={allGroupSelected ? "text" : "outlined"}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (allGroupSelected) {
                                    clearGroupPaths(selectableGroupPaths);
                                    return;
                                  }
                                  selectGroupPaths(selectableGroupPaths);
                                }}
                              >
                                {t(allGroupSelected ? "清空" : "选择")}
                              </Button>
                            ) : null}
                          </Stack>
                        </Box>
                        <Collapse in={!collapsed} timeout="auto" unmountOnExit>
                          <Stack spacing={0.45} className="branch-changes-file-group-body">
                            {group.files.map(renderChangedFileRow)}
                          </Stack>
                        </Collapse>
                      </Box>
                    );
                  })}
                </Stack>
              </Box>
            </Stack>
          </Box>
          <Box className="branch-changes-diff-panel">
            {activeItem ? (
              <Stack spacing={0.9} sx={{ minHeight: 0, height: "100%" }}>
                <Box className="branch-changes-diff-header">
                  <Box className="branch-changes-diff-file-info">
                    <Typography className="branch-changes-diff-title" title={activeItem.path}>
                      {activeItem.path}
                    </Typography>
                    <Chip
                      className="branch-changes-diff-status"
                      size="small"
                      label={t(branchChangedFileStatusLabel(activeItem))}
                      color={activeItem.conflicted ? "error" : "default"}
                      variant="outlined"
                    />
                  </Box>
                  <Button
                    className="branch-changes-copy-path"
                    size="small"
                    variant="outlined"
                    startIcon={<CopyIcon fontSize="small" />}
                    aria-label={t("复制文件路径：{path}", { path: activeItem.path })}
                    onClick={() => {
                      void copyChangedFilePath(activeItem.path).then(() => setCopiedPath(activeItem.path));
                    }}
                  >
                    {t(copiedPath === activeItem.path ? "已复制" : "复制路径")}
                  </Button>
                </Box>
                <Box sx={{ minHeight: 0, flex: "1 1 auto" }}>
                  <BranchFileDiffPreview state={activeDiffState} panel />
                </Box>
              </Stack>
            ) : (
              <Box className="branch-changes-empty">
                <Typography variant="body2" color="text.secondary">
                  {t("选择一个文件查看差异。")}
                </Typography>
              </Box>
            )}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions className="branch-changes-dialog-actions">
        <Chip
          size="small"
          label={t("已选择 {count} 个文件", { count: selectedPaths.length })}
          variant="outlined"
        />
        <Button onClick={onClose} variant="contained">
          {t("完成")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

type BranchChangedFilesListProps = {
  files: BranchPushFileStatus[];
  expanded: boolean;
  dense?: boolean;
  projectKey?: string;
  repoPath?: string;
  selectable?: boolean;
  selectedPaths?: string[];
  onSelectedPathsChange?: (value: string[]) => void;
};

export function BranchChangedFilesList({
  files,
  expanded,
  dense = false,
  projectKey,
  repoPath,
  selectable = false,
  selectedPaths = [],
  onSelectedPathsChange,
}: BranchChangedFilesListProps) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<BranchChangedFileFilter>("all");
  const [query, setQuery] = useState("");
  const [copiedPath, setCopiedPath] = useState("");
  const [expandedDiffKey, setExpandedDiffKey] = useState("");
  const [diffCache, setDiffCache] = useState<Record<string, BranchFileDiffState>>({});

  const summary = useMemo(
    () => ({
      conflicted: files.filter((item) => item.conflicted).length,
      staged: files.filter((item) => item.staged).length,
      unstaged: files.filter((item) => item.unstaged).length,
      untracked: files.filter((item) => item.untracked).length,
      risk: files.filter((item) => branchChangedFileRisks(item).length > 0).length,
    }),
    [files],
  );

  const filteredFiles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return files.filter((item) => {
      if (!branchChangedFileMatchesFilter(item, filter)) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return (
        item.path.toLowerCase().includes(normalizedQuery) ||
        item.code.toLowerCase().includes(normalizedQuery) ||
        t(branchChangedFileChangeLabel(item)).toLowerCase().includes(normalizedQuery) ||
        t(branchChangedFileStatusLabel(item)).toLowerCase().includes(normalizedQuery)
      );
    });
  }, [files, filter, query, t]);

  const filesFingerprint = useMemo(
    () => files.map((item) => `${item.code}:${item.path}`).join("\n"),
    [files],
  );

  useEffect(() => {
    setExpandedDiffKey("");
    setDiffCache({});
  }, [filesFingerprint, projectKey, repoPath]);

  if (files.length === 0) {
    return null;
  }

  const overflow = filteredFiles.length > BRANCH_CHANGED_FILE_VISIBLE_ROWS;
  const showSearch = files.length >= BRANCH_CHANGED_FILE_SEARCH_THRESHOLD || query.trim();
  const canLoadDiff = Boolean(projectKey && repoPath);
  const selectedPathSet = new Set(selectedPaths);
  const selectableFiles = files.filter((item) => !item.conflicted);
  const selectedCount = selectedPaths.length;
  const allSelectableSelected =
    selectableFiles.length > 0 &&
    selectableFiles.every((item) => selectedPathSet.has(item.path));

  function updateSelectedPaths(paths: string[]) {
    onSelectedPathsChange?.(Array.from(new Set(paths)));
  }

  function toggleSelectedPath(path: string, checked: boolean) {
    if (checked) {
      updateSelectedPaths([...selectedPaths, path]);
      return;
    }
    updateSelectedPaths(selectedPaths.filter((item) => item !== path));
  }

  function diffKeyForFile(item: BranchPushFileStatus) {
    return `${repoPath || ""}:${item.code}:${item.path}`;
  }

  async function toggleFileDiff(item: BranchPushFileStatus) {
    const diffKey = diffKeyForFile(item);
    if (expandedDiffKey === diffKey) {
      setExpandedDiffKey("");
      return;
    }

    setExpandedDiffKey(diffKey);
    if (!projectKey || !repoPath || diffCache[diffKey]) {
      return;
    }

    setDiffCache((current) => ({
      ...current,
      [diffKey]: { status: "loading" },
    }));
    try {
      const data = await invoke<BranchFileDiffResponse>("get_project_file_diff", {
        request: {
          project: projectKey,
          repoPath,
          path: item.path,
          mode: "auto",
          maxBytes: BRANCH_FILE_DIFF_MAX_BYTES,
          maxLines: BRANCH_FILE_DIFF_MAX_LINES,
        },
      });
      setDiffCache((current) => ({
        ...current,
        [diffKey]: { status: "loaded", data },
      }));
    } catch (reason) {
      setDiffCache((current) => ({
        ...current,
        [diffKey]: { status: "error", message: String(reason) },
      }));
    }
  }

  return (
    <Collapse in={expanded}>
      <Stack spacing={0.7}>
        <Stack direction="row" columnGap={0.45} rowGap={0.45} flexWrap="wrap">
          <Chip size="small" label={t("全部 {count}", { count: files.length })} variant="outlined" />
          <Chip
            size="small"
            label={t("风险 {count}", { count: summary.risk })}
            color={summary.risk > 0 ? "warning" : "default"}
            variant={summary.risk > 0 ? "filled" : "outlined"}
          />
          <Chip
            size="small"
            label={t("冲突 {count}", { count: summary.conflicted })}
            color={summary.conflicted > 0 ? "error" : "default"}
            variant={summary.conflicted > 0 ? "filled" : "outlined"}
          />
          <Chip size="small" label={t("已暂存 {count}", { count: summary.staged })} variant="outlined" />
          <Chip size="small" label={t("未暂存 {count}", { count: summary.unstaged })} variant="outlined" />
          <Chip size="small" label={t("新文件 {count}", { count: summary.untracked })} variant="outlined" />
        </Stack>

        {selectable ? (
          <Stack direction="row" columnGap={0.45} rowGap={0.45} flexWrap="wrap">
            <Chip
              size="small"
              label={t("已选择 {count}", { count: selectedCount })}
              color={selectedCount > 0 ? "primary" : "default"}
              variant={selectedCount > 0 ? "filled" : "outlined"}
            />
            <Button
              size="small"
              variant="outlined"
              disabled={selectableFiles.length === 0 || allSelectableSelected}
              onClick={() => updateSelectedPaths(selectableFiles.map((item) => item.path))}
              sx={{ minHeight: 24, px: 0.8, fontSize: "0.7rem" }}
            >
              {t("全选可提交")}
            </Button>
            <Button
              size="small"
              variant="text"
              disabled={selectedCount === 0}
              onClick={() => updateSelectedPaths([])}
              sx={{ minHeight: 24, px: 0.8, fontSize: "0.7rem" }}
            >
              {t("清空")}
            </Button>
          </Stack>
        ) : null}

        <Stack direction="row" columnGap={0.45} rowGap={0.45} flexWrap="wrap">
          {BRANCH_CHANGED_FILE_FILTERS.map((item) => (
            <Chip
              key={item.key}
              size="small"
              label={t(item.label)}
              clickable
              color={filter === item.key ? "primary" : "default"}
              variant={filter === item.key ? "filled" : "outlined"}
              onClick={() => setFilter(item.key)}
            />
          ))}
        </Stack>

        {showSearch ? (
          <TextField
            size="small"
            value={query}
            placeholder={t("筛选文件路径、状态或 Git 代码")}
            onChange={(event) => setQuery(event.target.value)}
            fullWidth
            inputProps={{
              style: {
                fontSize: dense ? "0.74rem" : "0.78rem",
                paddingTop: dense ? 6 : 7,
                paddingBottom: dense ? 6 : 7,
              },
            }}
          />
        ) : null}

        {overflow ? (
          <Typography variant="caption" color="text.secondary">
            {t("默认显示前 {count} 条高度，可下拉查看更多。", {
              count: BRANCH_CHANGED_FILE_VISIBLE_ROWS,
            })}
          </Typography>
        ) : null}

        {filteredFiles.length === 0 ? (
          <Box
            sx={{
              px: dense ? 0.8 : 0.9,
              py: dense ? 0.7 : 0.8,
              borderRadius: dense ? "12px" : "14px",
              border: "1px dashed",
              borderColor: "divider",
              minWidth: 0,
            }}
          >
            <Typography variant="caption" color="text.secondary">
              {t("当前筛选没有匹配的变更文件。")}
            </Typography>
          </Box>
        ) : null}

        <Box
          sx={{
            maxHeight: overflow ? `${BRANCH_CHANGED_FILE_LIST_MAX_HEIGHT}px` : "none",
            overflowY: overflow ? "auto" : "visible",
            pr: overflow ? 0.5 : 0,
          }}
        >
          <Stack spacing={0.55}>
            {filteredFiles.map((item, index) => {
              const risks = branchChangedFileRisks(item);
              const diffKey = diffKeyForFile(item);
              const diffState = diffCache[diffKey];
              const diffExpanded = expandedDiffKey === diffKey;
              const fileSelectable = selectable && !item.conflicted;
              const fileSelected = selectedPathSet.has(item.path);
              return (
                <Box
                  key={`${item.code}-${item.path}-${index}`}
                  sx={{
                    px: dense ? 0.8 : 0.9,
                    py: dense ? 0.65 : 0.75,
                    borderRadius: dense ? "12px" : "14px",
                    border: "1px solid",
                    borderColor: item.conflicted
                      ? "error.light"
                      : risks.length > 0
                        ? "warning.light"
                        : "divider",
                    bgcolor: dense ? "rgba(255,255,255,0.012)" : "rgba(255,255,255,0.01)",
                    minWidth: 0,
                    maxWidth: "100%",
                    overflow: "hidden",
                  }}
                >
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    justifyContent="space-between"
                    alignItems={{ xs: "stretch", sm: "center" }}
                    spacing={dense ? 0.8 : 1}
                  >
                    <Stack direction="row" spacing={0.55} alignItems="flex-start" minWidth={0}>
                      {selectable ? (
                        <Checkbox
                          size="small"
                          checked={fileSelected}
                          disabled={!fileSelectable}
                          onChange={(event) => toggleSelectedPath(item.path, event.target.checked)}
                          sx={{ p: 0.1, mt: 0.1 }}
                          inputProps={{
                            "aria-label": t("选择 {path}", { path: item.path }),
                          }}
                        />
                      ) : null}
                      <Stack spacing={0.35} minWidth={0}>
                        <Typography
                          variant="caption"
                          sx={{
                            minWidth: 0,
                            whiteSpace: "normal",
                            wordBreak: "break-all",
                            overflowWrap: "anywhere",
                            lineHeight: 1.45,
                            fontFamily:
                              '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace',
                            fontSize: "0.71rem",
                          }}
                        >
                          {item.path}
                        </Typography>
                        {risks.length > 0 ? (
                          <Stack direction="row" columnGap={0.35} rowGap={0.35} flexWrap="wrap">
                            {risks.map((risk) => (
                              <Chip
                                key={risk}
                                size="small"
                                label={t(branchChangedFileRiskLabel(risk))}
                                color={risk === "conflict" ? "error" : "warning"}
                                variant="outlined"
                                sx={{ height: 20, fontSize: "0.68rem" }}
                              />
                            ))}
                          </Stack>
                        ) : null}
                      </Stack>
                    </Stack>
                    <Stack
                      direction="row"
                      spacing={0.45}
                      alignItems="center"
                      justifyContent={{ xs: "flex-start", sm: "flex-end" }}
                      flexWrap="wrap"
                      rowGap={0.45}
                      sx={{ flexShrink: 0 }}
                    >
                      <Chip
                        size="small"
                        label={t(branchChangedFileChangeLabel(item))}
                        variant="outlined"
                        sx={{ flexShrink: 0 }}
                      />
                      <Chip
                        size="small"
                        label={t(branchChangedFileStatusLabel(item))}
                        color={item.conflicted ? "error" : "default"}
                        variant={item.conflicted ? "filled" : "outlined"}
                        sx={{ flexShrink: 0 }}
                      />
                      <Button
                        size="small"
                        variant="text"
                        disabled={!canLoadDiff}
                        onClick={() => {
                          void toggleFileDiff(item);
                        }}
                        sx={{ minWidth: 0, px: 0.7, minHeight: 24, fontSize: "0.7rem" }}
                      >
                        {t(diffExpanded ? "收起差异" : "查看差异")}
                      </Button>
                      <Button
                        size="small"
                        variant="text"
                        onClick={() => {
                          void copyChangedFilePath(item.path).then(() => setCopiedPath(item.path));
                        }}
                        sx={{ minWidth: 0, px: 0.7, minHeight: 24, fontSize: "0.7rem" }}
                      >
                        {t(copiedPath === item.path ? "已复制" : "复制")}
                      </Button>
                    </Stack>
                  </Stack>
                  {diffExpanded ? (
                    <BranchFileDiffPreview state={diffState} />
                  ) : null}
                </Box>
              );
            })}
          </Stack>
        </Box>
      </Stack>
    </Collapse>
  );
}
