# r-series i18n module

This folder contains the dependency-free interface localization layer used by
rDevTool. It is designed so other r-series Tauri apps can adopt it without
changing their persisted configuration or backend command contracts.

## Integration

1. Wrap the application root in `I18nProvider`.
2. Use `useI18n().t()` at UI render boundaries.
3. Keep persisted values, enum keys, CLI arguments, and user-authored content
   unchanged.
4. Add English copy to `EN_MESSAGES` using the existing Chinese UI text as the
   stable message key.

The provider stores only the language preference in local storage under
`rdevtool.language`. Supported preferences are `system`, `zh-CN`, and `en-US`.

Common components use a safe Chinese fallback when rendered without the
provider, which keeps server-rendered tests and optional modules functional.

## Scope rules

- Translate navigation, controls, status labels, empty states, and help text.
- Do not translate project names, paths, command output, configuration keys, or
  other user data.
- Prefer parameterized messages such as `切换到 {page}` over string
  concatenation.
- New optional pages should integrate at their own render boundary. The
  in-progress Knowledge page is intentionally outside the first rollout.
