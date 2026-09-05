# Local Proxy: Services, Rules, And Requests

rDevTool's **Local Proxy** creates reusable HTTP/HTTPS entry points on the local machine. Projects, browsers, command-line tools, and other local applications can send traffic through the same proxy profile. The Proxy page keeps service state, rules, real requests, and rule diagnosis in one workflow.

This guide explains:

1. How to create, start, stop, and verify a service profile.
2. How rules match requests and how Forward, Mock, and Block behave.
3. How to search, filter, inspect, clear, and refresh the request list.
4. The difference between rule diagnosis and real request evidence.
5. How a proxy connects to project launch profiles, Links, and workspaces, and how to share it safely.

![Local Proxy services and rules](assets/screenshots/local-proxy-rules.png)

## 1. The three layers of proxy data

| Layer | Question it answers | Where it appears |
| --- | --- | --- |
| Service profile | Which local address receives traffic, and who owns the listener? | Service list and Proxy Configuration |
| Rule | What should happen when a request meets these conditions? | Rules list and Rule Configuration |
| Request event | What actually happened, and what was the response? | Request panel and request detail |

There is also a read-only **diagnosis result**. It simulates one request against the current configuration and reports the matching rule, failed conditions, and listener state. Diagnosis is not a network request and does not create a request event.

A proxy is usable only when all of the following are true:

1. The selected profile is complete.
2. The listen address and port belong to the expected proxy service.
3. The service reports **Running** and is not externally occupied.
4. The target request actually enters that profile.
5. The matched rule, upstream, and response agree with the intended configuration.

An open port or a Running chip alone does not prove that the business request path works.

## 2. Proxy page overview

Open **Local Proxy** from the left navigation. The overview toolbar summarizes the selected source and active scope:

- **Services**: profiles in the current configuration source.
- **Running**: profiles that are listening and managed by rDevTool.
- **External**: profiles whose ports are listening but owned by another process. It appears only when non-zero.
- **Rules**: rules in the selected profile.
- **Requests**: recorded events in the selected profile.

The toolbar has two main actions:

- **Request Log** opens the request list and diagnosis panel.
- **Proxy Configuration** manages the source, service profiles, import/export, and service fields.

The main area is split into services on the left and rules for the selected service on the right. Collapsing the service list creates more space for rules. The collapsed state is a local UI preference and does not change proxy configuration.

## 3. Service profiles

### 3.1 Service card contents

Each service card shows:

- the profile name;
- the effective listen URL, such as `http://127.0.0.1:8787`;
- its current state;
- rule and request counts;
- a start or stop control.

Click the card body to select a profile. The rule list and rule/request counts refresh with it. The request count on a card belongs to that profile; it is not the total for all services.

### 3.2 Service states

| State | Meaning | Recommended action |
| --- | --- | --- |
| Stopped | No listener is detected for the profile | Start it, or check address and port first |
| Running | The port is listening and rDevTool manages the process | Point a project or CLI client at the listen URL |
| External | The port is listening but the process was not created by rDevTool | Inspect PID, command, and working directory before acting |
| Restart required | The service version does not match the current app | Stop and start it again to upgrade |
| Unsaved | A new service draft in Proxy Configuration | Save the service before expecting a listener |

**External** is a risk state, not a successful start. rDevTool does not terminate an external process through the stop control. Confirm ownership first, or move the rDevTool profile to an available port.

### 3.3 Create a service

Use **New Service** at the bottom of the page or **Proxy Configuration > New Service**. Fill in:

| Field | Explanation |
| --- | --- |
| Name | Human-facing profile name, such as `Project A Debug` or `Mock API` |
| Listen Address | Local address to bind, commonly `127.0.0.1` |
| Port | Local listen port; avoid project and service conflicts |
| Upstream URL | Optional default target base; relative requests join this base |
| Upstream Proxy | Optional default HTTP/SOCKS outbound proxy |
| Capture Body | Whether to retain request and response Body previews |
| Body Preview Bytes | Maximum Body preview retained per request/response |

Saving a service writes configuration but does not automatically start the listener. Start it from the service card and refresh the state afterward.

