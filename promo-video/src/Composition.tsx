import {
  AbsoluteFill,
  Composition,
  Easing,
  Img,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";

const FPS = 30;
const SCENE = { intro: 150, feature: 150, outro: 150 };
const colors = {
  ink: "#070b12",
  blue: "#77aefc",
  cyan: "#72e2d0",
  purple: "#c0a6ff",
  green: "#7be0a6",
  gold: "#e7c56e",
  text: "#f5f8ff",
  muted: "#9ba8bc",
};
const fontFamily =
  "Inter, -apple-system, BlinkMacSystemFont, PingFang SC, Microsoft YaHei, sans-serif";
const SCREEN_MAX_WIDTH = 996;
const SCREEN_TOP = 500;
const SCREEN_ASPECTS: Record<string, number> = {
  "workspace-overview.png": 1892 / 1510,
  "projects-list.png": 1900 / 1520,
  "action-batch-deploy-pre.png": 1900 / 1520,
  "branch-record-summary.png": 1900 / 1520,
  "resources-actions.png": 1900 / 1520,
  "knowledge-base-notes.png": 1900 / 1520,
  "local-proxy-rules.png": 1900 / 1520,
  "activity-center-pagination-preview.jpeg": 1900 / 1520,
  "project-runtime-config-panel.png": 1900 / 1520,
};

const fade = (frame: number, duration: number) =>
  interpolate(frame, [0, 18, duration - 20, duration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
const entrance = (frame: number) =>
  interpolate(frame, [0, 28], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

const Background = () => (
  <AbsoluteFill
    style={{
      backgroundColor: colors.ink,
      backgroundImage:
        "radial-gradient(circle at 80% 18%, rgba(119, 174, 252, 0.2), transparent 30%), radial-gradient(circle at 12% 86%, rgba(114, 226, 208, 0.13), transparent 27%), linear-gradient(135deg, #070b12 0%, #0b111c 55%, #070b12 100%)",
      overflow: "hidden",
    }}
  >
    <div className="grid-overlay" />
    <div className="grain-overlay" />
  </AbsoluteFill>
);

const BrandMark = ({ size = 52 }: { size?: number }) => (
  <Img
    src={staticFile("assets/rdevtool.png")}
    style={{
      width: size,
      height: size,
      objectFit: "contain",
      borderRadius: 14,
    }}
  />
);

const Eyebrow = ({
  children,
  accent = colors.blue,
}: {
  children: string;
  accent?: string;
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "8px 16px",
      border: `1px solid ${accent}55`,
      borderRadius: 999,
      backgroundColor: `${accent}12`,
      color: accent,
      fontFamily,
      fontSize: 18,
      fontWeight: 700,
      letterSpacing: "0.12em",
    }}
  >
    <span
      style={{
        width: 24,
        height: 2,
        backgroundColor: accent,
        display: "inline-block",
      }}
    />
    {children}
  </div>
);

const Intro = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const appear = entrance(frame);
  return (
    <AbsoluteFill
      style={{ opacity: fade(frame, durationInFrames), fontFamily }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 72px",
          scale: interpolate(frame, [0, durationInFrames], [0.97, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <div
          style={{
            opacity: appear,
            translate: `${interpolate(frame, [0, 28], [-30, 0], { extrapolateRight: "clamp" })}px 0px`,
          }}
        >
          <BrandMark size={76} />
        </div>
        <div style={{ height: 42 }} />
        <Eyebrow>RDEVTOOL / PRODUCT FILM</Eyebrow>
        <div style={{ height: 26 }} />
        <h1
          style={{
            margin: 0,
            maxWidth: 1160,
            color: colors.text,
            fontSize: 70,
            lineHeight: 1.06,
            fontWeight: 700,
            letterSpacing: "-0.04em",
            opacity: appear,
            translate: `${interpolate(frame, [0, 32], [34, 0], { extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) })}px 0px`,
          }}
        >
          把复杂的开发现场，收进一个
          <br />
          <span style={{ color: colors.blue }}>可掌控的工作台</span>
        </h1>
        <div style={{ height: 30 }} />
        <p
          style={{
            margin: 0,
            color: colors.muted,
            fontSize: 28,
            letterSpacing: "0.04em",
            opacity: interpolate(frame, [18, 50], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          多工作区协同，让项目、资源与动作共享同一份上下文。
        </p>
        <div style={{ height: 72 }} />
        <div style={{ display: "flex", gap: 14, opacity: appear }}>
          {["工作区", "项目", "部署", "活动"].map((label, index) => (
            <div
              key={label}
              style={{
                padding: "12px 22px",
                border: `1px solid ${index === 0 ? "rgba(119,174,252,0.65)" : "rgba(155,168,188,0.2)"}`,
                borderRadius: 999,
                color: index === 0 ? colors.blue : colors.muted,
                fontSize: 19,
                letterSpacing: "0.12em",
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
      <div className="hero-orbit orbit-one" />
      <div className="hero-orbit orbit-two" />
    </AbsoluteFill>
  );
};

type FeatureProps = {
  image: string;
  eyebrow: string;
  title: string;
  description: string;
  accent?: string;
  index: string;
};

const FeatureScene = ({
  image,
  eyebrow,
  title,
  description,
  accent = colors.blue,
  index,
}: FeatureProps) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const shellWidth = SCREEN_MAX_WIDTH;
  const shellHeight = Math.round(
    shellWidth / (SCREEN_ASPECTS[image] ?? 16 / 9),
  );
  return (
    <AbsoluteFill
      style={{ opacity: fade(frame, durationInFrames), fontFamily }}
    >
      <div
        style={{
          position: "absolute",
          left: 72,
          right: 72,
          top: 92,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          opacity: entrance(frame),
          translate: `0px ${interpolate(frame, [0, 28], [24, 0], { extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) })}px`,
        }}
      >
        <div>
          <Eyebrow accent={accent}>{eyebrow}</Eyebrow>
          <h2
            style={{
              margin: "24px 0 0",
              color: colors.text,
              fontSize: 48,
              lineHeight: 1.16,
              letterSpacing: "-0.03em",
            }}
          >
            {title}
          </h2>
          <p
            style={{
              margin: "16px 0 0",
              display: "flex",
              alignItems: "center",
              gap: 12,
              maxWidth: 860,
              color: colors.muted,
              fontSize: 21,
              letterSpacing: "0.03em",
            }}
          >
            <span style={{ color: accent, fontSize: 16 }}>●</span>
            {description}
          </p>
        </div>
        <div
          style={{
            color: accent,
            fontSize: 20,
            letterSpacing: "0.18em",
            fontWeight: 700,
          }}
        >
          {index}
        </div>
      </div>
      <div
        className="screen-shell"
        style={{
          position: "absolute",
          left: "50%",
          width: shellWidth,
          marginLeft: -shellWidth / 2,
          top: SCREEN_TOP,
          height: shellHeight,
          opacity: entrance(frame),
          scale: interpolate(frame, [0, durationInFrames], [1.045, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: `0px ${interpolate(frame, [0, 32], [28, 0], { extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) })}px`,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            overflow: "hidden",
            backgroundColor: "#0b1018",
          }}
        >
          <Img
            src={staticFile(`assets/${image}`)}
            style={{
              width: "100%",
              height: "100%",
            objectFit: "contain",
            objectPosition: "center",
            scale: interpolate(frame, [0, durationInFrames], [1, 1.02], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          />
          <div className="screen-vignette" />
        </div>
        <div
          className="screen-sheen"
          style={{
            translate: `${interpolate(frame, [0, durationInFrames], [-900, 1100], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.linear })}px 0px`,
          }}
        />
      </div>
      <div
        className="feature-footer"
        style={{
          top: "auto",
          bottom: 110,
          opacity: interpolate(frame, [20, 52], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <span>PROJECTS IN CONTEXT</span>
        <span style={{ color: accent }}>●</span>
        <span>OPERATIONS WITH TRACEABILITY</span>
      </div>
    </AbsoluteFill>
  );
};

const Outro = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill
      style={{
        opacity: fade(frame, durationInFrames),
        fontFamily,
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "100%",
          opacity: entrance(frame),
          scale: interpolate(frame, [0, 35], [0.92, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <BrandMark size={132} />
        <h2
          style={{
            margin: "34px 0 0",
            color: colors.text,
            fontSize: 68,
            letterSpacing: "-0.04em",
          }}
        >
          让每次开发，都有上下文。
        </h2>
        <p
          style={{
            margin: "20px 0 0",
            color: colors.muted,
            fontSize: 24,
            letterSpacing: "0.16em",
          }}
        >
          rDevTool · One workbench for the R-series
        </p>
        <div
          style={{
            marginTop: 40,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 14,
          }}
        >
          <div
            style={{
              padding: "16px 28px",
              borderRadius: 16,
              border: "1px solid rgba(119,174,252,0.34)",
              background: "linear-gradient(180deg, rgba(119,174,252,0.2), rgba(119,174,252,0.06))",
              color: colors.text,
              fontSize: 25,
              fontWeight: 700,
            }}
          >
            Website · rdt.rurie.top
          </div>
          <div style={{ color: colors.muted, fontSize: 23, letterSpacing: "0.04em" }}>
            GitHub · github.com/r-series-lab/rdevtool
          </div>
        </div>
        <div
          style={{
            marginTop: 44,
            color: colors.blue,
            fontSize: 18,
            letterSpacing: "0.22em",
            fontWeight: 700,
          }}
        >
          RDEVTOOL / BUILD WITH CONTEXT
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const RDevToolPromo: React.FC = () => (
  <AbsoluteFill>
    <Background />
    <Sequence durationInFrames={SCENE.intro}>
      <Intro />
    </Sequence>
    <Sequence from={SCENE.intro} durationInFrames={SCENE.feature}>
      <FeatureScene
        image="workspace-overview.png"
        eyebrow="01 / MULTI-WORKSPACE"
        title="多个工作区，保持全局可见"
        description="在同一个入口切换工作区，项目、资源和运行状态各就各位。"
        index="01"
      />
    </Sequence>
    <Sequence
      from={SCENE.intro + SCENE.feature}
      durationInFrames={SCENE.feature}
    >
      <FeatureScene
        image="projects-list.png"
        eyebrow="02 / RDEVTOOL"
        title="项目、Skill、CLI 与 Agent，协作在一起"
        description="让人工操作与自动化能力共享项目上下文，减少来回切换。"
        accent={colors.cyan}
        index="02"
      />
    </Sequence>
    <Sequence
      from={SCENE.intro + SCENE.feature * 2}
      durationInFrames={SCENE.feature}
    >
      <FeatureScene
        image="project-runtime-config-panel.png"
        eyebrow="03 / RUNTIME CONFIG"
        title="运行配置，从启动档案到端口都透明"
        description="参数、解析链、工作区和启动命令集中确认，运行前先把边界看清。"
        accent={colors.purple}
        index="03"
      />
    </Sequence>
    <Sequence
      from={SCENE.intro + SCENE.feature * 3}
      durationInFrames={SCENE.feature}
    >
      <FeatureScene
        image="action-batch-deploy-pre.png"
        eyebrow="04 / DEPLOY"
        title="部署前先确认，动作更稳"
        description="批量选择项目、分支和环境，执行前保留清晰的检查点。"
        accent={colors.green}
        index="04"
      />
    </Sequence>
    <Sequence
      from={SCENE.intro + SCENE.feature * 4}
      durationInFrames={SCENE.feature}
    >
      <FeatureScene
        image="branch-record-summary.png"
        eyebrow="05 / MERGE"
        title="从分支记录，到合并结果"
        description="让开发过程中的分支、变更和结果留在同一条可回看的链路里。"
        accent={colors.gold}
        index="05"
      />
    </Sequence>
    <Sequence
      from={SCENE.intro + SCENE.feature * 5}
      durationInFrames={SCENE.feature}
    >
      <FeatureScene
        image="resources-actions.png"
        eyebrow="06 / LINKED ACTIONS"
        title="资源入口与联动操作，触手可及"
        description="常用资源、快捷动作和项目现场相互联动，少一步寻找，多一步推进。"
        accent={colors.blue}
        index="06"
      />
    </Sequence>
    <Sequence
      from={SCENE.intro + SCENE.feature * 6}
      durationInFrames={SCENE.feature}
    >
      <FeatureScene
        image="knowledge-base-notes.png"
        eyebrow="07 / KNOWLEDGE BASE"
        title="把经验留在工作区里"
        description="知识库与项目上下文相连，让说明、备注和解决方案随时可用。"
        accent={colors.cyan}
        index="07"
      />
    </Sequence>
    <Sequence
      from={SCENE.intro + SCENE.feature * 7}
      durationInFrames={SCENE.feature}
    >
      <FeatureScene
        image="local-proxy-rules.png"
        eyebrow="08 / LOCAL PROXY"
        title="本地代理，也纳入同一套控制面"
        description="规则、目标与状态集中管理，让本地联调更清楚、更可控。"
        accent={colors.purple}
        index="08"
      />
    </Sequence>
    <Sequence
      from={SCENE.intro + SCENE.feature * 8}
      durationInFrames={SCENE.feature}
    >
      <FeatureScene
        image="activity-center-pagination-preview.jpeg"
        eyebrow="09 / RUNNING & ACTIVITY"
        title="运行中与活动记录，结果始终可追踪"
        description="实时状态、历史活动和失败详情都留在现场，问题有出处，行动有回声。"
        accent={colors.green}
        index="09"
      />
    </Sequence>
    <Sequence
      from={SCENE.intro + SCENE.feature * 9}
      durationInFrames={SCENE.outro}
    >
      <Outro />
    </Sequence>
  </AbsoluteFill>
);

export const RemotionComposition = () => (
  <Composition
    id="RDevToolPromo"
    component={RDevToolPromo}
    durationInFrames={SCENE.intro + SCENE.feature * 9 + SCENE.outro}
    fps={FPS}
    width={1080}
    height={1920}
  />
);
