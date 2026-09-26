# Running And Activity: Live State, Records, And Recovery

## What this area is for

The top-right **Running & Activity** control is rDevTool's cross-page runtime entry point. It brings project services, local builds, parameterized Actions, local proxies, controlled browsers, Link flows, Git/deployment outcomes, and configuration changes into one side panel so you can answer two questions:

1. **What is running now?** For example, which project owns a port, which proxy is listening, or which Action is still executing.
2. **What just happened?** For example, whether a build has reached a terminal state, which project failed in a batch Git task, or whether an external configuration change needs a reload.

The activity center is a local workbench view for observation and follow-up. It does not replace Jenkins, GitLab, browser DevTools, or the operating-system process list. For remote builds, deployments, merges, and pushes, verify the final state in the target system or through the result link.

![Running and Activity side panel](assets/screenshots/activity-center-pagination-preview.jpeg)

The screenshot shows activity filters, failed/running states, related-entry actions, and pagination. Counts and record contents vary with the active Workspace and local runtime state.

## Open It And Understand Scope

Click the activity icon in the top-right window toolbar. When live resources exist, it shows a live indicator. Click the icon again or use the collapse button to close the panel.

Activity is recalculated for the active workspace:

- In a requirement workspace, ordinary project records are limited to projects in that workspace; configuration changes and Link records remain useful in the current context.
- In the `system` global view, the panel can show activity for all projects.
- Switching workspaces does not delete history. It changes what is visible. Before running a task, confirm the Workspace switcher and the activity panel refer to the same scope.

## The Two Main Views

### Running

**Running** shows resources currently observed as active, grouped into:

- **Current workspace**: project services, builds, or Actions attached to the active requirement.
- **Other workspaces**: local project services or builds that are still running outside the active requirement.
- **Shared services**: proxy profiles, controlled browsers, and other resources not owned by one project.

The summary reports running resources, active ports, port conflicts, external processes, and the latest observation time. If no new observation arrives for roughly 45 seconds, the panel warns that the state may be stale. Refresh Running to read the local state again. Opening the view refreshes it, and the open panel continues periodic refreshes.

Depending on ownership and state, a row can provide:

| Button | Purpose | Guidance |
| --- | --- | --- |
| Adopt | Bring an identifiable external project process under rDevTool management | Confirm its directory, port, and command first |
| Focus | Focus the project page or launched application | Focus does not prove that the service is healthy |
| Open log | Open the project or build log | Read the log after an exit before restarting |
| Open output | Open a local build or package output directory | Confirm the output belongs to this run |
| Open project directory | Open the effective project directory | A workspace copy and repository path can differ; use the displayed path |
| Details / deep diagnosis | Inspect runtime context or check port ownership | Use deep diagnosis for port anomalies |
| Stop | Stop a resource whose ownership is verified by rDevTool | Confirmation is required; handle external processes in their owning tool |

Resource kinds include **project service**, **local build**, **parameterized Action**, **local proxy**, and **controlled browser**. A running Action also shows its phase and last output line. When secret parameters are involved, live output can be hidden and only the redacted final result is shown.

#### Port conflicts and external ownership

The same port is not automatically a conflict. Listen address, PID, and project directory also matter. The panel distinguishes:

- **Port conflict**: two observable resources may listen on the same port; compare their projects, addresses, and processes.
- **External process**: a process outside rDevTool management owns the port; do not force-stop it immediately.
- **Port unavailable to verify**: a project reports Running but no parseable port is available; inspect Runtime Panel and logs.

Deep diagnosis shows the port, inspection time, listener process, PID, command, working directory, and whether the expected PID or directory matches. Stop only after ownership is clear.

### Activity Records

**Activity Records** keep recent cross-page outcomes. The toolbar provides:

- Mark all failed as handled: acknowledges failed records without deleting them.
- Refresh activity state: re-reads Jenkins state for running builds or build status-sync failures.
- Clear handled records: requires confirmation; removes successful, informational, and acknowledged-failure records while keeping actionable and running items.
- Collapse: closes the panel without changing live resources.

