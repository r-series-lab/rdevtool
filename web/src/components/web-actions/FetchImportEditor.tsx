import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  HTTP_REQUEST_CREDENTIALS,
  HTTP_REQUEST_METHODS,
  HTTP_REQUEST_MODES,
  isSensitiveHttpRequestHeader,
  type EditableHttpPair,
  type EditableHttpRequest,
} from "../../lib/httpRequest";
import { PlusIcon, TrashIcon, UploadIcon } from "../AppIcons";

type EditableHttpPairListProps = {
  label: string;
  nameLabel: string;
  rows: EditableHttpPair[];
  maskSensitiveValues?: boolean;
  onChange: (rows: EditableHttpPair[]) => void;
};

function EditableHttpPairList({
  label,
  nameLabel,
  rows,
  maskSensitiveValues = false,
  onChange,
}: EditableHttpPairListProps) {
  function updateRow(index: number, patch: Partial<EditableHttpPair>) {
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function removeRow(index: number) {
    onChange(rows.filter((_, rowIndex) => rowIndex !== index));
  }

  return (
    <Stack spacing={0.65}>
      <Stack direction="row" alignItems="center" spacing={0.6}>
        <Typography variant="caption" sx={{ color: "var(--muted)", fontWeight: 800 }}>
          {label}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Tooltip title={`添加${label}`}>
          <IconButton
            size="small"
            aria-label={`添加${label}`}
            onClick={() => onChange([...rows, { name: "", value: "" }])}
            sx={{ width: 28, height: 28, color: "var(--muted)" }}
          >
            <PlusIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      {rows.length === 0 ? (
        <Typography variant="caption" sx={{ color: "var(--muted)" }}>
          无
        </Typography>
      ) : null}
      {rows.map((row, index) => {
        const sensitive = maskSensitiveValues && isSensitiveHttpRequestHeader(row.name);
        return (
          <Box
            key={index}
            sx={{
              display: "grid",
              gridTemplateColumns: "minmax(100px, 0.85fr) minmax(0, 1.35fr) 30px",
              gap: 0.55,
              alignItems: "center",
            }}
          >
            <TextField
              size="small"
              label={nameLabel}
              value={row.name}
              onChange={(event) => updateRow(index, { name: event.target.value })}
            />
            <TextField
              size="small"
              label={sensitive ? "敏感值" : "值"}
              type={sensitive ? "password" : "text"}
              value={row.value}
              onChange={(event) => updateRow(index, { value: event.target.value })}
            />
            <Tooltip title="删除">
              <IconButton
                size="small"
                aria-label={`删除${label} ${index + 1}`}
                onClick={() => removeRow(index)}
                sx={{ width: 28, height: 28, color: "var(--muted)" }}
              >
                <TrashIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        );
      })}
    </Stack>
  );
}

type HttpRequestDraftEditorProps = {
  request: EditableHttpRequest;
  validationErrors: string[];
  onChange: (request: EditableHttpRequest) => void;
  onImportFetch: () => void;
  onFormatBody: () => void;
};

export function HttpRequestDraftEditor({
  request,
  validationErrors,
  onChange,
  onImportFetch,
  onFormatBody,
}: HttpRequestDraftEditorProps) {
  return (
    <Stack spacing={0.9}>
      <Stack direction="row" alignItems="center" spacing={0.65} useFlexGap flexWrap="wrap">
        <Typography variant="caption" sx={{ color: "var(--muted)", fontWeight: 850 }}>
          HTTP 请求草稿
        </Typography>
        <Chip size="small" label="未保存" />
        <Chip size="small" label="浏览器登录态" />
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          color="inherit"
          startIcon={<UploadIcon fontSize="small" />}
          onClick={onImportFetch}
          sx={{ minWidth: 0, px: 1 }}
        >
          导入 Fetch
        </Button>
      </Stack>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "repeat(2, minmax(0, 1fr))",
            sm: "120px minmax(150px, 0.8fr) minmax(150px, 0.8fr)",
          },
          gap: 0.65,
        }}
      >
        <TextField
          select
          size="small"
          label="Method"
          value={request.method}
          onChange={(event) => onChange({ ...request, method: event.target.value })}
        >
          {HTTP_REQUEST_METHODS.map((method) => (
            <MenuItem key={method} value={method}>
              {method}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Credentials"
          value={request.credentials}
          onChange={(event) =>
            onChange({ ...request, credentials: event.target.value as RequestCredentials })
          }
        >
          {HTTP_REQUEST_CREDENTIALS.map((credentials) => (
            <MenuItem key={credentials} value={credentials}>
              {credentials}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Mode"
          value={request.mode}
          onChange={(event) =>
            onChange({ ...request, mode: event.target.value as RequestMode | "" })
          }
        >
          {HTTP_REQUEST_MODES.map((mode) => (
            <MenuItem key={mode || "default"} value={mode}>
              {mode || "浏览器默认"}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      <TextField
        size="small"
        label="URL"
        value={request.url}
        onChange={(event) => onChange({ ...request, url: event.target.value })}
        fullWidth
      />

      <EditableHttpPairList
        label="Query"
        nameLabel="参数"
        rows={request.query}
        onChange={(query) => onChange({ ...request, query })}
      />
      <EditableHttpPairList
        label="Headers"
        nameLabel="Header"
        rows={request.headers}
        maskSensitiveValues
        onChange={(headers) => onChange({ ...request, headers })}
      />

      <Stack spacing={0.55}>
        <Stack direction="row" alignItems="center" spacing={0.6}>
          <Typography variant="caption" sx={{ color: "var(--muted)", fontWeight: 800 }}>
            Body
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Button
            size="small"
            color="inherit"
            disabled={!request.body.trim()}
            onClick={onFormatBody}
            sx={{ minWidth: 0, px: 1 }}
          >
            格式化 JSON
          </Button>
        </Stack>
        <TextField
          value={request.body}
          multiline
          minRows={4}
          maxRows={10}
          fullWidth
          onChange={(event) => onChange({ ...request, body: event.target.value })}
          sx={{
            "& .MuiInputBase-root": {
              fontFamily: '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace',
              fontSize: "0.74rem",
              lineHeight: 1.48,
            },
          }}
        />
      </Stack>

      {[...request.warnings, ...validationErrors].map((message, index) => (
        <Typography
          key={`${index}-${message}`}
          variant="caption"
          sx={{ color: index >= request.warnings.length ? "var(--danger)" : "var(--muted)" }}
        >
          {message}
        </Typography>
      ))}
    </Stack>
  );
}

type FetchImportDialogProps = {
  open: boolean;
  source: string;
  error: string;
  onSourceChange: (source: string) => void;
  onClose: () => void;
  onImport: () => void;
};

export function FetchImportDialog({
  open,
  source,
  error,
  onSourceChange,
  onClose,
  onImport,
}: FetchImportDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ fontSize: "1rem", fontWeight: 800 }}>导入 Fetch</DialogTitle>
      <DialogContent>
        <Stack spacing={0.8} sx={{ pt: 0.4 }}>
          <TextField
            autoFocus
            label="Chrome Copy as fetch"
            value={source}
            onChange={(event) => onSourceChange(event.target.value)}
            multiline
            minRows={10}
            maxRows={18}
            fullWidth
            placeholder={'fetch("https://example.com/api", {\n  method: "POST",\n  headers: {},\n  body: ""\n});'}
            sx={{
              "& .MuiInputBase-root": {
                fontFamily:
                  '"SFMono-Regular","IBM Plex Mono","Fira Code","Menlo",monospace',
                fontSize: "0.76rem",
                lineHeight: 1.5,
              },
            }}
          />
          {error ? (
            <Typography variant="caption" sx={{ color: "var(--danger)" }}>
              {error}
            </Typography>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={onClose}>
          取消
        </Button>
        <Button variant="contained" disabled={!source.trim()} onClick={onImport}>
          解析请求
        </Button>
      </DialogActions>
    </Dialog>
  );
}
