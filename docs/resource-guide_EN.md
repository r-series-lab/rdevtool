# Resources And Tool Entries

rDevTool's **Resources** page is the unified place to “find and open a target quickly, or start a controlled workflow”. An entry may point to a website, folder, file, application, or script, or reference an Action, Link, Workflow, web action, or project runtime capability.

This guide explains:

1. How to search and open entries.
2. How to configure websites, folders, files, applications, and scripts.
3. How Link, Action, Workflow, web-action, and Runtime tool entries differ.
4. How resource entries connect to the project Runtime Panel, launch profiles, and proxies.
5. What to check when an entry is incomplete or a tool cannot run.

![Resources page showing tools, Actions, and Links](assets/screenshots/resources-actions.png)

## 1. The resource-entry model

An entry contains these pieces:

| Information | Purpose | Example |
| --- | --- | --- |
| Configuration source | Decides where the entry is loaded from and saved | Default, workspace, or team config |
| Category | Groups entries by project, materials, automation, or external system | Project links, design materials, debug links |
| Name | The human-facing label | Test environment, requirements folder, start project |
| Type | Decides the default open behavior | Website, folder, file, application, script, tool |
| Target | The actual URL, path, Bundle ID, script, or tool key | `https://...`, `/Users/...`, `workspace-start-check` |
| Action | The operation used when a tool entry is selected | Plan, run, inspect, start |
| Notes | Explains purpose and boundaries | Debug entry, read-only material, proxy required |

An entry stores how to find a target. Its referenced definition remains owned by the corresponding module:

- An Action's parameter schema and executor come from `actions.toml` in the active configuration source.
- Web-action scripts, controlled pages, and debugging settings are maintained in the project's **Web Actions** panel.
- Runtime points to project startup capabilities; commands, launch profiles, and runtime profiles are maintained by project configuration and the Runtime Panel.
- Link steps are maintained by the Link configuration or Link wizard. The resource entry only references the Link key and its default plan action.

Deleting an entry therefore normally removes only the shortcut. It does not delete the referenced Action, Link, web action, or project.

## 2. Open the Resources page

Open **Resources** from the left navigation. The page normally contains:

1. **Configuration source context**: the source being read and its file path or link status.
2. **Search**: searches entry names, types, URLs, paths, notes, scripts, tool keys, and actions.
3. **Type filters**: `All`, `Website`, `Folder`, `File`, and `Tool`.
4. **Category tabs**: browse entries inside a category with its count.
5. **Entry cards**: show name, type, category, notes, target summary, and open/run controls.
6. **Configuration access**: open **Resource Configuration** to add, edit, copy, or delete entries.

Search also matches category names, target summaries, runtime profiles, scripts, tool keys, and tool actions. With no search text the page prefers the selected category; with search text it searches across categories.

Press `Enter` to open or run the first match. For side-effecting tools, do not treat “first match” as confirmation. Review the effective target in the Action, Link, or Runtime Panel before execution.

### 2.1 What the controls mean

| Control or state | Meaning |
| --- | --- |
| External-open icon | Open a website, folder, file, or application target |
| Play/run | Start a script, Link, Runtime, or web action |
| Lightning/parameters | Open the parameterized Action form and confirmation flow |
| Plan | Read a Link or action configuration without running its side effects |
| `Ready` | Required fields are present and the entry can continue |
| `Needs attention` | A URL, path, Bundle ID, script, or tool key is missing or invalid |
| Source state | The configuration is readable, read-only, missing a capability, or changed externally |

Websites, folders, files, and applications usually open directly. Scripts and tools may start processes, access pages, control a proxy, or manage a project runtime, so review their action and confirmation surface first.

## 3. Configure resource entries

Open **Resource Configuration** from the Resources page. The left side lists entries; the right side edits the selected entry.

### 3.1 Choose a configuration source

The **Configuration Source** at the top decides which resource file is read and saved. Before switching:

1. Save the current draft, or close the dialog and discard it.
2. Confirm the source name, file path, and supported capabilities.
3. Wait for entries, Actions, web actions, and projects to reload.
4. If the source is read-only or does not support resource links, it may still be viewable but cannot be saved directly.

