# Project Startup And The Runtime Panel

rDevTool starts a project through three layers: a project launch profile, a shared runtime profile, and a managed runtime session. The Projects page selects the project and profile. The Runtime Panel resolves the effective startup chain, controls the session, shows logs, and runs controlled web actions.

![Project runtime panel overview](assets/screenshots/project-runtime-panel.png)

Use this guide when starting a project for the first time, switching environments, or investigating a case where the process is running but the page is unavailable.

When a Runtime, Link, or web action is launched from Workspace or Resources, the entry discovers and invokes the capability while Runtime Panel confirms the effective launch profile, runtime, port, logs, and page target. See [Resources And Tool Entries](resource-guide_EN.md) for entry configuration.

## 1. The three configuration layers

| Object | Answers | Typical contents |
| --- | --- | --- |
| Project startup | How does this project start by default? | Project directory, command, default port, and focus URL |
| Launch profile | How does the same project run in another mode? | Local, Pre, UAT, port, environment variables, focus page, and runtime profile |
| Runtime profile | Which shared runtime capabilities are needed? | Browser, browser profile, user data directory, network proxy, local proxy, host rules, and CDP |

The UI calls a launch profile a **Debug Profile** and a shared runtime environment a **Runtime Profile**. They are different on purpose: a Debug Profile says how to start the project, while a Runtime Profile says how the browser and network should be reached after startup.

The final target combines the active workspace, project instance directory, selected launch profile, runtime profile, and one-off startup overrides. The **Runtime Context** in the panel is the source of truth. Chips in the project list are only a quick summary.

## 2. Start from Projects

Open **Project Management > Projects**. Each project row shows environment and profile chips and provides start, stop, open-directory, and more-actions controls.

1. Confirm the active workspace in the lower-left switcher. A requirement workspace may use a managed project copy, so the project name alone is not enough to identify the actual directory.
2. Review the row's working directory, command, environment, and profile chips.
3. Use the play button for a quick start, or choose **More > Choose launch profile** to select the profile explicitly.
4. In the start dialog, choose **Project default startup** or a named profile and review command, working directory, port, and shared environment.
5. Choose a quick-start policy: **Confirm only when necessary**, **Ask every time**, or **Start directly**. Keep confirmation for unfamiliar or consequential projects.
6. Enable **Set as the default profile for this workspace** when later quick starts in this workspace should reuse the selection. This does not change the project's global default.
7. Wait for startup preflight. A blocking check keeps **Start project** disabled until the issue is fixed and the checks are refreshed.

The start dialog surfaces a short list of command, port, proxy, and runtime-profile checks. Open the Runtime Panel when you need the full evidence and effective values.

## 3. Runtime Panel overview

Open **More > Runtime Panel** from a project row. The header shows the project, runtime state, build state, and quick actions. The body is divided into **Overview**, **Runtime Config**, **Logs**, and, when web actions are configured, **Web Actions**.

### 3.1 Startup chain preflight

The **Startup Chain Preflight** section breaks the startup conditions into checks and counts errors, warnings, and healthy items. Checks can include:

- whether the command, working directory, and dependencies resolve;
- whether the expected port is free or owned by another process;
- whether the bound local proxy is listening and matches the selected profile;
- whether the browser, network proxy, Ready probe, and web actions are available;
- whether the workspace-selected launch profile and configuration source still exist.

Refresh the preflight when a proxy, port, or configuration changes. When a check offers a fix, use the guided flow first: start the bound proxy, clear an invalid profile selection, create a reusable launch profile, or choose another port for this run.

### 3.2 Runtime context and state

**Runtime Context** separates three kinds of facts:

- **Requested**: project, launch profile, runtime profile, command override, port override, and environment override requested for this call.
- **Effective**: the merged working directory, command, focus URL, port, Ready probe, and environment after workspace, project, profile, and one-off values are resolved.
- **Observed**: sessions, PIDs, states, and managed artifacts actually seen by rDevTool.

The state area also shows PID, start time, elapsed time, log path, build state, and build output directory. `Running` means a process exists. Ready or HTTP verification is the additional evidence that the access path has completed its configured check.

| State | Meaning | Recommended action |
| --- | --- | --- |
| Unconfigured | Directory or command is missing | Complete project startup configuration |
| Ready to start | The target resolves and preflight allows it | Confirm the profile and start |
| Running | rDevTool manages the session | Read logs or focus the page |
| Running externally | A process owns the port but rDevTool did not create it | Confirm the PID before taking action |
| Cannot start | Preflight found a blocker | Fix the reason and run preflight again |

## 4. Runtime Config: inspect and save profiles

Open **Runtime Config** and start with the configuration-source bar and scope labels. Runtime values may come from global configuration, a workspace override, project configuration, or an inherited source. The source label answers “where did this value come from?” After an external TOML edit, refresh or switch sources before saving so an old draft does not overwrite the new file.

The panel commonly exposes:

- **Runtime profile**: the shared Runtime Profile to use.
- **Browser**: browser type, browser profile, independent user-data directory, and browser arguments.
- **Network proxy**: Node injection, proxy URL, bypass list, and optional Node hook.
- **Local proxy**: the rDevTool proxy profile bound to this project; startup can require the proxy to be started first.
- **Browser debugging**: web-action enablement, controlled CDP port, and web-action user-data directory.
- **Host resolver rules**: fixed host mapping for a test environment, with care for cross-project effects.
- **One-off overrides**: temporary command, port, or environment changes without rewriting an existing profile.

