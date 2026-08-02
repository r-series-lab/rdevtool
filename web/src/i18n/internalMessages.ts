import type { Translate } from "./index";

const EXACT_INTERNAL_MESSAGE_KEYS = new Set([
  "App",
  "CLI",
  "GitLab 身份验证失败（HTTP 401），请检查访问令牌是否有效或已过期。",
  "GitLab 拒绝了本次操作（HTTP 403），请检查访问令牌权限和项目成员权限。",
  "分支存在合并冲突（HTTP 409），请先处理冲突后重试。",
  "dev 服务启动成功",
  "当前工作区中未找到要启动的项目",
  "当前配置源不支持运行环境模板覆盖。",
  "当前项目未配置目录",
  "当前修复计划不完整，请打开对应配置页处理。",
  "可重试",
  "CLI Link run 暂不打开浏览器页面；可使用 runtime focus 或 App 查看。",
  "CLI detached runtime 暂无 Link stop 所有权语义，未执行停止。",
  "上传成功",
  "停止重试",
  "停止失败",
  "停止联调链路",
  "同步 Jenkins 状态中…",
  "同步中",
  "同步失败",
  "合并分支",
  "合并并推送成功",
  "合并成功",
  "配置更新",
  "失败",
  "忽略",
  "已停止",
  "已停止自动重试",
  "已启动",
  "已启动 · dev 服务启动成功",
  "已解析打开页面",
  "已提交",
  "已提交并推送",
  "已推送",
  "已跳过",
  "成功",
  "打开构建记录",
  "打开网页动作",
  "打开页面",
  "打开页面动作未在 Link CLI 中执行。",
  "打开页面步骤已识别，CLI 检查模式不执行打开动作。",
  "托盘",
  "提交并推送",
  "提交并推送成功",
  "提交成功",
  "推送分支",
  "推送分支失败",
  "推送成功",
  "操作已完成",
  "无法读取 Jenkins 当前状态",
  "构建",
  "构建中",
  "构建失败",
  "构建成功",
  "构建排队中",
  "构建已取消",
  "构建已触发",
  "构建取消",
  "需查看差异",
  "需确认失败",
  "需重新加载",
  "检查并重试 Git 操作",
  "检查并重新停止",
  "检查并重新启动",
  "检查代理监听与规则命中",
  "检查联调链路",
  "检查结果为空，未执行重试",
  "检查通过",
  "检查通过，可以安全重试",
  "状态同步失败",
  "状态未确认",
  "目标提交",
  "触发产物构建",
  "触发产物构建失败",
  "触发发布",
  "触发发布失败",
  "触发构建",
  "触发构建失败",
  "触发部署",
  "触发部署失败",
  "该记录缺少明确的构建目标，无法安全重放；请打开构建页重新选择目标。",
  "运行中",
  "运行环境",
  "配置",
  "部署",
  "部署成功",
  "发布",
  "发布成功",
  "产物构建",
  "产物构建成功",
  "创建分支",
  "创建成功",
  "克隆分支",
  "克隆成功",
  "切换分支",
  "切换分支失败",
  "切换成功",
  "当前批次包含同一项目的部分成功结果，请打开 Git 页面核对后按剩余目标执行。",
  "环境",
  "分支",
  "标记已处理",
  "本地覆盖文件",
  "本地覆盖文件不会在 Link stop 中自动删除。",
  "本地覆盖文件不会由 Link CLI 直接写入；启动 runtime 时由调试配置应用。",
  "本地覆盖文件由运行调试配置在启动前应用。",
  "确认本地覆盖文件",
  "缺少 action，无法定位网页动作。",
  "缺少 path，无法定位本地覆盖文件。",
  "缺少 profile，无法定位代理服务。",
  "缺少 profile，无法检查代理服务。",
  "缺少 project。",
  "缺少 project，无法定位要聚焦的项目。",
  "缺少 project，无法定位运行项目。",
  "缺少 project，无法确认本地覆盖文件属于哪个项目。",
  "缺少 type，无法识别步骤类型。",
  "缺少步骤类型",
  "缺少项目，无法启动 runtime。",
  "缺少项目，无法执行运行前检查。",
  "联调链路已停止",
  "联调链路已启动",
  "联调链路停止失败",
  "联调链路启动失败",
  "联调链路检查未通过",
  "计划启动代理服务",
  "计划启动项目运行环境",
  "计划处理网页动作",
  "计划打开项目调试页面",
  "计划校验未通过，已跳过执行。",
  "请在 App 中停止 Link，或用运行日志定位后手动停止明确归属的进程。",
  "代理 profile 不存在，无法停止。",
  "代理 profile 不存在，无法启动。",
  "代理 profile 不存在，无法检查监听。",
  "代理服务",
  "代理检查",
  "代理端口由非 rDevTool 进程占用，无法安全接管。",
  "代理启动后未监听，请查看新活动的诊断详情",
  "代理停止后仍在监听，请查看新活动的诊断详情",
  "启动失败",
  "启动联调链路",
  "未检测到可认领的外部 dev 服务",
  "未命名步骤",
  "正在重新加载配置",
  "正在重新启动联调链路",
  "正在重新停止联调链路",
  "正在打开产物目录",
  "正在打开目录",
  "正在打开入口",
  "正在打开项目目录",
  "正在检查并启动 dev 服务",
  "正在检查联调链路",
  "正在检查远端分支",
  "正在清空分支任务记录",
  "正在清空构建记录",
  "正在刷新构建记录",
  "正在刷新构建状态",
  "正在认领外部 dev 服务",
  "正在执行重试前检查",
  "正在执行构建任务",
  "正在启动",
  "正在停止 dev 服务",
  "正在停止",
  "正在同步分支",
  "正在修复工作副本",
  "正在诊断代理请求",
  "正在中止构建任务",
  "正在唤起运行中的项目",
  "执行网页动作",
  "该步骤类型尚未接入 CLI 执行器。",
  "该步骤类型尚未接入 CLI 检查器。",
  "警告",
  "重试前检查",
  "重试前检查失败",
  "扩展步骤",
]);

