# Runtime, Proxy, Link, And Web Checks

## Runtime

1. Inspect `runtime profiles`, then `runtime inspect --project <key>` or `runtime preflight --project <key>`. For a cross-domain check, use `doctor --project <key> --debug-profile <profile>` under the intended `--workspace`.
2. Verify effective cwd, command, environment, Debug Profile, Runtime Profile, ready probe, expected port, and existing sessions.
3. Run `runtime start`; preserve `runId`.
4. Use `runtime log --run-id <id>` and `runtime wait --run-id <id> --until http-verified`. For bounded triage, prefer `runtime log --tail <n> --errors-only` or `--grep <text>`; add `--case-sensitive` only when required.
5. Stop only the selected managed session.

Debug Profile and Runtime Profile are separate. One-off `--command`, `--runtime-profile`, and `--expect-port` overrides should be repeated from preflight to start without rewriting global project config.

## Proxy

- `proxy status` establishes listener ownership.
- `proxy diagnose` predicts rule matching; it is not observed traffic.
- `proxy verify` performs a real request.
- End-to-end success requires managed listener start, confirmed rule match, and verified response.
- Never replace or stop an external/unmanaged listener.
- A profile's `upstream_base_url` plus `upstream_proxy` is the default forward path for requests that do not match a Mock, Block, or explicit Forward rule. Do not add a catch-all Forward rule unless it changes that behavior intentionally.
- Derive the actual request path from effective project, Runtime Profile, Debug Profile, Proxy profile, and operating-system configuration. Do not assume a fixed number or kind of hops.
- Distinguish rDevTool's inbound listener from its optional outbound network path. The outbound path may be direct or may use another configured network access layer.
- Detect loops and duplicate hops generically: if an application-level route and a process-level proxy point back to the same listener, report the conflict before starting.
- Treat `runtimeProxy.selfLoop` as blocking. Treat `runtimeProxy.duplicateLayer` as a review item backed by the effective proxy URL and explicit environment keys; do not infer a named network tool from the endpoint alone.
- Diagnose transport failures by testing each configured hop independently and comparing the first failing boundary. Skip layers that are absent from the effective configuration.
- Treat an authentication or authorization response without credentials as evidence that the responding service was reached; do not automatically classify it as a transport failure.
- Preserve query strings for every forwarded URL; never assign a target containing `?` wholesale as a path.

## Link

Run `link plan`, usually `link check`, then `link run` only with explicit intent. Inspect every step and make sure Link and Runtime resolve the same target.

## Web Checks

Use configured `web-actions` for repeatable browser checks. Derive the effective request path first, then verify only its configured components in order. Do not assume that a frontend server, process proxy, system network layer, rDevTool proxy, or remote service is always present.