The activity view has two filter rows:

| Filter | Contents |
| --- | --- |
| All | All activity records in the current scope, including running, failed, and ordinary history |
| Success | Terminal successful records |
| Failed | Explicit failures; build status-sync notices are handled separately |
| All origins / App / CLI / Tray | Filter by where the activity was created |

The current activity center has no standalone keyword search and no favorites filter. For an exact project or resource lookup, open the relevant Record from Projects, Build, Git, Resources, or Proxy, then use the activity card's resource, locate, or diagnosis button to return to context.

The list is sorted by latest update and shows at most five display units per page. Repeated builds are collapsed into an execution group with an execution count. Link and workflow steps with a `chainId` are collapsed into one chain. The footer shows the current range and pagination; it is not the size of the complete database history.

## How To Read A Card

Read a card from top to bottom instead of relying on color alone:

1. **Title and time**: identify the operation and its latest update.
2. **Kind and origin**: for example runtime, build, Git workflow, local proxy, Link, or configuration, plus App/CLI/Tray.
3. **Outer status**: Running, Success, Failed, or Info; records with actions expose their action buttons directly.
4. **Project and summary**: confirm the project, operation summary, build number, or remote queue information.
5. **Parameter summary**: expand the card to distinguish effective values from defaults; secrets are configured or redacted, never exposed.
6. **Actions**: open a resource, locate the workspace, inspect diagnostics, retry, or mark the entry handled.

### Three display units

- **Ordinary activity**: one runtime, resource open, proxy action, or configuration change with its summary and detail.
- **Execution group**: repeated build/deploy activity for the same project and execution identity. The collapsed view shows the latest result and success/failure counts; the expanded view shows the latest three executions and can reveal the rest.
- **Chain group**: the stages of one Link, workflow, or multi-step task. Expand it to see checks, starts, waits, stops, and final results in creation order.

Expanded timelines mark failure reasons. Build entries can retain a Jenkins queue URL or build URL. A URL is an evidence link, not proof that rDevTool observed the remote terminal success.

## Guarded Retry

A retry button appears only when the record carries an explicit recovery action. The confirmation dialog revalidates current configuration:

- Git retry checks workspace, project, source/target branches, and permission context again.
- Build retry creates a new plan and checks project, target, branch, environment, and overrides.
- Runtime retry rechecks project, launch profile, port, and managed-process ownership; stop recovery verifies process ownership again.
- Proxy retry re-reads the profile, port, and listener ownership instead of forcing a historical state.
- Link retry runs a read-only check first and only then starts or stops the Link.

Do not retry an ambiguous remote POST. First open the remote task, Jenkins, GitLab, or business-system page and confirm whether a task was already created.

## Status And The Boundary Of “Done”

| UI status | Meaning | Next step |
| --- | --- | --- |
| Running | A local process, Action, or remote build is still being handled | Use Running for resources/logs/ports; wait for remote status sync |
| Success | The local operation or remote request returned success | Open the result link when the remote terminal state matters |
| Failed | A concrete failure was received | Read the reason, diagnostics, and project row before replanning |
| Info | An informational event or an old running state that can no longer be confirmed | Keep it as context, not as current runtime state |
| Actionable | A record exposes a follow-up action | Inspect the evidence, then run the action or mark the failure handled |
| Handled | The failure reminder was acknowledged | The record remains until it is cleared |

The activity center follows four evidence layers:

1. `executed`: the local or remote operation was accepted.
2. `persisted`: a local operation/history record contains the identity.
3. `activityVisible`: the activity center synchronized that record.
4. `verified`: the expected terminal state was observed, such as a successful Jenkins build, a process listening on the expected port, or a remote commit existing.

An idle button, a build URL, or a Success label alone does not prove layer four. For release, push, deploy, merge, and external services, retain the result URL, build number, commit, run ID, or log path.