The displayed source is the source of truth. If an entry exists on disk but not in the page, first check whether a different configuration file is selected.

### 3.2 Add and edit

The normal flow is:

1. Select a category, or use **Add Category** to create one.
2. Click **New** and choose an entry type.
3. Fill in the name, target, and notes. A tool also needs a tool type, key, and action.
4. Review readiness warnings and the target summary.
5. Click **Save** and wait for “Resource entry configuration saved”.
6. Return to Resources and confirm the category count and entry card have refreshed.

Edits are draft changes until the dialog is saved. After saving a Link definition in the Link wizard, save the resource entry again so the reference is persisted.

### 3.3 Copy and delete

- Use **Copy** for a similar environment, then immediately change the name, URL, path, or key so two entries do not look like different targets while pointing to the same place.
- **Delete** removes the entry record from the current configuration. It does not delete a folder, project, script file, Action, Link, or web-action definition.
- System-generated workspace entries, such as the resources directory and work log, should be maintained through Workspace Configuration rather than deleted as ordinary entries.

## 4. Website entries

Website entries open environment URLs, design files, API pages, project documentation, test pages, or external systems.

### 4.1 Fields

| Field | Explanation |
| --- | --- |
| Name | Human-facing label, preferably including environment or purpose |
| Type | Choose `Website` |
| Category | Keeps related entries together |
| URL | Complete URL, including the protocol and any stable query parameters |
| Runtime Profile | Optional shared runtime profile for a fixed browser, proxy, Host rules, or CDP setup |
| Browser | Current Chrome, system default, Google Chrome, Microsoft Edge, Brave Browser, or a custom app |
| Profile | Browser profile such as `Default` or `Profile 2` |
| Notes | Purpose, prerequisites, and read-only/write boundary |

### 4.2 Choosing a browser

- **Current Chrome** reuses the current Chrome session and is useful when the page depends on an existing login state.
- **System default** lets the operating system handle the URL without a browser Profile.
- **A named browser** fixes the target to Chrome, Edge, or Brave.
- **Profile** is used when the selected browser supports browser profiles. Do not copy browser data directories into notes or repositories.
- **Runtime Profile** is not the same as a browser Profile. It can also provide proxy settings, Host rules, CDP, and web-action support.

For a simple URL, leave Runtime Profile empty. Associate one only when the page depends on a specific network, proxy, browser debugging, or web-action path.

### 4.3 Website safety

- Do not put tokens, cookies, Authorization values, or temporary signatures in a shared URL.
- Use the current browser session or private local configuration for authenticated pages.
- A successful open only means the browser accepted the URL; it does not prove that the page's business or permission check succeeded.
- Use Web Actions or the Runtime Panel for repeatable clicks, submissions, or page checks instead of encoding complex behavior in a URL.

## 5. Folders, files, and applications

### 5.1 Folder entries

Folder entries are useful for requirements, design files, project repositories, build artifacts, logs, and local tool directories.

Fill in **Folder Path** and use the folder picker to validate it. Prefer stable absolute paths, name the entry for its purpose, and state whether it is a project, materials, or artifact directory.

A folder entry opens the directory in the file manager. It does not register the directory as a project or change a workspace's managed project instance.

### 5.2 File entries

File entries open a work log, requirements document, configuration sample, build report, or fixed template. Fill in **File Path** and let the system open it with the default application.

Use a folder when the user needs to browse a collection and a file when one document is the target. A runnable script should use Script type so its working directory and execution behavior are explicit.

### 5.3 Application entries

Application entries locate a local application through its Bundle ID and name. They are useful for Finder, browsers, terminals, or team tools. They only launch or focus the application; use a Script or Action when the application needs structured parameters.

## 6. Script entries

A Script entry opens or starts an existing local script. Confirm at least:

- **Script Path** points to a readable file on this machine.
- **Working Directory** contains the relative paths and dependencies used by the script.
- Arguments, environment variables, and exit-code conventions are documented by the script or its Action definition.

