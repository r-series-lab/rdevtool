# Workspaces And The Workbench

The Workspace page is rDevTool's daily starting point. It brings the projects, resources, tools, local proxies, workflows, build/Git actions, and runtime state for one scope into view, so you can confirm what you are working on before starting a service, debugging locally, or running a task.

This guide focuses on the Workspace page and Workspace Configuration. Use the main guide for a page-by-page reference; use [Project Startup And The Runtime Panel](project-runtime_EN.md) for launch profiles, preflight, runtime configuration, logs, and web actions.

## Understand Workspace Scope

A workspace controls what the current page can see and operate on. It does not create a second project configuration or change Git state by itself. It organizes projects, entry points, proxies, and actions into a switchable context.

| Scope | What it shows | Best use |
| --- | --- | --- |
| `system` global workspace | All projects, shared entries, and proxies; read-only in configuration | First-time setup, cross-project search, global checks |
| Regular workspace | Referenced projects, entries, proxies, and actions | One requirement, debugging chain, or related project group |
| Requirement workspace | A regular workspace with requirement folders, branches, and optional project copies | An isolated, repeatable requirement environment |

The lower-left workspace switcher, the Workspace home cards, and Workspace Configuration use the same data. After switching, Projects, Resources, Build, Git, Proxy, and Activity reload for the new scope. Check the workspace name shown by the page before executing anything; do not infer scope from a project name alone.

## The Workspace Home

![The Workspace home showing resources, tools, projects, and runtime state](assets/screenshots/workspace-overview.png)

### Page layout

The workbench has four layers:

1. **Metric toolbar**: project, resource, proxy, and Action counts for the current scope, plus **Workspace Configuration**. Counts are a scope check, not a promise that every project is running.
2. **Global search and type filter**: visible in `system`, this searches workspaces, projects, entries, proxies, and actions, and filters workspaces by type. Search matches names, keys, paths, states, ports, and action parameters.
3. **Active workspace card**: the title shows the workspace name, type, and state chips. The summary shows entry, project, proxy, and action counts; the body is split into modules.
4. **Workspace index**: visible in `system`, it lists other workspaces with their type and project/entry counts so you can enter one quickly.

### Modules in a workspace card

Modules appear only when the current workspace has relevant data.

| Module | Contents | Typical actions |
| --- | --- | --- |
| **Entries** | Websites, directories, files, apps, and scripts | Open the target and review its source |
| **Tools** | Link, Action, Workflow, web-action, and Runtime tools | Preview, run, start, or stop a debugging flow |
| **Projects** | Project folders, instances, and runtime state | Open, start/stop, focus the running page, or run preflight |
| **Local Proxy** | Bound profiles, listen URLs, rule counts, and status | Start/stop a profile or open proxy configuration and requests |
| **Workflow** | Saved multi-step Action chains | Inspect steps, enable/disable, run, or cancel |
| **Build / Git / Other actions** | Pinned batch actions for the workspace | Open parameter confirmation, plan, and Record |

Plain resources usually open directly. Tools enter a plan, confirmation, or runtime flow depending on type. Remote writes, builds, merges, and pushes still follow the plan, confirmation, and Record contract.

### Card controls

- **Module layout** expands or collapses every module in the card. Each module can also be collapsed from its own header; the local UI remembers the state.
- **Extract AI context** creates a structured summary of the workspace, including project, entry, proxy, action, and state counts. It is context export only; it does not run a project or change configuration.
- **Expand/collapse workspace** hides the card body so the global view can be scanned quickly.
- **More actions in the workspace index** extracts context or opens that workspace's configuration.

### Starting a runtime from a project row

Project rows show the project name, instance mode, directory, launch profile, and runtime state together:

- **Global** uses the system project directory.
- **Bound** references an existing checkout that rDevTool does not own.
- **Copy/managed** uses a worktree or clone whose path and lifecycle are managed by the workspace.
- **Running** exposes focus and stop actions.
- **Needs preflight/configuration** means the command, folder, port, proxy, or dependency still needs attention. Review the runtime source and preflight instead of repeatedly clicking Start.

Start uses the effective launch profile for the current workspace. Inline checks identify folder, port, proxy, or dependency blockers. Open the project's more-actions menu for the full Runtime Panel with overview, runtime configuration, logs, and web actions.

## Create And Switch Workspaces

### Switch from the workspace control

1. Open the current Workspace switcher in the lower-left corner.
2. Choose `system` or a regular/requirement workspace.
3. Confirm the title, metrics, and project scope changed on the Workspace page.
4. Then open Projects, Build, Git, or Resources and run the task.

