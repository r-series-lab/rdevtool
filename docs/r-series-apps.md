# R Series App Config

R 系列应用在 rDevTool 里按“项目事实源 + 工作区引用 + 访达入口”配置。

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
rdevtool --json projects build-target-add rdevtool --key web --label "前端构建" --adapter local_command --job "npm run web:build"
rdevtool --json projects build-param-add rdevtool web --key build_output_dir --label "产物目录" --kind hidden --default /Users/ikiru/Documents/r-series-public/rdevtool/web/dist
rdevtool --json projects build-target-add rdevtool --key package --label "本地打包" --adapter r_series_package
```

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
```