Simple personal scripts can remain Script entries. When a script needs project selection, branches, environments, plans, logs, cancellation, or structured results, wrap it as an Action so users can see its scope and review the result in Record.

A script does not automatically receive the active workspace or project context. When that context matters, prefer the controlled Action, Runtime, or Link capability instead of relying on an implicit terminal directory.

## 7. Tool entry types

When the type is **Tool**, the editor asks for a tool type, reference key, and action. The built-in types are:

| Tool type | Use it for | Common actions | Definition maintained in |
| --- | --- | --- | --- |
| `Link` | Chain preparation, proxy, project startup, page opening, and checks | View plan | Link config / Link wizard |
| `Parameterized Action` | Generate a schema form and run a controlled task | Run, inspect | `actions.toml` in the active source |
| `Workflow` | Point to automation, replay, or rule definitions | View plan, open | The corresponding workflow, replay, or rule config |
| `Web Action entry` | Reference a web action already defined in Runtime Panel | Open, run, inspect | Project Runtime Panel Web Actions |
| `Runtime` | Point to project start, focus, inspect, or stop capability | Inspect, start, focus, stop | Project configuration and launch profiles |

The Tool Key is a reference, not the display name. A missing key may be retained in configuration, but the page will show a warning or incomplete state and execution should not be assumed to work.

### 7.1 Link: a debugging chain

A Link can describe a repeatable debugging chain:

1. Check project directory and dependencies.
2. Start or inspect a local proxy.
3. Start a project with a selected launch profile.
4. Open a target page or current browser page.
5. Run Ready, HTTP, or web-action checks.

The default action for a Link resource is **View Plan**. Use the Link wizard to confirm step order, project, proxy, and runtime. After saving the Link definition, save the resource entry again so it references the new key.

Viewing a plan only resolves steps. It does not prove that a project started, a proxy is listening, or a web action ran.

### 7.2 Parameterized Action: a schema-driven task

Actions are suited to batch builds, deployments, branch operations, environment checks, and local tasks with explicit parameters. The entry loads the Action from the active source and creates the form from its schema.

Use it as follows:

1. Choose **Parameterized Action**.
2. Select an existing Action Key and check its name and parameter count.
3. Run **Inspect configuration** or open the Action plan to review workspace, projects, branches, environment, and write scope.
4. Select **Run Action** only after the current parameters are confirmed.
5. Review runtime logs, result links, and Record after execution.

Fixed context may not be overrideable from the entry. If the shared Action needs a different behavior, change its definition or create another key instead of silently treating the shared entry as a personal script.

### 7.3 Workflow: an automation reference

Workflow entries store a workflow, replay, or rule identifier so an existing automation can be found quickly from a workspace. The first resource-entry phase supports **View Plan** and **Open Configuration** as discovery and preview operations rather than turning an unconfirmed workflow into a direct execution button.

When the workflow can trigger a build, push, deployment, or page write, confirm the actual target and authorization in the owning module before continuing.

### 7.4 Web Action entry

A Web Action entry references an existing web action. It does not maintain the script or controlled page inside Resource Configuration.

- **Open target** locates the action configuration or target page.
- **Inspect configuration** shows its kind, parameters, and controlled path.
- **Run action** executes automation in the current controlled browser target; confirm the target page and parameters first.

If no web actions are available, create or inspect one under **Project Runtime Panel > Web Actions**. Runtime Panel owns page targets, CDP, browser Profile, parameters, and results; Resources only places the action in the current workspace.

### 7.5 Runtime: a project runtime entry

A Runtime entry references a project key and supports:

- **Inspect configuration**: review command, launch profile, runtime profile, and preflight.
- **Start project**: start the project with the project configuration and optional Runtime Profile.
- **Focus page**: focus the running project's page or `focusUrl`.
- **Stop project**: stop a session managed by rDevTool. Confirm ownership before handling an external listener.

Runtime entries are useful on a requirement workspace home, while complete startup parameters, preflight, logs, and web actions belong in **Project Management > Projects > Runtime Panel**.

## 8. Resources and the Runtime Panel