Use a one-off override to test a change such as a different port or `API_REGION`. When the result is reusable, click **Save as launch profile** and name it. This creates project-level configuration available from every workspace. The workspace default remains a separate choice made with **Set as the default profile for this workspace** in the start dialog.

### Choosing Debug Profile vs Runtime Profile

- Add a Debug Profile when the command, mode, port, or project environment changes.
- Reuse or add a Runtime Profile when the browser, proxy, CDP, or network path changes.
- UAT and local modes often need separate Debug Profiles while sharing one browser and proxy Runtime Profile.
- Do not put real tokens in profile environment values, web-action scripts, notes, or records. Inject secrets from private local configuration or the environment.

## 5. Logs

The **Logs** tab switches between `dev` and `build`. Build is disabled when the project has no build log path.

The header shows the log path, session time, PID, auto-refresh state, and current/total line count. It also exposes the working directory or command and, for dev logs, the Ready/HTTP status and URL.

Use the buttons to refresh, clear the selected log, or copy its path. Auto-refresh is useful during startup; pause it when output is large and use bounded CLI filters for triage.

Read logs in this order:

1. Confirm the command ran in the expected directory.
2. Check dependency loading, compilation, and port binding.
3. Check the Ready probe or focus URL.

Clearing a log removes the selected log file only. It does not remove project configuration or records.

## 6. Web Actions

When the project has a focus URL and web actions are enabled, the Runtime Panel exposes **Web Actions**. This is a controlled browser target for repeatable checks and requests, not an unrestricted script runner.

The panel provides:

1. **Controlled chain**: web-action preflight status.
2. **Targets**: pages in the current Chrome debugging session, filterable by title, URL, and type; reopen the current URL or refresh the target list.
3. **Registered actions**: actions loaded from the active configuration source, with type and parameters.
4. **Parameters and run**: choose a target, fill parameters, run the action, and inspect the structured result.
5. **Temporary actions**: create an HTTP request or script draft, or import Chrome `Copy as fetch` text. HTTP requests are validated before execution.
6. **Config and CLI**: open the web-actions config file or copy a CLI command that reproduces the current action.

For a missing target, open the profile's focus URL and refresh the target list. If the list stays empty, check web-action enablement, CDP port ownership, and the browser profile. A successful action means the action completed; validate the business result from its return value, page content, or the next check.

## 7. Actions after startup

- **Focus the running project**: open the configured `focusUrl`. Without one, use logs and configure a URL before expecting a focus button.
- **Stop the project**: stop only the selected rDevTool-managed session. Confirm external ownership before taking action on an occupied port.
- **Restart**: rebuild the session after changing local configuration or proxy rules; resolution and preflight run again.
- **Adopt an external project**: use only when the PID and directory are known to belong to the intended project.
- **Open project directory**: verify the actual workspace copy, lock files, and log location.

Start, stop, restart, adoption, and important web-action operations are recorded in Activity or Record. For a handoff, keep the project, workspace, profile, run ID, and log path instead of sharing only a “running” screenshot.

## 8. CLI equivalent

Use the project key as `<project>` and the Debug Profile key as `<profile>`.

```bash
# List shared runtime profiles
rdevtool runtime profiles

# Resolve requested and effective values
rdevtool runtime inspect --project <project> --debug-profile <profile>

# Check before starting
rdevtool runtime preflight --project <project> --debug-profile <profile>

# Start after preflight and keep the returned runId
rdevtool runtime start --project <project> --debug-profile <profile>

# Inspect the session, wait for HTTP verification, and read logs
rdevtool runtime status --project <project> --run-id <runId>
rdevtool runtime wait --project <project> --run-id <runId> --until http-verified
rdevtool runtime log --project <project> --run-id <runId> --kind dev --tail 160

# Bounded log triage
rdevtool runtime log --project <project> --kind dev --errors-only
rdevtool runtime log --project <project> --kind dev --grep "error" --tail 80

# Focus, diagnose, and stop the selected session
rdevtool runtime focus --project <project> --run-id <runId>
rdevtool runtime diagnose --project <project> --run-id <runId>
rdevtool runtime stop --project <project> --run-id <runId>
```

If you use one-off `--command`, `--runtime-profile`, `--expect-port`, or `--env` overrides, repeat the same overrides for both `preflight` and `start`. The checked target and the started target must be identical.

## 9. Common issues

### Preflight reports an occupied port

Confirm whether the process belongs to this project or another team tool. Do not stop an external process by default. Use the guided fix to choose the suggested port and decide whether to save it as a launch profile. Refresh the context after startup so the focus URL and proxy path use the new port.

### The process is running but the page is unavailable

Check the working directory and command, listening port, Ready/HTTP verification, proxy match, upstream URL, and focus URL in that order. `Started` only means that the process was created.

### The local proxy is not running

Use the preflight fix to start the proxy, or open **Local Proxy** and verify profile, listener, and rules. A bound proxy does not prove that a rule matched; inspect requests or run a real verification.

### A launch profile is invalid

Choose a valid profile in Runtime Config. For a stale workspace selection, use the quick fix to restore the project default, then choose a new workspace default after verifying it.

### Web Actions has no target

Open the profile's focus URL and refresh targets. Then check Runtime Profile web-action enablement, CDP port ownership, and the selected browser profile.

### Can runtime logs be committed to a repository?

Do not commit them directly. Logs can contain local paths, environment values, request parameters, and business data. Share a redacted Record summary, error type, and reproduction steps instead.
