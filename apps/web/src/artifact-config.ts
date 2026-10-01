import type { TechnologyStack, ArtifactCreationPhase } from "./types";

export const TECHNOLOGY_OPTIONS: Array<{
  value: TechnologyStack;
  label: string;
  description: string;
}> = [
  {
    value: "html",
    label: "HTML + JavaScript",
    description: "无侵入运行时 DOM hint",
  },
  {
    value: "react",
    label: "React",
    description: "Vite + Code Inspector 精确定位",
  },
  { value: "vue", label: "Vue", description: "Vite + Code Inspector 精确定位" },
];

export const ARTIFACT_CREATION_STEPS = [
  {
    phase: "workspace",
    label: "创建工作区",
    description: "生成目录和初始文件",
  },
  {
    phase: "dependencies",
    label: "安装项目依赖",
    description: "准备框架与构建工具",
  },
  {
    phase: "locator",
    label: "配置元素定位",
    description: "接入 DOM hint 或 Code Inspector",
  },
  {
    phase: "preview",
    label: "启动预览服务",
    description: "生成配置并连接预览",
  },
] as const;

export function artifactCreationStepState(
  phase: ArtifactCreationPhase,
  stepPhase: (typeof ARTIFACT_CREATION_STEPS)[number]["phase"],
  hasError: boolean,
): "pending" | "active" | "complete" | "error" {
  if (phase === "ready") return "complete";
  const currentIndex = ARTIFACT_CREATION_STEPS.findIndex(
    (step) => step.phase === phase,
  );
  const stepIndex = ARTIFACT_CREATION_STEPS.findIndex(
    (step) => step.phase === stepPhase,
  );
  if (currentIndex < 0 || stepIndex > currentIndex) return "pending";
  if (stepIndex < currentIndex) return "complete";
  return hasError ? "error" : "active";
}

export function technologyLabel(stack: TechnologyStack): string {
  return (
    TECHNOLOGY_OPTIONS.find((option) => option.value === stack)?.label || stack
  );
}