### 3.4 Default forwarding and outbound proxy

Service **Default Forwarding** handles requests that are not rewritten by a rule:

- With an upstream URL, relative request paths can join that base.
- With no upstream URL, the original request target is used.
- With an upstream proxy, rules using “Inherit default” use that proxy.
- With no default upstream proxy, inherited traffic normally connects directly.

Default forwarding controls the fallback target and outbound path. It does not make every request match a rule. A rule's outbound setting can override the service default.

### 3.5 Connect clients through environment variables

Proxy Configuration shows copy controls for `HTTP_PROXY` and `HTTPS_PROXY` using the current listen URL. Paste them into a terminal or project launch profile when a command-line tool should use the proxy.

Remember:

- This changes the proxy path, not the project's API Base URL.
- Whether a tool honors `HTTP_PROXY`/`HTTPS_PROXY` depends on that tool.
- Use the tool's No Proxy behavior or project runtime configuration for bypasses.
- Proxy URLs, upstream URLs, and headers can contain sensitive data. Do not commit them to a repository.

## 4. Rule matching

The right-hand rule list belongs to the selected service. Each row shows the name, action, outbound policy, priority, optional delay, method, and match target.

### 4.1 Rule fields

Open **New Rule** or select a rule to open **Rule Configuration**:

| Field | Behavior |
| --- | --- |
| Rule Name | Appears in the list, diagnosis, and request detail |
| Priority | Lower numbers are evaluated first; name and ID stabilize equal priorities |
| Method | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, or `OPTIONS`; blank means any method |
| Path Prefix | Request path must start with this value, such as `/api` |
| URL Contains | Full URL must contain this string |
| Header Name | Optional request header name |
| Header Contains | If a header exists, its value must contain this string; blank checks presence only |
| Action | `Forward`, `Mock`, or `Block` |
| Enabled | Disabled rules remain configured but do not match |
| Delay ms | Adds an artificial delay to the action |

Multiple conditions are **AND** conditions. A rule matches only when method, URL, path, and header conditions all pass. An empty condition means that dimension is unrestricted.

### 4.2 Priority and specific rules

rDevTool evaluates rules from the smallest priority upward and uses the first enabled match. A common setup is:

```text
P10  GET  /api/health       -> Mock 200
P20  GET  /api              -> Forward
P30  any   /               -> default forwarding
```

The more specific `/api/health` rule should have the smaller priority. Diagnosis warns when a more specific rule would also match but appears after the selected rule. Lower that rule's priority and diagnose again.

### 4.3 Enable and bulk switches

The **Enable** and **Disable** buttons above the rules batch-toggle rules in the selected profile. The switch on each row changes only that rule.

Disabling a rule does not delete its configuration or clear historical requests. This is useful for temporarily turning off a Mock or Block rule while testing the real upstream.

After saving a rule, the list refreshes. Existing request events are not recalculated; send a new request to verify the new configuration.

## 5. The three rule actions

### 5.1 Forward

A Forward rule sends the request to an upstream target. It can configure:

- **Forward To**: overrides the target base URL; blank uses the original request target or service default.
- **Path Rewrite**: changes the forwarded path prefix, for example `/debug-api` to `/api`.
- **Outbound Policy**:
  - **Inherit default** uses the service upstream proxy, or connects directly when none exists.
  - **Direct** bypasses upstream proxies for this rule.
  - **Specified Proxy** uses an HTTP/SOCKS proxy only for this rule.
- **Append Request Headers** and **Append Response Headers**.
- **Delay** to simulate forwarding latency.

Forward To decides where the request goes; the outbound policy separately decides whether it uses an upstream proxy.

### 5.2 Mock

A Mock rule does not contact the upstream. It returns its configured response directly:

- status code such as `200`, `404`, or `500`;
- `Content-Type`;
- response headers;
- response body;
- optional delay.

Use it to simulate success, empty data, permissions, slow responses, and error responses. The request list marks the event as `Mock`. Body visibility still follows the service's Capture Body setting.

### 5.3 Block

A Block rule does not contact the upstream. It immediately returns the configured status code and block response body. Use it to test unavailable APIs, denied requests, or permission-error UI states.