## Activity Versus Page Records

The activity center answers “what happened recently across modules.” A page Record answers “what were the complete parameters and per-project results for this one Build, Git, or Action?”

- **Runtime Panel**: launch profile, preflight, runtime config, live logs, and web actions; Activity shows cross-project live resources and the startup outcome.
- **Build**: build target, default/effective parameters, and repeated build history; Activity shows unified module state and Jenkins synchronization.
- **Git**: merge, branch creation, commit/push, and worktree results per project; Activity provides failure details and guarded replay.
- **Local Proxy**: services, rules, and request details; Activity shows whether the proxy runs, request/error counts, and the latest request.
- **Resources/Link**: exact steps and parameters; Activity shows whether a Link is in check, start, wait, or stop.

## Common Investigation Flows

### The page ended but a service still owns the port

1. Open **Running** and see whether the service belongs to the current workspace, another workspace, or shared services.
2. Review the port, PID, working directory, and runtime status.
3. Use **deep diagnosis** to compare the listener with the expected PID or directory.
4. Stop only verified resources; handle external ownership in the owning tool or terminal.
5. Return to Runtime Panel, read the log, and keep the run ID and path from the activity record.

### A Jenkins build remains Running

1. Expand the card and identify whether it contains a queue URL or build URL.
2. Wait for automatic status synchronization, then use Refresh activity state if needed.
3. If status sync fails, check the Jenkins URL, authentication state, network, and response content. After repeated failures reach the limit, handle it manually.
4. Open the Jenkins queue/build page to confirm the real state. Do not trigger another build merely because the UI has not refreshed.

### A batch Git or Action partially failed

1. Open Activity Records, switch to Failed, and identify the failure group and project count.
2. Expand the execution or chain group and read every project's branch, parameters, HTTP status, and diagnostics.
3. Do not retry successful projects. Use Check and retry only for failures with an explicit recovery action.
4. Fix 403 permissions, conflicts, protected branches, or worktree blockers before creating a new plan.
5. Mark the failure handled after the investigation, but keep the record until the review is complete.

## Local Data, Cleanup, And Safety

Activity is stored in local application storage. The current UI retains up to 60 normalized recent entries and prioritizes actionable items. At startup, rDevTool reconciles local activity storage with build/merge history and operation-event history; duplicate events are deduplicated, and old unconfirmed running entries are downgraded to informational records.

Cleanup only affects clearable records in the visible scope. Running and actionable entries remain. Before cleanup, record a redacted summary in Knowledge or the worklog: project key, workspace, operation kind, time, plan/run ID, result URL, commit, error type, and next step. Never put tokens, passwords, cookies, Authorization headers, private keys, or full business responses into activity summaries, shared logs, or screenshots.

## CLI Counterpart

The activity center is a UI summary. Durable operation/history is the better machine-readable evidence when a script or AI Agent needs to verify the result:

```bash
rdevtool --json history operations --limit 24
rdevtool --json history operations --domain build --project <project> --limit 12
rdevtool --json history operations show <operation-id>
rdevtool --json history build --latest --project <project> --env <env>
rdevtool --json history replay-plan build:<history-key>
```

`history replay-plan` only creates a new read-only plan. Move to `history replay-run` only after checking the `planHash`, target, parameters, and risks. The retry buttons in the activity center follow the same check, confirmation, and execution order.

## Quick Lookup

| What you see | Where to look first |
| --- | --- |
| A failed activity | Activity > Failed; read the reason and recovery action |
| A live indicator | Running > Current, Other, or Shared |
| A build URL with unknown state | Open the Jenkins queue/build page; Activity only synchronizes it |
| A port occupied warning | Running > Deep diagnosis; verify PID and directory ownership |
| An external configuration change | Activity > All; open the record's Reload or Compare action |
| Too many records | Filter by origin/result, then clear handled records after review |
