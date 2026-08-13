import {
  Autocomplete,
  Button,
  Checkbox,
  Chip,
  FormControl,
  FormControlLabel,
  FormHelperText,
  IconButton,
  InputAdornment,
  InputLabel,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";

import type {
  ResourceActionParam,
  ResourceActionParamValue,
} from "../app-types";
import type { ResourceActionValues } from "../lib/resourceActions";
import { useI18n } from "../i18n";
import { CheckIcon, ClearIcon, FolderIcon } from "./AppIcons";

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

  if (param.kind === "project_multi") {
    const selected = Array.isArray(value) ? value : [];
    const labels = new Map(param.options.map((option) => [option.value, option.label]));
    const selectionLimit = Math.min(param.maxItems ?? param.options.length, param.options.length);
    const labelId = `${fieldId}-label`;
    return (
      <Stack className="resource-action-project-picker" spacing={0.75}>
        <Stack
          className="resource-action-project-toolbar"
          direction="row"
          alignItems="center"
          spacing={0.6}
        >
          <Chip
            className="resource-action-project-count"
            size="small"
            variant="outlined"
            label={t("已选 {selected}/{total}", {
              selected: selected.length,
              total: param.options.length,
            })}
          />
          <Stack
            className="resource-action-project-tools"
            direction="row"
            spacing={0.25}
          >
            <Button
              className="resource-action-project-tool"
              size="small"
              color="inherit"
              startIcon={<CheckIcon fontSize="small" />}
              disabled={disabled || selected.length >= selectionLimit}
              onClick={() =>
                onChange(param.options.slice(0, selectionLimit).map((option) => option.value))
              }
            >
              {t("全选")}
            </Button>
            <Button
              className="resource-action-project-tool"
              size="small"
              color="inherit"
              startIcon={<ClearIcon fontSize="small" />}
              disabled={disabled || selected.length === 0}
              onClick={() => onChange([])}
            >
              {t("清空")}
            </Button>
          </Stack>
        </Stack>
        <FormControl
          className="resource-action-project-control"
          fullWidth
          size="small"
          error={Boolean(error)}
          disabled={disabled}
        >
          <InputLabel id={labelId} shrink>
            {label}
          </InputLabel>
          <Select
            className="resource-action-project-select"
            id={fieldId}
            labelId={labelId}
            aria-describedby={`${fieldId}-helper-text`}
            multiple
            displayEmpty
            label={label}
            value={selected}
            onChange={(event) => {
              const next = event.target.value;
              onChange(typeof next === "string" ? next.split(",") : next);
            }}
            renderValue={(items) =>
              items.length > 0 ? (
                <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
                  {items.map((item) => (
                    <Chip
                      className="resource-action-project-selection"
                      key={item}
                      size="small"
                      label={labels.get(item) ?? item}
                    />
                  ))}
                </Stack>
              ) : (
                <Typography component="span" className="resource-action-select-placeholder">
                  {param.placeholder || t("请选择项目")}
                </Typography>
              )
            }
            MenuProps={{
              slotProps: {
                paper: {
                  className: "resource-action-project-menu",
                  sx: { maxHeight: 360 },
                },
              },
            }}
          >
            {param.options.map((option) => (
              <MenuItem
                className="resource-action-project-option"
                key={option.value}
                value={option.value}
                disabled={
                  !selected.includes(option.value) && selected.length >= selectionLimit
                }
              >
                <Checkbox checked={selected.includes(option.value)} size="small" />
                <ListItemText primary={option.label} secondary={option.value} />
              </MenuItem>
            ))}
          </Select>
          {helperText ? (
            <FormHelperText id={`${fieldId}-helper-text`}>{helperText}</FormHelperText>
          ) : null}
        </FormControl>
      </Stack>
    );
  }

  if (param.kind === "multi_select") {
    const selected = Array.isArray(value) ? value : [];
    const labels = new Map(param.options.map((option) => [option.value, option.label]));
    const labelId = `${fieldId}-label`;
    return (
      <FormControl fullWidth size="small" error={Boolean(error)} disabled={disabled}>
        <InputLabel id={labelId}>{label}</InputLabel>
        <Select
          id={fieldId}
          labelId={labelId}
          aria-describedby={`${fieldId}-helper-text`}
          multiple
          label={label}
          value={selected}
          onChange={(event) => {
            const next = event.target.value;
            onChange(typeof next === "string" ? next.split(",") : next);
          }}
          renderValue={(items) => items.map((item) => labels.get(item) ?? item).join("、")}
          sx={{ minHeight: 40 }}
        >
          {param.options.map((option) => (
            <MenuItem
              key={option.value}
              value={option.value}
              disabled={
                !selected.includes(option.value) &&
                param.maxItems != null &&
                selected.length >= param.maxItems
              }
            >
              <Checkbox checked={selected.includes(option.value)} size="small" />
              <ListItemText primary={option.label} />
            </MenuItem>
          ))}
        </Select>
        {helperText ? (
          <FormHelperText id={`${fieldId}-helper-text`}>{helperText}</FormHelperText>
        ) : null}
      </FormControl>
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