Mock means “replace the upstream with a local response”; Block means “explicitly reject this request”. The request list and filters preserve this distinction.

## 6. Request list

Click **Request Log** to open the request panel for the selected profile. It never mixes events from another profile into the current list.

### 6.1 Refresh and counts

When the selected profile is running under rDevTool control, the open request panel refreshes automatically about every 2.5 seconds. Refresh pauses while the page is not visible and resumes when it becomes visible again.

The header displays `visible / total`:

- Up to 50 matching events load initially.
- Scroll down or use **Load More** to fetch more.
- Total is the count after the current query and filter, not necessarily the full accumulated count.
- **Refresh** rereads persisted request events.
- **Clear** removes events for the selected profile without deleting the service or rules.

### 6.2 Search and filters

Search matches:

- HTTP method;
- full URL and path;
- status code;
- action such as `Mock`, `Forward`, or `Block`;
- matched rule name;
- profile name and error text.

Filters are:

| Filter | Meaning |
| --- | --- |
| All | All events for the selected profile |
| Success | No error and a 2xx/3xx status |
| Failed | Error, 4xx/5xx, or error action |
| Mock | Handled by a Mock rule |
| Forward | Forwarded, tunneled, or default-forwarded traffic |
| Block | Handled by a Block rule |

Search and filters combine. **Reset** clears the query and returns to All.

### 6.3 Request row and detail

Each row shows method, status, action, time, and path. Colors are for scanning; open the detail pane for the evidence:

- status and duration;
- request and response byte counts;
- full URL;
- matched rule and action;
- request headers;
- response headers;
- request Body preview;
- response Body preview;
- error text and truncation state.

When Capture Body is off, headers and basic metadata remain available but Body previews are not stored. Even when it is on, previews are limited by Body Preview Bytes. A `+` marker on a Body title means the content may be truncated.

Use request records to answer “what actually happened”. Do not infer a real match from the rules list alone.

## 7. Request diagnosis

The request panel includes a diagnosis area. Select an HTTP Method, enter a path or full URL, and click **Diagnose**. Or select a real request and use **Use Selected Request** to fill the method and path.

Diagnosis reports:

- profile name, listen URL, and whether the port is listening;
- normalized method, URL, path, and header count;
- `Matched`, `Rule matched but port is not listening`, or `Not matched`;
- the selected rule, priority, and action;
- per-rule decisions for enabled state, method, URL, path, and headers;
- warnings for no enabled rules, no match, or a more-specific rule shadowed by an earlier rule.

### 7.1 Paths and full URLs

- `/api/health` uses the service upstream as the diagnosis base; without one, diagnosis uses a local placeholder base.
- `https://api.example.com/health` diagnoses the full URL directly.
- Relative paths require a service upstream or a Host header; incomplete target information produces an invalid-target warning.
- Diagnostic headers are used for matching only. They are not sent to a real server.

### 7.2 Diagnosis versus real request evidence

| Item | Rule diagnosis | Request log |
| --- | --- | --- |
| Sends network traffic | No | Yes, from a real client |
| Creates a request event | No | Yes |
| Shows a real response | No | Status, headers, and optional Body |
| Main purpose | Check configuration and conditions | Verify the actual chain and upstream result |
| Proves the port works | Reports current listener state only | Shows whether traffic entered the service |

The recommended sequence is: diagnose first, send one request from the real client, then inspect the request detail for the upstream, Mock, or Block result.

## 8. Sources, workspaces, and project binding

Proxy Configuration shows the active **configuration source** and proxy file path. Save or cancel service, rule, and import drafts before switching sources; the page blocks a source change while there are unsaved changes.

Proxy visibility follows the active workspace:

- `system` is the global view of shared profiles.
- A requirement workspace shows only profiles included in that scope.
- Removing a profile from a workspace does not delete it from its source.
- Editing a shared profile can affect other workspaces, so review the workspace and source before saving.

A project launch profile can bind a local proxy profile. Runtime Panel preflight then checks whether the profile exists, its source is available, the port is listening, and an external process owns it. When a project fails to start or connect, inspect both Runtime Panel and the Proxy request log.

