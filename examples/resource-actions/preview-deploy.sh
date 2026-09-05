#!/bin/zsh
set -uo pipefail

if [[ -z "${RDEVTOOL_CLI:-}" || ! -x "$RDEVTOOL_CLI" ]]; then
  print -u2 "RDEVTOOL_CLI is missing or not executable"
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  print -u2 "jq is required to read the Action JSON input"
  exit 2
fi

script_dir=${0:A:h}
source "$script_dir/action-result.zsh"
rdev_action_result_init "rdevtool-preview-deploy"

payload_file=$(mktemp "${TMPDIR:-/tmp}/rdevtool-preview-deploy.XXXXXX")
trap 'rm -f "$payload_file"; rdev_action_result_cleanup' EXIT
cat > "$payload_file"

typeset -a projects
projects=("${(@f)$(jq -er '.params.projects[]' "$payload_file")}")
branch_override=$(jq -r '.params.branchOverride // empty' "$payload_file")
target=$(jq -r '.params.target // "preview"' "$payload_file")
environment=$(jq -r '.params.environment // empty' "$payload_file")
plan_only=$(rdev_action_param_bool "$payload_file" planOnly false)

typeset -A branch_override_projects
typeset -A capability_errors

resolve_branch_override_projects() {
  [[ -n "$branch_override" ]] || return 0

  local project
  for project in "${projects[@]}"; do
    if rdev_action_run "$RDEVTOOL_CLI" --json \
      projects options "$project" --target "$target" &&
      jq -e '.ok == true' >/dev/null <<< "$RDEV_ACTION_STDOUT"; then
      if jq -e 'any(.data.params[]?; .kind == "branch")' >/dev/null <<< "$RDEV_ACTION_STDOUT"; then
        branch_override_projects[$project]=true
      else
        branch_override_projects[$project]=false
      fi
    else
      capability_errors[$project]=$(rdev_action_failure_detail "failed to inspect deploy parameters")
    fi
  done
}

run_build() {
  local command_name=$1
  local project=$2
  local -a args
  args=(--json build "$command_name" "$project" --target "$target")
  [[ -n "$environment" ]] && args+=(--env "$environment")
  if [[ -n "$branch_override" && "${branch_override_projects[$project]:-false}" == "true" ]]; then
    args+=(--branch "$branch_override")
  fi
  rdev_action_run "$RDEVTOOL_CLI" "${args[@]}"
}

append_plan_item() {
  local project=$1
  local item_status
  local label
  local summary
  local detail
  local url
  local parameters
  label=$(jq -r '.data.projectName // empty' <<< "$RDEV_ACTION_STDOUT")
  [[ -n "$label" ]] || label="$project"
  if ! jq -e '.ok == true and .data.status.success == true' >/dev/null <<< "$RDEV_ACTION_STDOUT"; then
    rdev_action_append_item "$project" "$label" failed "Plan failed" \
      "$(rdev_action_failure_detail "deployment plan is not executable")" "" '[]'
    return 1
  fi
  if jq -e 'any(.data.risks[]?; .severity == "warning")' >/dev/null <<< "$RDEV_ACTION_STDOUT"; then
    item_status=warning
  else
    item_status=success
  fi
  summary=$(jq -r '.data.status.label // "Plan ready"' <<< "$RDEV_ACTION_STDOUT")
  detail=$(jq -r '[.data.status.detail, (.data.risks[]?.detail)] | map(select(.)) | join("\n")' <<< "$RDEV_ACTION_STDOUT")
  url=$(jq -r '.data.triggerUrl // empty' <<< "$RDEV_ACTION_STDOUT")
  parameters=$(jq -c '(.data.effective.params // {}) | to_entries | map({key: .key, label: .key, value: (.value | tostring)})' <<< "$RDEV_ACTION_STDOUT")
  rdev_action_append_item "$project" "$label" "$item_status" "$summary" "$detail" "$url" "$parameters"
}

append_deploy_item() {
  local project=$1
  local item_status
  local label
  local summary
  local detail
  local url
  local parameters
  label=$(jq -r '.data.plan.projectName // empty' <<< "$RDEV_ACTION_STDOUT")
  [[ -n "$label" ]] || label="$project"
  if ! jq -e '.ok == true' >/dev/null <<< "$RDEV_ACTION_STDOUT"; then
    rdev_action_append_item "$project" "$label" failed "Trigger failed" \
      "$(rdev_action_failure_detail "failed to trigger deployment")" "" '[]'
    return 1
  fi
  if jq -e 'any(.data.plan.risks[]?; .severity == "warning")' >/dev/null <<< "$RDEV_ACTION_STDOUT"; then
    item_status=warning
  else
    item_status=success
  fi
  summary=$(jq -r '.data.stateLabel // "Deployment submitted"' <<< "$RDEV_ACTION_STDOUT")
  detail=$(jq -r '.data.detail // empty' <<< "$RDEV_ACTION_STDOUT")
  url=$(jq -r '.data.buildUrl // .data.queueUrl // .data.plan.triggerUrl // empty' <<< "$RDEV_ACTION_STDOUT")
  parameters=$(jq -c '(.data.plan.effective.params // {}) | to_entries | map({key: .key, label: .key, value: (.value | tostring)})' <<< "$RDEV_ACTION_STDOUT")
  rdev_action_append_item "$project" "$label" "$item_status" "$summary" "$detail" "$url" "$parameters"
}

resolve_branch_override_projects

plan_failed=false
for project in "${projects[@]}"; do
  if [[ -n "${capability_errors[$project]:-}" ]]; then
    rdev_action_append_item "$project" "$project" failed "Parameter inspection failed" \
      "${capability_errors[$project]}" "" '[]'
    plan_failed=true
  elif run_build plan "$project"; then
    append_plan_item "$project" || plan_failed=true
  else
    rdev_action_append_item "$project" "$project" failed "Plan failed" \
      "$(rdev_action_failure_detail "failed to run deployment plan")" "" '[]'
    plan_failed=true
  fi
done

if [[ "$plan_failed" == "true" ]]; then
  rdev_action_emit_result "Some plans failed; deployment was not triggered" projects
  exit 1
fi
if [[ "$plan_only" == "true" ]]; then
  rdev_action_emit_result "All deployment plans passed"
  exit 0
fi

: > "$RDEV_ACTION_RESULTS_FILE"
deploy_failed=false
for project in "${projects[@]}"; do
  if [[ "$deploy_failed" == "true" ]]; then
    rdev_action_append_item "$project" "$project" skipped "Skipped after an earlier failure" "" "" '[]'
  elif run_build run "$project"; then
    append_deploy_item "$project" || deploy_failed=true
  else
    rdev_action_append_item "$project" "$project" failed "Trigger failed" \
      "$(rdev_action_failure_detail "failed to trigger deployment")" "" '[]'
    deploy_failed=true
  fi
done

if [[ "$deploy_failed" == "true" ]]; then
  rdev_action_emit_result "Deployment stopped after a trigger failure"
  exit 1
fi
rdev_action_emit_result "All deployment tasks were submitted"
