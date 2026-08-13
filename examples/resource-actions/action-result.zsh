# Shared helpers for process Actions that declare output = "structured_json".
RDEV_ACTION_STDOUT=""
RDEV_ACTION_STDERR=""
RDEV_ACTION_RESULTS_FILE=""
RDEV_ACTION_STDOUT_FILE=""
RDEV_ACTION_STDERR_FILE=""

rdev_action_param_bool() {
  local payload_file=$1
  local param_key=$2
  local default_value=${3:-false}

  if [[ "$default_value" != "true" && "$default_value" != "false" ]]; then
    print -u2 "boolean parameter default must be true or false: $default_value"
    return 2
  fi
  jq -r --arg key "$param_key" --argjson default "$default_value" '
    .params[$key] as $value
    | if $value == null then $default
      elif ($value | type) == "boolean" then $value
      else error("action parameter \($key) must be boolean")
      end
  ' "$payload_file"
}

rdev_action_result_init() {
  local prefix=${1:-rdevtool-action}
  RDEV_ACTION_RESULTS_FILE=$(mktemp "${TMPDIR:-/tmp}/${prefix}-results.XXXXXX")
  RDEV_ACTION_STDOUT_FILE=$(mktemp "${TMPDIR:-/tmp}/${prefix}-stdout.XXXXXX")
  RDEV_ACTION_STDERR_FILE=$(mktemp "${TMPDIR:-/tmp}/${prefix}-stderr.XXXXXX")
}

rdev_action_result_cleanup() {
  rm -f "$RDEV_ACTION_RESULTS_FILE" "$RDEV_ACTION_STDOUT_FILE" "$RDEV_ACTION_STDERR_FILE"
}

rdev_action_run() {
  local program=$1
  shift
  : > "$RDEV_ACTION_STDOUT_FILE"
  : > "$RDEV_ACTION_STDERR_FILE"
  if "$program" "$@" > "$RDEV_ACTION_STDOUT_FILE" 2> "$RDEV_ACTION_STDERR_FILE"; then
    RDEV_ACTION_STDOUT=$(<"$RDEV_ACTION_STDOUT_FILE")
    RDEV_ACTION_STDERR=$(<"$RDEV_ACTION_STDERR_FILE")
    return 0
  fi
  RDEV_ACTION_STDOUT=$(<"$RDEV_ACTION_STDOUT_FILE")
  RDEV_ACTION_STDERR=$(<"$RDEV_ACTION_STDERR_FILE")
  return 1
}

rdev_action_failure_detail() {
  local fallback=$1
  local detail
  detail=$(jq -r '.error.message // empty' <<< "$RDEV_ACTION_STDOUT" 2>/dev/null) || detail=""
  [[ -n "$detail" ]] || detail="$RDEV_ACTION_STDERR"
  [[ -n "$detail" ]] || detail="$fallback"
  print -r -- "$detail"
}

rdev_action_append_item() {
  local key=$1
  local label=$2
  local item_status=$3
  local summary=$4
  local detail=$5
  local url=$6
  local parameters=$7
  jq -cn \
    --arg key "$key" \
    --arg label "$label" \
    --arg status "$item_status" \
    --arg summary "$summary" \
    --arg detail "$detail" \
    --arg url "$url" \
    --argjson parameters "$parameters" \
    '{key: $key, label: $label, status: $status, parameters: $parameters}
      + (if $summary == "" then {} else {summary: $summary} end)
      + (if $detail == "" then {} else {detail: $detail} end)
      + (if $url == "" then {} else {url: $url} end)' >> "$RDEV_ACTION_RESULTS_FILE"
}

rdev_action_emit_result() {
  local summary=$1
  local retry_param=${2:-}
  local retry
  retry=null
  if [[ -n "$retry_param" ]]; then
    retry=$(jq -sc --arg param "$retry_param" '
      [.[] | select(.status == "failed") | .key] as $values
      | if ($values | length) == 0 then null
        else {param: $param, values: $values}
        end
    ' "$RDEV_ACTION_RESULTS_FILE")
  fi
  jq -sc --arg summary "$summary" --argjson retry "$retry" '
    {schemaVersion: 1, summary: $summary, items: .}
    + (if $retry == null then {} else {retry: $retry} end)
  ' "$RDEV_ACTION_RESULTS_FILE"
}