See [Project Startup And The Runtime Panel](project-runtime_EN.md) for the complete launch-profile, runtime-config, and Runtime Panel flow.

A Link can combine starting a proxy, starting a project, opening a page, and verifying a request. Link owns the step order; the Proxy page owns profile, rules, and request evidence.

## 9. Import and export proxy packs

In **Proxy Configuration**:

- **Import** selects a `.json` proxy pack. It creates a new service and assigns imported rules to it without overwriting existing services.
- **Export Selected** writes the selected service, rules, added headers, Mock Body, and upstream values to `.rdevproxy.json`.

After import, check the name, listen address, and port for local conflicts. Before export, inspect:

- internal or temporary upstream URLs;
- usernames, passwords, or private addresses in upstream proxies;
- Cookie, Authorization, or internal headers;
- business data in Mock Body.

A proxy pack is a configuration migration file, not a credential vault. Redact it before sharing and re-test after import against the recipient's local ports and network.

## 10. Troubleshooting flows

### The port is externally occupied

Inspect the listen URL, PID/process ownership, and command. Do not stop an unknown process. Confirm it belongs to the task before handling it, or move the rDevTool profile to a free port. Update project launch profiles, Runtime Profiles, and Links together after changing the port.

### The service runs but the request list is empty

1. Confirm the client uses the profile's listen URL.
2. Confirm the selected profile is the one receiving traffic.
3. Clear the query and filters, then refresh.
4. Check whether the client bypasses `HTTP_PROXY` or has its own proxy settings.
5. Check for DNS, TLS, or client connection failures that happen before the proxy receives the request.

### A request enters but no rule matches

Use the selected request for diagnosis. Check method, full URL, path, and headers. Pay attention to a missing leading `/` in Path Prefix, URL Contains matching the full URL, header name/value conditions, and the rule's Enabled state.

### The wrong rule matches

Review priority and whether a more-specific rule appears later. The specific-rule-shadowed warning means a longer path prefix also matches but has a later priority. Give the specific rule a smaller priority and test again.

### Mock or Block does not take effect

Confirm that the request entered the intended profile, then check action, enabled state, method, and path. Send a new request after saving; existing events are not re-evaluated.

### Body is missing from request detail

Enable **Capture Body** and increase Body Preview Bytes if needed. With Capture Body off, headers and basic metadata remain intentionally available for privacy and performance.

### The target is correct but upstream access fails

Check the Forward To target, service default upstream, rule outbound policy, and specified upstream proxy separately. Inherit default, Direct, and Specified Proxy are independent choices.

## 11. CLI equivalents

When the desktop UI is unavailable, use the CLI for read-only checks or explicit profile operations. `<profile>` accepts a profile key or name; inspect the active source and status before writes.

```bash
# Inspect source, profiles, and runtime status
rdevtool --json proxy source
rdevtool --json proxy list
rdevtool --json proxy status
rdevtool --json proxy show <profile>

# Start, stop, or restart a profile
rdevtool --json proxy start <profile>
rdevtool --json proxy stop <profile>
rdevtool --json proxy restart <profile>

# List rules and predict one request
rdevtool --json proxy rule-list --profile <profile>
rdevtool --json proxy diagnose --profile <profile> --method GET --url /api/health
rdevtool --json proxy verify --profile <profile> --url /api/health

# Bind a profile to project runtime capability
rdevtool --json proxy bind-runtime --profile <profile>
```

`diagnose` predicts rule matching; `verify` goes further and validates the proxy chain. Keep configured, requested, and observed values separate: configuration does not prove a listener, and a listener does not prove a successful business request.

## 12. Safety and records

- Treat Local Proxy as a local debugging, Mock, Block, and verifiable-request tool, not a production gateway.
- Remove cookies, Authorization, private keys, proxy credentials, and internal URLs before sharing configuration.
- Enable Body capture only when needed; clear request events after reproducing an issue.
- Logs and Body previews may contain business data. Do not commit them to a repository or paste them into a public ticket.
- For troubleshooting notes, retain the profile, listen URL, configuration source, rule name, request path, and diagnosis result.
