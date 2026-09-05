import {
  Autocomplete,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";

import type {
  ResourceActionOption,
  ResourceActionParam,
  ResourceActionParamValue,
} from "../app-types";
import type { ResourceActionValues } from "../lib/resourceActions";
import { useI18n } from "../i18n";
import { FolderIcon } from "./AppIcons";

export type ParameterFormProps = {
  params: ResourceActionParam[];
  values: ResourceActionValues;
  errors?: Record<string, string>;
  disabled?: boolean;
  onChange: (key: string, value: ResourceActionParamValue) => void;
  onBrowse?: (param: ResourceActionParam) => void;
};

export function ParameterForm({
  params,
  values,
  errors = {},
  disabled = false,
  onChange,
  onBrowse,
}: ParameterFormProps) {
  const { t } = useI18n();
  const visibleParams = params.filter((param) => param.kind !== "hidden");
  const projectParams = visibleParams.filter((param) => param.kind === "project_multi");
  const detailParams = visibleParams.filter((param) => param.kind !== "project_multi");
  const renderField = (param: ResourceActionParam) => (
    <div
      key={param.key}
      className={`resource-action-param resource-action-param--${param.kind}`}
    >
      <ParameterField
        param={param}
        value={values[param.key]}
        error={errors[param.key]}
        disabled={disabled}
        selectNoneLabel={t("未选择")}
        browseLabel={param.kind === "directory" ? t("选择目录") : t("选择文件")}
        onChange={(value) => onChange(param.key, value)}
        onBrowse={onBrowse ? () => onBrowse(param) : undefined}
      />
    </div>
  );
  return (
    <Stack className="resource-action-parameter-form" spacing={0}>
      {projectParams.map(renderField)}
      {detailParams.length > 0 ? (
        <Stack className="resource-action-secondary-params" spacing={0}>
          {detailParams.map(renderField)}
        </Stack>
      ) : null}
    </Stack>
  );
}

type ParameterFieldProps = {
  param: ResourceActionParam;
  value: ResourceActionParamValue | undefined;
  error?: string;
  disabled: boolean;
  onChange: (value: ResourceActionParamValue) => void;
  onBrowse?: () => void;
  selectNoneLabel: string;
  browseLabel: string;
};

function ParameterField({
  param,
  value,
  error,
  disabled,
  onChange,
  onBrowse,
  selectNoneLabel,
  browseLabel,
}: ParameterFieldProps) {
  const { t } = useI18n();
  const helperText = error || param.description || undefined;
  const label = param.required ? `${param.label} *` : param.label;
  const fieldId = `resource-action-param-${param.key}`;

  if (param.kind === "boolean") {
    return (
      <Stack className="resource-action-boolean-field" spacing={0.25}>
        <FormControlLabel
          control={
            <Switch
              checked={value === true}
              disabled={disabled}
              onChange={(event) => onChange(event.target.checked)}
            />
          }
          label={param.label}
          className="resource-action-boolean-control"
        />
        {param.description ? (
          <Typography variant="caption" color="text.secondary">
            {param.description}
          </Typography>
        ) : null}
      </Stack>
    );
  }

  if (param.kind === "project_multi" || param.kind === "multi_select") {
    const selected = Array.isArray(value) ? value : [];
    const optionsByValue = new Map(param.options.map((option) => [option.value, option]));
    const selectedOptions = selected.map(
      (selectedValue) =>
        optionsByValue.get(selectedValue) ?? {
          value: selectedValue,
          label: selectedValue,
        },
    );
    const selectionLimit = Math.min(
      param.maxItems ?? param.options.length,
      param.options.length,
    );
    const isProjectPicker = param.kind === "project_multi";
    const optionLabel = (option: ResourceActionOption) =>
      isProjectPicker && option.label !== option.value
        ? `${option.label} (${option.value})`
        : option.label;
    return (
      <Autocomplete<ResourceActionOption, true, false, false>
        className={`resource-action-multi-select${
          isProjectPicker ? " resource-action-multi-select--project" : ""
        }`}
        multiple
        fullWidth
        disableCloseOnSelect
        disabled={disabled}
        options={param.options}
        value={selectedOptions}
        getOptionLabel={optionLabel}
        isOptionEqualToValue={(option, selectedOption) => option.value === selectedOption.value}
        getOptionDisabled={(option) =>
          !selected.includes(option.value) && selected.length >= selectionLimit
        }
        onChange={(_, nextOptions) => onChange(nextOptions.map((option) => option.value))}
        clearText={t("清空选择")}
        openText={t("展开选项")}
        closeText={t("收起选项")}
        noOptionsText={t("没有匹配的选项")}
        renderInput={(inputProps) => (
          <TextField
            {...inputProps}
            id={fieldId}
            label={label}
            placeholder={
              selected.length === 0
                ? param.placeholder || (isProjectPicker ? t("搜索并选择项目") : undefined)
                : undefined
            }
            error={Boolean(error)}
            helperText={helperText}
          />
        )}
        slotProps={{
          paper: {
            className: "resource-action-multi-select-menu",
          },
          listbox: {
            className: "resource-action-multi-select-options",
          },
        }}
      />
    );
  }

  if (param.kind === "branch") {
    const textValue = typeof value === "string" ? value : "";
    return (
      <Autocomplete
        freeSolo
        fullWidth
        disabled={disabled}
        options={param.options.map((option) => option.value)}
        value={textValue}
        inputValue={textValue}
        onChange={(_, next) => onChange(typeof next === "string" ? next : next ?? "")}
        onInputChange={(_, next, reason) => {
          if (reason !== "reset" || next !== textValue) onChange(next);
        }}
        renderInput={(inputProps) => (
          <TextField
            {...inputProps}
            id={fieldId}
            size="small"
            label={label}
            placeholder={param.placeholder ?? undefined}
            error={Boolean(error)}
            helperText={helperText}
            inputProps={{
              ...inputProps.inputProps,
              minLength: param.minLength ?? undefined,
              maxLength: param.maxLength ?? undefined,
            }}
          />
        )}
      />
    );
  }

  if (param.kind === "select" || param.kind === "project") {
    const selected = typeof value === "string" ? value : "";
    return (
      <TextField
        id={fieldId}
        select
        fullWidth
        size="small"
        label={label}
        value={selected}
        disabled={disabled}
        error={Boolean(error)}
        helperText={helperText}
        onChange={(event) => onChange(event.target.value)}
      >
        {!param.required ? <MenuItem value="">{selectNoneLabel}</MenuItem> : null}
        {param.options.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </TextField>
    );
  }

  const isPath = param.kind === "file" || param.kind === "directory";
  const textValue = typeof value === "string" ? value : "";
  return (
    <TextField
      id={fieldId}
      fullWidth
      size="small"
      label={label}
      value={param.kind === "number" ? value ?? "" : textValue}
      type={
        param.kind === "number" ? "number" : param.kind === "secret" ? "password" : "text"
      }
      multiline={param.kind === "textarea"}
      minRows={param.kind === "textarea" ? 3 : undefined}
      disabled={disabled}
      placeholder={param.placeholder ?? undefined}
      error={Boolean(error)}
      helperText={helperText}
      inputProps={
        param.kind === "number"
          ? {
              min: param.min ?? undefined,
              max: param.max ?? undefined,
              step: param.step ?? "any",
            }
          : {
              minLength: param.minLength ?? undefined,
              maxLength: param.maxLength ?? undefined,
            }
      }
      onChange={(event) => {
        if (param.kind !== "number") {
          onChange(event.target.value);
          return;
        }
        onChange(event.target.value === "" ? null : Number(event.target.value));
      }}
      InputProps={
        isPath && onBrowse
          ? {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    onClick={onBrowse}
                    disabled={disabled}
                    aria-label={browseLabel}
                    title={browseLabel}
                  >
                    <FolderIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ),
            }
          : undefined
      }
    />
  );
}
