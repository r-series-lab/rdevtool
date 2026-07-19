import {
  Chip,
  CircularProgress,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { ConfigSource } from "../app-types";
import type { ConfigSourceStatus } from "../hooks/useConfigSource";
import { configSourceKindLabel, configSourceSupports } from "../lib/configSources";
import { SettingsIcon } from "./AppIcons";

type ConfigSourceBarProps = {
  sources: ConfigSource[];
  selectedSourceId: string;
  selectedSource: ConfigSource | null;
  path?: string | null;
  requiredCapability?: string;
  profileFallback?: string;
  warningLabel?: string | null;
  disabled?: boolean;
  manageDisabled?: boolean;
  manageDisabledReason?: string;
  className?: string;
  status?: ConfigSourceStatus;
  error?: string;
  showReadyStatus?: boolean;
  onSourceChange: (sourceId: string) => void | Promise<void>;
  onManage?: () => void;
};

export function ConfigSourceBar({
  sources,
  selectedSourceId,
  selectedSource,
  path,
  requiredCapability,
  profileFallback = "resource-basic",
  warningLabel,
  disabled = false,
  manageDisabled = false,
  manageDisabledReason = "请先保存或取消当前改动",
  className,
  status = "idle",
  error,
  showReadyStatus = false,
  onSourceChange,
  onManage,
}: ConfigSourceBarProps) {
  return (
    <div className={["resource-config-source-strip", className].filter(Boolean).join(" ")}>
      <TextField
        select
        size="small"
        label="配置源"
        value={selectedSourceId}
        onChange={(event) => onSourceChange(event.target.value)}
        disabled={disabled}
      >
        {sources.map((source) => (
          <MenuItem
            key={source.id}
            value={source.id}
            disabled={Boolean(
              requiredCapability && !configSourceSupports(source, requiredCapability),
            )}
          >
            {source.name}
            {source.isDefault ? " · 默认" : ""}
          </MenuItem>
        ))}
      </TextField>
      <div className="resource-config-source-main">
        <Stack direction="row" spacing={0.55} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="caption">{selectedSource?.name ?? "默认配置"}</Typography>
          <Chip
            size="small"
            label={configSourceKindLabel(selectedSource?.kind)}
            variant="outlined"
          />
          <Chip
            size="small"
            label={selectedSource?.uiProfile ?? profileFallback}
            variant="outlined"
          />
          {warningLabel ? (
            <Chip size="small" color="warning" label={warningLabel} variant="outlined" />
          ) : null}
          {status === "loading" || status === "saving" ? (
            <Chip
              size="small"
              icon={<CircularProgress size={12} color="inherit" />}
              label={status === "saving" ? "正在切换" : "正在读取"}
              variant="outlined"
            />
          ) : null}
          {showReadyStatus && status === "ready" ? (
            <Chip size="small" color="success" label="已就绪" variant="outlined" />
          ) : null}
          {status === "error" ? (
            <Tooltip title={error || "配置源同步失败"}>
              <Chip size="small" color="error" label="同步失败" variant="outlined" />
            </Tooltip>
          ) : null}
          {onManage ? (
            <Tooltip title={manageDisabled ? manageDisabledReason : "管理配置源"}>
              <span className="resource-config-source-manage-action">
                <IconButton
                  size="small"
                  aria-label="管理配置源"
                  onClick={onManage}
                  disabled={disabled || manageDisabled}
                >
                  <SettingsIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          ) : null}
        </Stack>
        <Typography
          className="resource-config-source-path"
          variant="caption"
          color="text.secondary"
          noWrap
          title={path ?? ""}
        >
          {path ?? ""}
        </Typography>
      </div>
    </div>
  );
}