Use `system` to search across projects and entries. Use the requirement workspace before executing work for one task.

### Create a regular workspace

Open **Workspace Configuration**, then select **New Workspace**. The regular mode includes:

- **Name / key**: the name is for display; the key is a stable reference for CLI, configuration, and automation. Do not casually change a key used by scripts.
- **Notes / type**: notes explain purpose; type supports filtering in the global workspace index. Built-in and custom types are supported.
- **Independent directory**: enable it when the workspace needs its own root folder. Otherwise the workspace can remain a scope-only configuration.
- **Resource directory**: stores workspace material and generated entries; by default it is under the workspace `resources` directory.
- **Copy current configuration**: starts the new draft from the current project, entry, and proxy scope. Still review paths and scope before saving.
- **Initialize worklog / auto-record key operations**: creates `WORKLOG.md` and decides whether qualifying operations are recorded.

Select **Create**. The new workspace appears in the active list; projects, entries, and proxies that were not selected are not added implicitly.

### Initialize a requirement workspace

Switch the creation form to **Requirement** mode. In addition to name, key, type, and notes, it asks for:

- **Requirement ID**, optional, to associate the workspace with an external work item.
- **Branch**, used when an independent directory is created.
- **Requirement directory**, the material or task directory that must exist before initialization.
- **Project directory**, the source checkout used to identify the project.
- **Project key**, optional when directory matching cannot identify the project.
- **Independent directory**, which creates a worktree/clone instance; dependencies may be reused when lockfiles match.

The button becomes **Initialize**. Before initializing, inspect the project, effective folder, branch, copy mode, and risk preview. When in doubt, use the CLI `--dry-run` flow first.

## Workspace Configuration

### The left workspace list

The dialog separates **Active** and **Archived** workspaces:

- Selecting an active workspace loads its editable draft on the right.
- The global `system` workspace is view-only and cannot be saved as a narrowed scope.
- A regular workspace can be archived; archiving changes its lifecycle state and is not the same as deleting a project folder or worklog.
- An archived workspace can be restored. Permanent deletion removes the workspace configuration; inspect a cleanup plan first when managed instances or folders are involved.

The number on a left-side item is a fixed entry/action hint, not the total project count. Use the right-side metrics for project, entry, proxy, workspace-owned resource, and instance counts.

### Identity and directories

The detail area starts with name, type, and notes, followed by:

- **Workspace directory**, the root for requirement copies, material, and logs.
- **Resource directory**, where workspace-owned material and generated entries live.
- **Work log file**, usually `WORKLOG.md`.
- **Auto-record key operations**, which records qualifying terminal and key operations for the workspace.

The global workspace shows an information alert: it always contains every project, entry, and proxy. Use a new regular workspace to narrow scope; do not try to delete global items from the read-only panel.

### Project instances and directory associations

The project section shows each selected project and its directory association. Common actions are:

- **Create Copy**: create a managed worktree or clone under the workspace directory.
- **Bind Directory**: select an existing checkout that remains user-managed.
- **Open Directory**: inspect the effective folder directly.
- **Repair Copy**: re-check or repair a missing or unhealthy managed instance.
- **Remove Association**: detach the workspace from that directory; review cleanup before touching managed copies.

The instance view exposes ownership, health, branch, and effective path. `configuredRepoPath` is configuration provenance; `effectiveRepoPath` is the path used for file operations and runtime.

### Scope selection

The lower panes manage **Projects**, **Entries**, and **Proxies**:

- **All** makes the workspace follow newly added projects, entries, or proxies from global configuration.
- Clear **All** to select a precise subset.
- Entries can be selected by category and then by individual item; workspace-owned resources do not need to be selected again.
- Proxies appear with profile and listen address and only show in the workspace card when selected.

Changing scope changes visibility and operation targets for this workspace. It does not delete the original project, entry, or proxy in its shared configuration source.

## Workspace-Owned Resources

![Workspace-owned resource editor](assets/screenshots/workspace-resource-editor.png)

Workspace-owned resources belong only to the current regular workspace. After saving, they appear in the Workspace home **Entries** and **Tools** modules. Use them for requirement material, debugging URLs, one-off scripts, and tools meaningful only to this task.

### Add categories and entries

1. Select **Add Category** in **Workspace Resources**.
2. Edit the category name and short label. Keep the short label compact for cards and lists.
3. Select **Add Resource** in the category and choose a type.
4. Fill in the URL, directory/file path, app name/Bundle ID, script path/working directory, or tool type/key/action/working directory.
5. Save the workspace and confirm the entry or tool count on the home page.

Supported types:

| Type | Typical fields | Home-page behavior |
| --- | --- | --- |
| Website | URL, browser, Browser Profile | Open in the current browser or selected Profile |
| Directory / file | Path | Open with the system default application |
| App | App name, Bundle ID | Launch the local app |
| Script | Script path, working directory | Run the configured local script |
| Tool | Tool type, Tool Key, action, working directory | Enter a Link, Action, Workflow, web-action, or Runtime flow |

Each editable entry provides **Edit**, **Duplicate**, and **Delete**. Duplicating creates a new name and opens the editor. Deleting removes only this workspace-owned entry; it does not delete a referenced Action, Link, or project.

`Resource Directory` and `Work Log` are generated entries. They carry a **Generated** marker and are controlled by the resource-directory and worklog fields above, so they cannot be removed as ordinary entries.

### Workspace-owned versus shared entries

- Workspace-owned entries are stored in this workspace, apply only here, and can be created, edited, duplicated, or deleted in this editor.
- Shared entries come from a resource configuration source and are included through the **Entries** scope. Clearing them removes them from this workspace without deleting the source definition.
- If identical names appear on the home page, compare the category, path, and source label before deciding whether they are the same entry.

## Recommended Workflow

### Start a requirement

1. In `system`, search for the project and existing resources. Confirm names, paths, and configuration sources.
2. Create or enter the requirement workspace. Confirm project scope, independent directory, and branch.
3. Bind or create project instances and verify `effectiveRepoPath`.
4. Add requirement material, debugging URLs, proxies, and tools as workspace-owned resources.
5. Return to the home page, review project and proxy state and recent activity, then start the Runtime or Link.

### Run Build, Git, or an Action

1. Open Build, Git, or the Action from the active workspace card.
2. Review fixed workspace, project, branch, environment, and parameters.
3. Generate a plan or run preflight. Resolve blockers per project.
4. Execute after confirmation, then verify the real outcome in Record, the build link, or the external system.

### Finish a requirement

1. Stop runtimes and proxies that are no longer needed.
2. Record verified launch commands, proxy rules, and troubleshooting conclusions in Knowledge or the worklog.
3. Archive a workspace that should be kept but not used daily; do not permanently delete it first.
4. For another machine, use configuration import/export and review local path mappings in the import plan.

## CLI Reference

The UI is best for scope review and guarded operations; the CLI is useful for scripts, audits, and batch checks.

```bash
# Inspect workspace inventory and full scope
rdevtool workspace list --compact
rdevtool workspace show <workspace-key>

# Preview requirement initialization
rdevtool workspace init-demand ... --dry-run

# Scope one command without changing the active app workspace
rdevtool --workspace <workspace-key> <command> ...

# Add an entry owned by one workspace
rdevtool navigation add --workspace <workspace-key> ...

# Inspect configuration sources without editing files directly
rdevtool config-source list
rdevtool config-source show <source-id>
rdevtool config-source compare <source-id> ...
```

Requirement `--copy-mode` values are `existing`, `worktree`, and `clone`: the first binds an existing checkout, while the latter two create workspace-owned instances. In a `--dry-run`, check the project, remote identity, effective instance folder, ownership, and risk summary.

## Common Questions

### Why cannot the global workspace be narrowed?

`system` is the global view and always includes every project, entry, and proxy. Create or select a regular workspace to narrow the working scope.

### Why is a new entry missing from the home page?

Select **Save** in the configuration dialog, then check whether the entry was saved to this workspace or to a shared source. Refresh the home page; tools appear in Tools rather than the plain Entries module.

### Create a copy or bind a directory?

Create a copy when the workspace should isolate the branch and manage the instance lifecycle. Bind a directory when an existing checkout should remain user-managed. In both cases verify the effective path and branch.

### Why does the displayed project path differ from my folder?

The workspace may use a managed copy or a bound directory. Use the effective instance path for runtime and file operations; the configured source path is provenance, not always the active checkout.

### Can a workspace-owned resource be shared?

Create a shared entry in the resource configuration source, then select it in each workspace's Entries scope. Do not duplicate the same owned entry across workspaces unless the values really need to diverge.

### Does archiving delete material or project copies?

Archiving changes the workspace lifecycle state first. Review a read-only cleanup plan for managed copies, material, and worklogs before removing anything.

## Final Check

Before starting from the Workbench, confirm:

- The workspace name and type are correct.
- Project instance effective folders and branches are correct.
- Required entries, proxies, and tools are in scope.
- No runtime, proxy, or workflow is left running unexpectedly.
- The plan, logs, and Record can explain the real outcome.
