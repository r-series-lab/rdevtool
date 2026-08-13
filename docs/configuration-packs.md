# 配置导入与导出

rDevTool 使用 `.rdtpack` 配置包迁移项目、工作区和资源配置。配置包面向三类场景：在多台电脑之间复用个人配置、向团队分发不含凭据的模板，以及在较大改动前保留可审查的迁移基线。

配置导入不是直接覆盖文件。标准流程固定为：**检查配置包 -> 生成导入计划 -> 处理映射和冲突 -> 执行 -> 必要时回滚**。

## 配置包包含什么

配置包按模块拆分，当前 schema 为 `v1`：

| 模块 | 内容 |
| --- | --- |
| `projects` | 项目身份、仓库地址、本地命令、Runtime 档案、构建目标、部署参数和 Git 分支规则 |
| `workspaces` | 工作区范围、项目实例、资源分类、资料目录和工作日志设置 |
| `preferences` | 菜单、主题等应用偏好；不会导出当前活动工作区 |
| `config_sources` | 选定配置源中的资源入口、Action、Link、本地代理和 Runtime 覆盖 |

配置包不复制 Git 仓库、构建产物、运行历史、活动记录、数据库、知识库 Markdown 正文或其他业务文件。它迁移的是 rDevTool 如何连接和组织这些内容。

## 在桌面端使用

打开 **设置 -> 配置迁移**。

### 导出

1. 勾选项目、工作区、一个或多个资源配置源，以及可选的界面偏好。
2. 在项目与工作区范围中选择具体条目。
3. 保持“自动包含工作区引用的项目”开启，避免工作区在目标机器上引用缺失项目。
4. 点击“导出”，选择 `.rdtpack` 保存位置。

导出结果会显示模块数量、校验和、安全处理数量和可移植路径数量。

### 导入

1. 点击“选择配置包”。此时只读取和校验，不写配置。
2. 选择冲突策略，并将包内每个资源配置源分别映射到本机配置源；同名源会自动匹配。
3. 点击“生成导入计划”。
4. 对新项目或新工作区补充本机根目录，再重新检查计划。
5. 确认计划没有阻断项后执行导入。
6. 导入完成后可在当前面板回滚整次事务。

## 冲突策略

| 策略 | 已存在的项目、工作区或文件 | 不存在的项目、工作区或文件 |
| --- | --- | --- |
| `merge` | 按对象字段合并；带 `key`、`id`、`name` 或 `title` 的数组按身份合并 | 新增 |
| `add` | 跳过 | 新增 |
| `replace` | 使用包内对象替换冲突项 | 新增 |
| `skip` | 跳过 | 新增 |

默认使用 `merge`。`replace` 适合受控模板同步；执行前应重点检查目标和变更数量。

## 路径映射

导出时，项目根目录和工作区根目录会分别转换为：

```text
${PROJECT_ROOT:project-key}
${WORKSPACE_ROOT:workspace-key}
${HOME}
```

目标机器已有同 key 项目或工作区时，计划会复用现有根目录。新条目必须显式提供映射，计划才允许执行。路径映射只配置目录，不会克隆仓库或创建工作区内容。

## 凭据安全

- Jenkins 密码和 GitLab token 不会进入配置包。
- 环境变量、Header 和认证辅助配置中疑似凭据的值会替换为环境变量引用。
- 默认导入允许凭据留空，保留目标机器已有凭据，并把缺失项列为警告。
- CLI 使用 `--require-secrets` 时，缺失的环境变量会成为阻断项。
- 配置包可读且适合代码审查，但仍可能包含内部 URL、项目名、分支规则和目录结构；对外分发前应检查 manifest 和内容。

## CLI

```bash
# 查看可导出的范围
rdevtool --json pack inventory

# 导出项目、工作区、偏好和默认资源配置源
rdevtool pack export team.rdtpack \
  --project admin \
  --workspace feature-a \
  --preferences \
  --include-config-sources \
  --config-source default

# 只读检查
rdevtool --json pack inspect team.rdtpack

# 生成计划；新项目需要映射本机目录
rdevtool --json pack import-plan team.rdtpack \
  --strategy merge \
  --project-root admin=/Users/me/Projects/admin \
  --workspace-root feature-a=/Users/me/Documents/rdevtool-workspaces/feature-a \
  --config-source-map default=default

# 使用上一步返回的 planHash 执行
rdevtool --json pack import-run --plan-hash rdtpack-<sha256>

# 使用执行结果中的 transactionId 回滚
rdevtool --json pack rollback <transaction-id>
```

导入计划有效期为 24 小时。配置包内容或任一目标配置文件在计划后发生变化，`import-run` 会拒绝执行，必须重新生成计划。

## 文件格式与恢复

`.rdtpack` 是 ZIP 容器，包含 `manifest.json`、`README.txt` 和 `modules/*.json`。manifest 记录格式版本、生产者版本、模块校验和和安全处理摘要。读取时会限制包大小、条目数量、单条目解压大小和路径形式，并验证每个模块的 SHA-256。

执行导入前，rDevTool 会把所有目标文件保存到配置目录下的 `config-pack-backups/<transaction-id>/`。计划记录每个待写文件的内容指纹；执行时会在同一组配置锁内再次检查目标状态、创建快照并原子写入。任一写入失败时会立即恢复整批原文件；显式回滚也以同一事务清单恢复全部文件，回滚中途失败则恢复回滚前状态。
