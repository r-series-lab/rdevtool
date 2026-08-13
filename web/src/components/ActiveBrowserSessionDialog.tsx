import { useEffect, useState } from "react";
import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import { useI18n } from "../i18n";
import type { ActiveSession } from "../lib/activeSessions";
import { AppActionDialog } from "./AppActionDialog";
import { CheckIcon, CopyIcon, WebsiteIcon } from "./AppIcons";

type ActiveBrowserSessionDialogProps = {
  session: ActiveSession | null;
  onClose: () => void;
};

function EvidenceRow({ label, value }: { label: string; value: string }) {
  return (
    <Box className="active-browser-session-evidence-row">
      <Typography component="dt" variant="caption">
        {label}
      </Typography>
      <Typography component="dd" variant="caption" title={value}>
        {value}
      </Typography>
    </Box>
  );
}

export function ActiveBrowserSessionDialog({
  session,
  onClose,
}: ActiveBrowserSessionDialogProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const browser = session?.browserInfo;

  useEffect(() => {
    setCopied(false);
  }, [browser]);

  if (!session || !browser) {
    return null;
  }

  const copySnapshot = async () => {
    if (!navigator.clipboard?.writeText) {
      return;
    }
    await navigator.clipboard.writeText(JSON.stringify(browser, null, 2));
    setCopied(true);
  };

  const browserVersion = browser.browserVersion
    ? `${browser.browserName} ${browser.browserVersion}`
    : browser.browserName;

  return (
    <AppActionDialog
      open
      maxWidth="sm"
      tone="neutral"
      title={t("受控浏览器详情")}
      subtitle={browserVersion}
      description={t(
        "此处只读展示 CDP 连接与项目关联。配置关系不代表浏览器进程所有权。",
      )}
      icon={<WebsiteIcon />}
      contentIcon={false}
      className="active-browser-session-dialog"
      onClose={onClose}
      actions={(
        <>
          <Button
            variant="outlined"
            color="inherit"
            startIcon={copied ? <CheckIcon /> : <CopyIcon />}
            onClick={() => void copySnapshot()}
          >
            {copied ? t("已复制快照") : t("复制快照")}
          </Button>
          <Button color="inherit" onClick={onClose}>
            {t("关闭")}
          </Button>
        </>
      )}
    >
      <Stack className="active-browser-session" spacing={1.5}>
        <Stack
          className="active-browser-session-summary"
          direction="row"
          spacing={0.7}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
        >
          <Chip size="small" className="is-connected" label={t("CDP 已连接")} />
          <Chip size="small" variant="outlined" label={t("只读关联")} />
          <Typography variant="caption">
            {t("{count} 个受控页面", { count: browser.pageCount })}
          </Typography>
        </Stack>

        <Box component="dl" className="active-browser-session-evidence">
          <EvidenceRow label={t("浏览器版本")} value={browserVersion} />
          <EvidenceRow label={t("CDP 端点")} value={browser.endpoint} />
          <EvidenceRow label={t("调试端口")} value={String(browser.port)} />
          <EvidenceRow
            label={t("DevTools 协议")}
            value={browser.protocolVersion || t("未提供")}
          />
        </Box>

        <Box className="active-browser-session-relations">
          <Typography className="active-browser-session-section-title" variant="overline">
            {t("活跃项目")}
          </Typography>
          {browser.activeProjects.length > 0 ? (
            <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
              {browser.activeProjects.map((project) => (
                <Chip
                  size="small"
                  className="is-active-project"
                  key={project.key}
                  label={project.name}
                  title={project.key}
                />
              ))}
            </Stack>
          ) : (
            <Typography variant="body2">{t("未关联")}</Typography>
          )}
        </Box>

        <Box className="active-browser-session-relations">
          <Typography className="active-browser-session-section-title" variant="overline">
            {t("配置关联项目")}
          </Typography>
          {browser.configuredProjects.length > 0 ? (
            <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
              {browser.configuredProjects.map((project) => (
                <Chip
                  size="small"
                  key={project.key}
                  label={project.name}
                  title={project.key}
                />
              ))}
            </Stack>
          ) : (
            <Typography variant="body2">{t("未关联")}</Typography>
          )}
        </Box>

        <Box className="active-browser-session-relations">
          <Typography className="active-browser-session-section-title" variant="overline">
            {t("运行环境")}
          </Typography>
          {browser.runtimeProfileKeys.length > 0 ? (
            <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
              {browser.runtimeProfileKeys.map((profile) => (
                <Chip size="small" key={profile} label={profile} />
              ))}
            </Stack>
          ) : (
            <Typography variant="body2">{t("默认网页动作配置")}</Typography>
          )}
        </Box>

        <Box>
          <Typography className="active-browser-session-section-title" variant="overline">
            {t("受控页面 {count}", { count: browser.pageCount })}
          </Typography>
          {browser.pages.length === 0 ? (
            <Typography className="active-browser-session-empty" variant="body2">
              {t("当前未发现可展示的页面。")}
            </Typography>
          ) : (
            <Stack className="active-browser-session-pages" spacing={0}>
              {browser.pages.map((page) => (
                <Box className="active-browser-session-page" key={page.id}>
                  <Typography variant="subtitle2" title={page.title}>
                    {page.title || t("未命名页面")}
                  </Typography>
                  {page.url ? (
                    <Typography component="code" variant="caption" title={page.url}>
                      {page.url}
                    </Typography>
                  ) : null}
                </Box>
              ))}
            </Stack>
          )}
          {browser.pages.length < browser.pageCount ? (
            <Typography className="active-browser-session-limit" variant="caption">
              {t("仅展示前 {count} 个页面", { count: browser.pages.length })}
            </Typography>
          ) : null}
        </Box>

        <Typography className="active-browser-session-safety" variant="caption">
          {t("页面 URL 已移除凭据、查询参数与片段；此视图不提供关闭浏览器或页面操作。")}
        </Typography>
      </Stack>
    </AppActionDialog>
  );
}
