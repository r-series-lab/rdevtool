import { useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import type { BranchPushFileStatus } from "../../app-types";
import { useI18n } from "../../i18n";
import {
  CheckIcon,
  CollapseIcon,
  CopyIcon,
  EditIcon,
  ExpandIcon,
  FolderIcon,
  PlusIcon,
  TrashIcon,
  WarningIcon,
} from "../AppIcons";

const DEFAULT_PREVIEW_LIMIT = 10;

type FileTone = "added" | "modified" | "deleted" | "conflicted";

type PushCommitConfirmContentProps = {
  files: BranchPushFileStatus[];
  repoPath: string;
  previewLimit?: number;
};

function fileTone(item: BranchPushFileStatus): FileTone {
  if (item.conflicted) {
    return "conflicted";
  }
  if (item.untracked || item.code.includes("A")) {
    return "added";
  }
  if (item.code.includes("D")) {
    return "deleted";
  }
  return "modified";
}

function fileStatusLabel(item: BranchPushFileStatus) {
  if (item.conflicted) return "冲突";
  if (item.untracked || item.code.includes("A")) return "新增";
  if (item.code.includes("D")) return "删除";
  if (item.staged && item.unstaged) return "暂存 + 修改";
  if (item.staged) return "已暂存";
  if (item.unstaged) return "修改";
  return item.code || "变更";
}

function FileStatusIcon({ tone }: { tone: FileTone }) {
  if (tone === "added") {
    return <PlusIcon fontSize="small" />;
  }
  if (tone === "deleted") {
    return <TrashIcon fontSize="small" />;
  }
  if (tone === "conflicted") {
    return <WarningIcon fontSize="small" />;
  }
  return <EditIcon fontSize="small" />;
}

export function PushCommitConfirmContent({
  files,
  repoPath,
  previewLimit = DEFAULT_PREVIEW_LIMIT,
}: PushCommitConfirmContentProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const counts = useMemo(
    () =>
      files.reduce(
        (result, item) => {
          result[fileTone(item)] += 1;
          return result;
        },
        { added: 0, modified: 0, deleted: 0, conflicted: 0 },
      ),
    [files],
  );
  const visibleFiles = expanded ? files : files.slice(0, previewLimit);
  const hiddenCount = Math.max(0, files.length - visibleFiles.length);

  async function copyRepoPath() {
    if (!repoPath || !navigator.clipboard?.writeText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(repoPath);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Stack className="push-commit-confirm-content" spacing={1.1}>
      {repoPath ? (
        <Box className="push-commit-confirm-path">
          <Typography title={repoPath}>{repoPath}</Typography>
          <Tooltip title={t(copied ? "已复制" : "复制目录")}>
            <IconButton
              size="small"
              aria-label={t(copied ? "目录已复制" : "复制目录")}
              onClick={() => void copyRepoPath()}
            >
              {copied ? <CheckIcon fontSize="small" /> : <CopyIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Box>
      ) : null}

      <Box className="push-commit-confirm-files">
        <Stack
          className="push-commit-confirm-files-header"
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={1}
        >
          <Stack direction="row" alignItems="center" spacing={0.65} minWidth={0}>
            <FolderIcon fontSize="small" />
            <Typography variant="subtitle2">{t("变更文件")}</Typography>
            <Chip size="small" label={files.length} />
          </Stack>
          <Stack
            className="push-commit-confirm-counts"
            direction="row"
            alignItems="center"
            spacing={0.85}
          >
            {counts.added > 0 ? (
              <Box className="is-added">{t("新增 {count}", { count: counts.added })}</Box>
            ) : null}
            {counts.modified > 0 ? (
              <Box className="is-modified">{t("修改 {count}", { count: counts.modified })}</Box>
            ) : null}
            {counts.deleted > 0 ? (
              <Box className="is-deleted">{t("删除 {count}", { count: counts.deleted })}</Box>
            ) : null}
            {counts.conflicted > 0 ? (
              <Box className="is-conflicted">{t("冲突 {count}", { count: counts.conflicted })}</Box>
            ) : null}
          </Stack>
        </Stack>

        <Stack className="push-commit-confirm-file-list" spacing={0.45}>
          {visibleFiles.map((item) => {
            const tone = fileTone(item);
            return (
              <Box
                className={`push-commit-confirm-file is-${tone}`}
                key={`${item.code}-${item.path}`}
              >
                <Box className="push-commit-confirm-file-icon">
                  <FileStatusIcon tone={tone} />
                </Box>
                <Typography title={item.path}>{item.path}</Typography>
                <Chip
                  size="small"
                  label={t(fileStatusLabel(item))}
                  className={`push-commit-confirm-file-status is-${tone}`}
                />
              </Box>
            );
          })}
        </Stack>

        {files.length > previewLimit ? (
          <Button
            className="push-commit-confirm-more"
            size="small"
            variant="text"
            startIcon={
              expanded ? (
                <CollapseIcon fontSize="small" />
              ) : (
                <ExpandIcon fontSize="small" />
              )
            }
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded
              ? t("收起文件列表")
              : t("查看更多 {count} 个文件", { count: hiddenCount })}
          </Button>
        ) : null}
      </Box>
    </Stack>
  );
}