function translateExactInternalMessage(message: string, t: Translate) {
  return EXACT_INTERNAL_MESSAGE_KEYS.has(message) ? t(message) : message;
}

function translateInternalMessageCore(message: string, t: Translate): string {
  const exact = translateExactInternalMessage(message, t);
  if (exact !== message) {
    return exact;
  }

  if (message.includes("\n")) {
    return message
      .split("\n")
      .map((line) => translateInternalMessage(line, t))
      .join("\n");
  }

  const buildResultMatch = message.match(/^构建\s+#(\S+)\s+当前结果[：:]\s*(.+)$/);
  if (buildResultMatch) {
    return t("构建 #{id} 当前结果：{result}", {
      id: buildResultMatch[1],
      result: buildResultMatch[2],
    });
  }

  const reasonMatch = message.match(/^原因[：:]\s*(.+)$/);
  if (reasonMatch) {
    return t("原因：{reason}", {
      reason: translateInternalMessage(reasonMatch[1], t),
    });
  }

  const warningMatch = message.match(/^警告[：:]\s*(.+)$/);
  if (warningMatch) {
    return t("警告：{warning}", {
      warning: translateInternalMessage(warningMatch[1], t),
    });
  }

  const reasonPrefixPatterns: Array<[RegExp, string]> = [
    [/^监听托盘操作失败[：:]\s*(.+)$/, "监听托盘操作失败：{reason}"],
    [/^联动操作失败[：:]\s*(.+)$/, "联动操作失败：{reason}"],
    [/^检查未通过[：:]\s*(.+)$/, "检查未通过：{reason}"],
    [/^刷新工作区状态失败[：:]\s*(.+)$/, "刷新工作区状态失败：{reason}"],
    [/^监听工作区配置变化失败[：:]\s*(.+)$/, "监听工作区配置变化失败：{reason}"],
    [/^同步操作历史失败[：:]\s*(.+)$/, "同步操作历史失败：{reason}"],
    [/^记录工作区配置变化失败[：:]\s*(.+)$/, "记录工作区配置变化失败：{reason}"],
    [/^监听工作区配置活动失败[：:]\s*(.+)$/, "监听工作区配置活动失败：{reason}"],
    [/^记录配置源变化失败[：:]\s*(.+)$/, "记录配置源变化失败：{reason}"],
    [/^监听配置源活动失败[：:]\s*(.+)$/, "监听配置源活动失败：{reason}"],
  ];
  for (const [pattern, key] of reasonPrefixPatterns) {
    const prefixMatch = message.match(pattern);
    if (prefixMatch) {
      return t(key, {
        reason: translateInternalMessage(prefixMatch[1], t),
      });
    }
  }

  const actionTriggeredRecordFailureMatch = message.match(/^(.+?)已触发，但保存本地记录失败[：:]\s*(.+)$/);
  if (actionTriggeredRecordFailureMatch) {
    return t("{action}已触发，但保存本地记录失败：{reason}", {
      action: translateInternalMessage(actionTriggeredRecordFailureMatch[1], t),
      reason: translateInternalMessage(actionTriggeredRecordFailureMatch[2], t),
    });
  }

  const actionReplayedRecordFailureMatch = message.match(/^(.+?)已重播，但保存本地记录失败[：:]\s*(.+)$/);
  if (actionReplayedRecordFailureMatch) {
    return t("{action}已重播，但保存本地记录失败：{reason}", {
      action: translateInternalMessage(actionReplayedRecordFailureMatch[1], t),
      reason: translateInternalMessage(actionReplayedRecordFailureMatch[2], t),
    });
  }

  const archivedWorkspaceMatch = message.match(/^已归档工作区[：:]\s*(.+)$/);
  if (archivedWorkspaceMatch) {
    return t("已归档工作区：{name}", {
      name: archivedWorkspaceMatch[1],
    });
  }

  const restoredWorkspaceMatch = message.match(/^已恢复工作区[：:]\s*(.+)$/);
  if (restoredWorkspaceMatch) {
    return t("已恢复工作区：{name}", {
      name: restoredWorkspaceMatch[1],
    });
  }

  const linkActionTitleMatch = message.match(/^(启动|停止)联调链路$/);
  if (linkActionTitleMatch) {
    return t("{action}联调链路", {
      action: t(linkActionTitleMatch[1]),
    });
  }

  const linkActionFailureMatch = message.match(/^联调链路(启动|停止)失败$/);
  if (linkActionFailureMatch) {
    return t(
      linkActionFailureMatch[1] === "停止"
        ? "联调链路停止失败"
        : "联调链路启动失败",
    );
  }

  const linkActionDoneMatch = message.match(/^联调链路已(启动|停止)$/);
  if (linkActionDoneMatch) {
    return t(
      linkActionDoneMatch[1] === "停止" ? "联调链路已停止" : "联调链路已启动",
    );
  }

  const linkRetryBlockedMatch = message.match(/^(\d+)\s+个步骤阻止重试$/);
  if (linkRetryBlockedMatch) {
    return t("{count} 个步骤阻止重试", {
      count: linkRetryBlockedMatch[1],
    });
  }

  const linkModeUnsupportedMatch = message.match(/^不支持的 Link 执行模式[：:]\s*(.+)$/);
  if (linkModeUnsupportedMatch) {
    return t("不支持的 Link 执行模式：{mode}", {
      mode: linkModeUnsupportedMatch[1],
    });
  }

  const projectMissingMatch = message.match(/^项目不存在[：:]\s*(.+)$/);
  if (projectMissingMatch) {
    return t("项目不存在：{project}", {
      project: projectMissingMatch[1],
    });
  }

  const proxyProfileMissingMatch = message.match(/^代理 profile 不存在[：:]\s*(.+)$/);
  if (proxyProfileMissingMatch) {
    return t("代理 profile 不存在：{profile}", {
      profile: proxyProfileMissingMatch[1],
    });
  }

  const unsupportedStepMatch = message.match(/^暂不支持的步骤类型[：:]\s*(.+)$/);
  if (unsupportedStepMatch) {
    return t("暂不支持的步骤类型：{type}", {
      type: unsupportedStepMatch[1],
    });
  }

  const preservedStepMatch = message.match(/^保留扩展步骤\s+(.+)$/);
  if (preservedStepMatch) {
    return t("保留扩展步骤 {type}", {
      type: preservedStepMatch[1],
    });
  }

  const localOverrideProjectMatch = message.match(/^确认项目\s+(.+?)\s+使用\s+(.+?)\s+作为本地覆盖文件$/);
  if (localOverrideProjectMatch) {
    return t("确认项目 {project} 使用 {path} 作为本地覆盖文件", {
      project: localOverrideProjectMatch[1],
      path: localOverrideProjectMatch[2],
    });
  }

  const localOverridePathMatch = message.match(/^确认本地覆盖文件\s+(.+)$/);
  if (localOverridePathMatch) {
    return t("确认本地覆盖文件 {path}", {
      path: localOverridePathMatch[1],
    });
  }

  const planProxyListenMatch = message.match(/^计划启动代理\s+(.+?)，监听\s+(.+)$/);
  if (planProxyListenMatch) {
    return t("计划启动代理 {name}，监听 {url}", {
      name: planProxyListenMatch[1],
      url: planProxyListenMatch[2],
    });
  }

  const planProxyMatch = message.match(/^计划启动代理\s+(.+)$/);
  if (planProxyMatch) {
    return t("计划启动代理 {name}", {
      name: planProxyMatch[1],
    });
  }

  const debugProfileCwdMatch = message.match(/^计划用调试配置\s+(.+?)\s+启动项目\s+(.+?)，cwd=(.+)$/);
  if (debugProfileCwdMatch) {
    return t("计划用调试配置 {profile} 启动项目 {project}，cwd={cwd}", {
      profile: debugProfileCwdMatch[1],
      project: debugProfileCwdMatch[2],
      cwd: debugProfileCwdMatch[3],
    });
  }

  const debugProfileMatch = message.match(/^计划用调试配置\s+(.+?)\s+启动项目\s+(.+)$/);
  if (debugProfileMatch) {
    return t("计划用调试配置 {profile} 启动项目 {project}", {
      profile: debugProfileMatch[1],
      project: debugProfileMatch[2],
    });
  }

  const runtimeProfileCwdMatch = message.match(/^计划用运行环境\s+(.+?)\s+启动项目\s+(.+?)，cwd=(.+)$/);
  if (runtimeProfileCwdMatch) {
    return t("计划用运行环境 {profile} 启动项目 {project}，cwd={cwd}", {
      profile: runtimeProfileCwdMatch[1],
      project: runtimeProfileCwdMatch[2],
      cwd: runtimeProfileCwdMatch[3],
    });
  }

  const runtimeProfileMatch = message.match(/^计划用运行环境\s+(.+?)\s+启动项目\s+(.+)$/);
  if (runtimeProfileMatch) {
    return t("计划用运行环境 {profile} 启动项目 {project}", {
      profile: runtimeProfileMatch[1],
      project: runtimeProfileMatch[2],
    });
  }

  const projectLaunchCwdMatch = message.match(/^计划启动项目\s+(.+?)，cwd=(.+)$/);
  if (projectLaunchCwdMatch) {
    return t("计划启动项目 {project}，cwd={cwd}", {
      project: projectLaunchCwdMatch[1],
      cwd: projectLaunchCwdMatch[2],
    });
  }

  const projectLaunchMatch = message.match(/^计划启动项目\s+(.+)$/);
  if (projectLaunchMatch) {
    return t("计划启动项目 {project}", {
      project: projectLaunchMatch[1],
    });
  }

  const focusPageMatch = message.match(/^计划打开项目调试页面\s+(.+)$/);
  if (focusPageMatch) {
    return t("计划打开项目调试页面 {url}", {
      url: focusPageMatch[1],
    });
  }

  const webActionPlanMatch = message.match(/^计划处理网页动作\s+(.+)$/);
  if (webActionPlanMatch) {
    return t("计划处理网页动作 {action}", {
      action: webActionPlanMatch[1],
    });
  }

  const proxyNotStartedMatch = message.match(/^代理尚未启动[：:]\s*(.+)$/);
  if (proxyNotStartedMatch) {
    return t("代理尚未启动：{url}", {
      url: proxyNotStartedMatch[1],
    });
  }

  const proxyListeningMatch = message.match(/^代理正在监听\s+(.+)$/);
  if (proxyListeningMatch) {
    return t("代理正在监听 {url}", {
      url: proxyListeningMatch[1],
    });
  }

  const proxyReadyMatch = message.match(/^代理配置有效，可以启动\s+(.+)$/);
  if (proxyReadyMatch) {
    return t("代理配置有效，可以启动 {url}", {
      url: proxyReadyMatch[1],
    });
  }

  const proxyOccupiedMatch = message.match(/^代理端口已被外部进程占用\s+(.+)$/);
  if (proxyOccupiedMatch) {
    return t("代理端口已被外部进程占用 {url}", {
      url: proxyOccupiedMatch[1],
    });
  }

  const proxyExpectedListenMatch = message.match(/^代理尚未启动，期望监听\s+(.+)$/);
  if (proxyExpectedListenMatch) {
    return t("代理尚未启动，期望监听 {url}", {
      url: proxyExpectedListenMatch[1],
    });
  }

  const runtimePreflightFailureMatch = message.match(/^运行前检查失败[：:]\s*(.+)$/);
  if (runtimePreflightFailureMatch) {
    return t("运行前检查失败：{reason}", {
      reason: translateInternalMessage(runtimePreflightFailureMatch[1], t),
    });
  }

  const resolvedPageMatch = message.match(/^已解析打开页面\s+(.+?)；CLI 检查模式不执行打开动作。$/);
  if (resolvedPageMatch) {
    return t("已解析打开页面 {url}；CLI 检查模式不执行打开动作。", {
      url: resolvedPageMatch[1],
    });
  }

  const proxyStartedMatch = message.match(/^代理已由共享守护进程启动[：:]\s*(.+)$/);
  if (proxyStartedMatch) {
    return t("代理已由共享守护进程启动：{url}", {
      url: proxyStartedMatch[1],
    });
  }

  const proxyStartFailureMatch = message.match(/^代理启动失败[：:]\s*(.+)$/);
  if (proxyStartFailureMatch) {
    return t("代理启动失败：{reason}", {
      reason: translateInternalMessage(proxyStartFailureMatch[1], t),
    });
  }

  const projectStartFailureMatch = message.match(/^项目启动失败[：:]\s*(.+)$/);
  if (projectStartFailureMatch) {
    return t("项目启动失败：{reason}", {
      reason: translateInternalMessage(projectStartFailureMatch[1], t),
    });
  }

  const proxyStoppedMatch = message.match(/^代理已停止[：:]\s*(.+)$/);
  if (proxyStoppedMatch) {
    return t("代理已停止：{name}", {
      name: proxyStoppedMatch[1],
    });
  }

  const proxyStopFailureMatch = message.match(/^代理停止失败[：:]\s*(.+)$/);
  if (proxyStopFailureMatch) {
    return t("代理停止失败：{reason}", {
      reason: translateInternalMessage(proxyStopFailureMatch[1], t),
    });
  }

  const manualRefreshMatch = message.match(/^请手动刷新[（(]\s*(\d+)\s*\/\s*(\d+)\s*[)）]$/);
  if (manualRefreshMatch) {
    return t("请手动刷新（{current}/{total}）", {
      current: manualRefreshMatch[1],
      total: manualRefreshMatch[2],
    });
  }

  const stoppedRetryMatch = message.match(/^已停止自动重试[（(]\s*(\d+)\s*\/\s*(\d+)\s*[)）]$/);
  if (stoppedRetryMatch) {
    return t("已停止自动重试（{current}/{total}）", {
      current: stoppedRetryMatch[1],
      total: stoppedRetryMatch[2],
    });
  }

  const completedCountsMatch = message.match(/^完成\s+(\d+)\s*\/\s*失败\s+(\d+)\s*\/\s*跳过\s+(\d+)$/);
  if (completedCountsMatch) {
    return t("完成 {completedCount} / 失败 {failureCount} / 跳过 {skippedCount}", {
      completedCount: completedCountsMatch[1],
      failureCount: completedCountsMatch[2],
      skippedCount: completedCountsMatch[3],
    });
  }

  const successFailureCountsMatch = message.match(/^成功\s+(\d+)\s*\/\s*失败\s+(\d+)$/);
  if (successFailureCountsMatch) {
    return t("成功 {successCount} / 失败 {failureCount}", {
      successCount: successFailureCountsMatch[1],
      failureCount: successFailureCountsMatch[2],
    });
  }

  const successSkippedCountsMatch = message.match(/^成功\s+(\d+)\s*\/\s*跳过\s+(\d+)$/);
  if (successSkippedCountsMatch) {
    return t("成功 {successCount} / 跳过 {skippedCount}", {
      successCount: successSkippedCountsMatch[1],
      skippedCount: successSkippedCountsMatch[2],
    });
  }

  const successCountMatch = message.match(/^成功\s+(\d+)$/);
  if (successCountMatch) {
    return t("成功 {count}", { count: successCountMatch[1] });
  }

  const failureCountMatch = message.match(/^失败\s+(\d+)$/);
  if (failureCountMatch) {
    return t("失败 {count}", { count: failureCountMatch[1] });
  }

  const reloadNeededMatch = message.match(/^需重新加载\s+(\d+)$/);
  if (reloadNeededMatch) {
    return t("需重新加载 {count}", { count: reloadNeededMatch[1] });
  }

  const failureConfirmNeededMatch = message.match(/^需确认失败\s+(\d+)$/);
  if (failureConfirmNeededMatch) {
    return t("需确认失败 {count}", {
      count: failureConfirmNeededMatch[1],
    });
  }

  const bracketStatusMatch = message.match(/^(.*\S)(\s*)\[([^\]]+)\]$/);
  if (bracketStatusMatch) {
    const translatedLabel = translateExactInternalMessage(bracketStatusMatch[3], t);
    if (translatedLabel !== bracketStatusMatch[3]) {
      return `${bracketStatusMatch[1]}${bracketStatusMatch[2]}[${translatedLabel}]`;
    }
  }

  if (message.includes(" · ")) {
    return message
      .split(" · ")
      .map((part) => translateInternalMessage(part, t))
      .join(" · ");
  }

  return message;
}

export function translateInternalMessage(message: string, t: Translate): string {
  if (!message) {
    return message;
  }
  const leadingWhitespace = message.match(/^\s*/)?.[0] ?? "";
  const trailingWhitespace = message.match(/\s*$/)?.[0] ?? "";
  const trimmed = message.trim();
  if (!trimmed) {
    return message;
  }
  return `${leadingWhitespace}${translateInternalMessageCore(trimmed, t)}${trailingWhitespace}`;
}
