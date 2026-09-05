import { useMemo } from "react";
import {
  Autocomplete,
  Box,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  isCustomWorkspaceTypeOption,
  normalizeWorkspaceType,
  normalizeWorkspaceTypeOptionLabel,
  workspaceTypeLabel,
  type WorkspaceTypeOption,
} from "../lib/workspaceTypes";
import { PlusIcon, TrashIcon } from "./AppIcons";
import { useI18n } from "../i18n";

type WorkspaceTypeSelectOption = WorkspaceTypeOption & {
  createInput?: string;
  create?: boolean;
};

type WorkspaceTypeSelectProps = {
  label?: string;
  value: string;
  options: WorkspaceTypeOption[];
  usageCounts?: Map<string, number>;
  disabled?: boolean;
  className?: string;
  onChange: (key: string, label: string) => void;
  onCreate?: (label: string) => Promise<WorkspaceTypeOption> | WorkspaceTypeOption;
  onDelete?: (key: string, label: string) => Promise<void> | void;
};

function optionMatchesQuery(option: WorkspaceTypeOption, query: string) {
  const normalized = query.toLocaleLowerCase();
  return (
    option.label.toLocaleLowerCase().includes(normalized) ||
    option.key.toLocaleLowerCase().includes(normalized)
  );
}

export function WorkspaceTypeSelect({
  label = "类型",
  value,
  options,
  usageCounts,
  disabled,
  className,
  onChange,
  onCreate,
  onDelete,
}: WorkspaceTypeSelectProps) {
  const { t } = useI18n();
  const selectedOption = useMemo<WorkspaceTypeSelectOption>(() => {
    const key = normalizeWorkspaceType(value);
    const option = options.find((item) => item.key === key);
    return option ?? { key, label: workspaceTypeLabel(key, null, options) };
  }, [options, value]);

  async function handleSelect(option: WorkspaceTypeSelectOption) {
    if (option.create && option.createInput && onCreate) {
      const created = await onCreate(option.createInput);
      onChange(created.key, created.label);
      return;
    }
    onChange(option.key, option.label);
  }

  return (
    <Autocomplete<WorkspaceTypeSelectOption, false, true, false>
      className={className ? `workspace-type-combo ${className}` : "workspace-type-combo"}
      size="small"
      fullWidth
      disableClearable
      disabled={disabled}
      autoHighlight
      selectOnFocus
      handleHomeEndKeys
      options={options}
      value={selectedOption}
      isOptionEqualToValue={(option, optionValue) => option.key === optionValue.key}
      getOptionLabel={(option) => t(option.label)}
      filterOptions={(availableOptions, state) => {
        const input = normalizeWorkspaceTypeOptionLabel(state.inputValue);
        const filtered = input
          ? availableOptions.filter((option) => optionMatchesQuery(option, input))
          : [...availableOptions];
        const exists = availableOptions.some((option) => option.label === input);
        if (input && !exists && onCreate) {
          filtered.push({
            key: `__create_workspace_type__:${input}`,
            label: t("创建「{label}」", { label: input }),
            createInput: input,
            create: true,
          });
        }
        return filtered;
      }}
      onChange={(_, nextOption) => {
        if (!nextOption) {
          return;
        }
        void handleSelect(nextOption);
      }}
      slotProps={{
        paper: { className: "workspace-type-combo-paper" },
        listbox: { className: "workspace-type-combo-list" },
      }}
      renderInput={(params) => <TextField {...params} label={t(label)} />}
      renderOption={(props, option) => {
        const { key, className: optionClassName, ...optionProps } = props;
        const usedCount = usageCounts?.get(option.key) ?? 0;
        const custom = isCustomWorkspaceTypeOption(option);
        const canDelete = Boolean(onDelete && custom && usedCount === 0 && !option.create);
        return (
          <Box
            component="li"
            key={key}
            {...optionProps}
            className={`${optionClassName ?? ""} workspace-type-combo-option${option.create ? " is-create" : ""}`}
          >
            <span className="workspace-type-combo-icon">
              {option.create ? <PlusIcon fontSize="small" /> : null}
            </span>
            <span className="workspace-type-combo-copy">
              <Typography component="span" className="workspace-type-combo-label" noWrap>
                {t(option.label)}
              </Typography>
              {custom && usedCount > 0 ? (
                <Typography component="span" className="workspace-type-combo-meta" noWrap>
                  {t("已使用 {count}", { count: usedCount })}
                </Typography>
              ) : null}
            </span>
            {canDelete ? (
              <Tooltip title={t("删除类型")}>
                <IconButton
                  size="small"
                  className="workspace-type-combo-delete"
                  aria-label={t("删除类型 {label}", {
                    label: option.label,
                  })}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void onDelete?.(option.key, option.label);
                  }}
                >
                  <TrashIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
          </Box>
        );
      }}
    />
  );
}