The two surfaces answer different questions:

| Surface | Main question | Suitable entries |
| --- | --- | --- |
| Resources | “Which page, folder, or workflow do I need?” | Websites, folders, files, apps, scripts, tools |
| Projects | “Which project should I operate?” | Start, stop, open directory, choose profile |
| Runtime Panel | “What actually took effect, and where did it fail?” | Overview, Runtime Config, Logs, Web Actions |

A typical flow is:

1. Select a Runtime, website, or Link from the workspace or Resources.
2. For Runtime, confirm the referenced project and managed workspace directory.
3. Open the project Runtime Panel and read **Overview** and Startup Chain Preflight.
4. In **Runtime Config**, review Debug Profile, Runtime Profile, port, proxy, browser, and Host rules.
5. After start, use **Logs** to confirm command, working directory, PID, port, and Ready/HTTP state.
6. When a page check is needed, use **Web Actions** to choose the target page, action, and parameters.
7. Return to Resources for materials or environment pages, or continue with the next Link step.

![Project runtime panel overview](assets/screenshots/project-runtime-panel.png)

For the complete startup, profile, preflight, log, and web-action behavior, see [Project Startup And The Runtime Panel](project-runtime_EN.md). Resources discovers and invokes capabilities; it does not replace the effective values shown by Runtime Panel.

## 9. Workspace scope and shared entries

Resources refreshes with the active workspace:

- **System workspace** is the global view for all available projects, shared resources, and system entries.
- A **requirement workspace** shows only the selected projects, resources, tools, and proxies.
- **Workspace-owned resources** are stored in that workspace and apply only there.
- **Shared entries** come from a resource configuration source and can be selected by multiple workspaces. Removing one from a workspace does not delete its source definition.

Be more careful when editing a shared entry from the global view because multiple workspaces may depend on it. Use a workspace-owned entry for a temporary materials folder or debugging URL; place stable team-wide entries in a shared source.

## 10. Troubleshooting

### The entry says “Needs attention”

Check the required field for its type: URL for websites, path for folders/files, Bundle ID and app name for applications, script path for scripts, and Tool Key for tools. If a Tool Key is present but still warns, verify that its Action, web action, or project exists in the active source.

### A website opens in the wrong browser or has no login state

Review Browser and Profile. Use **Current Chrome** for the active signed-in session; choose a named browser and Profile for a fixed browser context. Never copy login data directories into shared configuration.

### A folder or file fails on another machine

The absolute local path differs. Shared configuration should use team-wide paths or an agreed variable; personal paths belong in local or workspace-owned configuration, with the machine dependency noted.

### A saved tool does nothing

You may have saved the Link or Action definition without saving the resource entry reference. Save the entry, then check its type, key, action, and active configuration source. For Runtime, confirm the project, launch profile, and directory are complete.

### No Web Action can be selected

Create and save an action under **Project Runtime Panel > Web Actions**, then refresh Resource Configuration. Resources does not infer a web action from an ordinary website URL.

### Runtime is ready but the page is unavailable

Open Runtime Panel and inspect preflight, effective port, Ready/HTTP verification, proxy matches, and `focusUrl`. A listening port only proves that some process is listening; it does not prove that it belongs to the target project or that the page is ready.

### Resources does not match the configuration file

Confirm the active workspace and configuration source, then refresh. Close drafts before external edits; when an external-change warning appears, compare or reload rather than overwriting the newer file with an old draft.

## 11. Practical conventions

- Names are for users; keys are for configuration and references. Do not use one in place of the other.
- Give one entry one clear purpose. Do not hide a website, script, and runtime chain behind one ambiguous “tool” name.
- Use a website, folder, file, or app for simple opening; use Action, Link, or Runtime when parameters, plans, logs, or Record matter.
- Keep credentials, cookies, private keys, temporary signed URLs, and machine-only paths out of shared entries.
- Prefer `inspect` or `plan` as the default for runtime-capable entries, then choose start, run, or stop after confirming the target.
- After a run, retain the Record, run ID, project key, and effective configuration source for review and reproduction.
