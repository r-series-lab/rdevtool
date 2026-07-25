# R Series App Config

R 系列应用在 rDevTool 里按“项目事实源 + 工作区引用 + 访达入口”配置。

每个持续维护的应用还应在仓库根目录提供 `r-app.manifest.json`。它连接应用命名、架构、CLI、文档、官网内容和质量命令，并由 `r-series-apps/schemas/r-app.manifest.schema.json` 约束；包管理器、Cargo 与 Tauri 仍分别是自身构建字段的事实源。

## Project

每个本地应用至少配置：

- `repo_path`：仓库绝对路径。
- `[projects.dev]`：主开发命令。
- `[projects.build]`：主桌面打包命令和产物目录。
- `web` target：快速前端构建。
- `package` target：本地桌面打包。

```bash
rdevtool --json projects add --key rdevtool --name "rDevTool" --category "R系列" --repo-path /Users/ikiru/Documents/r-series-public/rdevtool
rdevtool --json projects set-command rdevtool --kind dev --command "npm run dev" --cwd /Users/ikiru/Documents/r-series-public/rdevtool
rdevtool --json projects set-command rdevtool --kind build --command "npm run build" --cwd /Users/ikiru/Documents/r-series-public/rdevtool --output-dir /Users/ikiru/Documents/r-series-public/rdevtool/target/release/bundle
rdevtool --json projects build-target-add rdevtool --key web --label "前端构建" --adapter local_command --job "npm run web:build" --output-dir /Users/ikiru/Documents/r-series-public/rdevtool/web/dist
rdevtool --json projects build-target-add rdevtool --key package --label "本地打包" --adapter r_series_package
```

产物目录属于 build target 自身的 `artifact.output_dir`，不作为 Jenkins 参数发送。旧的隐藏参数 `build_output_dir` 仍可读取，但只建议用于一次性覆盖或兼容已有配置。

`package` target 常用参数：

```bash
rdevtool --json projects build-param-add rdevtool package --key platform --label "系统" --kind select --default macos --option macos --option windows --option linux
rdevtool --json projects build-param-add rdevtool package --key profile --label "配置" --kind select --default release --option release --option debug
rdevtool --json projects build-param-add rdevtool package --key channel --label "渠道" --kind select --default local --option local --option beta --option stable
```

## Workspace

`system` 是全局视图；`r-series` 只引用 R 系列项目和入口。

```bash
rdevtool --json workspace scope r-series \
  --clear-projects \
  --project rdevtool \
  --project rterm \
  --project rimage \
  --clear-navigation \
  --navigation-category "R系列开发" \
  --navigation-entry "访达" \
  --navigation-entry "iTerm"
```

## Finder Entries

目录入口放在 `R系列开发` 分类，项目详情仍由 `projects.toml` 维护。

```bash
rdevtool --json navigation add --category "R系列开发" --short-label "R系列" --name "R 系列根目录" --kind directory --path /Users/ikiru/Documents/r-series-public
rdevtool --json navigation add --category "R系列开发" --short-label "R系列" --name "rDevTool 目录" --kind directory --path /Users/ikiru/Documents/r-series-public/rdevtool
rdevtool --json navigation add --category "R系列开发" --short-label "R系列" --name "rDevTool App" --kind app --bundle-id app.rseries.rdevtool
```

## Check

配置写完后跑：

```bash
rdevtool --json doctor
rdevtool --json workspace show r-series
rdevtool --json build plan rdevtool --target package --set platform=macos --set profile=release
npm run manifest:check
npm run ipc:check
```

在 `r-series-apps` 仓库运行 `npm run family:check` 可扫描同级 Tauri 应用，检查 Manifest、版本、标识、文档路径和质量脚本。官网构建从 `website.publish=true` 的 Manifest 读取产品内容，再复制应用仓库登记的源文档；功能更新时不应在官网手工维护第二份正文。

推荐更新顺序：共享 Core 与测试、UI/CLI adapter、应用文档、Manifest capability/workflow、CHANGELOG，最后运行应用检查和家族检查。详细清单见 [maintenance.md](maintenance.md)。
