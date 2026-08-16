# Contributing / 参与贡献

感谢你帮助改进 rDevTool。提交代码前请先搜索现有 Issue；较大的行为或数据模型变化建议先开 Feature Request 对齐范围。

Thank you for improving rDevTool. Search existing Issues before starting. Open a Feature Request before implementing a large behavioral or data-model change.

## Local checks

```bash
npm --prefix web ci
npm run check:full
```

Keep changes scoped, preserve the existing Tauri/Rust/React boundaries, and add focused tests for changed behavior. Public fixtures, screenshots, logs, and examples must use synthetic data and must not contain credentials, private URLs, usernames, or machine-specific paths.

## Pull requests

- Explain the user-visible behavior and risk.
- Link the related Issue when one exists.
- Update Chinese and English documentation together.
- Update `CHANGELOG.md`, `CHANGELOG_EN.md`, and `r-app.manifest.json` when public behavior changes.
- Confirm `npm run check:full` passes.

By contributing, you agree that your contribution is licensed under the repository's MIT License.
