import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { ServerConfigService } from "../../../config/server-config.service.js";
import {
  SandboxClient,
  type SandboxApi as Sandbox,
} from "@agent-infra/sandbox";
import { SandboxResponse } from "../../../infrastructure/sandbox/models/sandbox-response.model.js";
import { ArtifactRepository } from "../repositories/artifact.repository.js";
import { WorkspaceService } from "./workspace.service.js";
import { ArtifactFilesystemService } from "./artifact-filesystem.service.js";
import type { Artifact } from "../models/artifact.model.js";

const SDK_VITE_ADAPTER_PATH = fileURLToPath(
  import.meta.resolve("@artifact-editor/sdk/web/vite"),
);

@Injectable()
export class PreviewService implements OnModuleDestroy {
  private transition: Promise<unknown> = Promise.resolve();
  private session: string | undefined;

  constructor(
    @Inject(SandboxClient) private readonly client: SandboxClient,
    @Inject(ArtifactRepository) private readonly repository: ArtifactRepository,
    @Inject(WorkspaceService) private readonly workspaces: WorkspaceService,
    @Inject(ArtifactFilesystemService)
    private readonly filesystem: ArtifactFilesystemService,
    @Inject(ServerConfigService) private readonly config: ServerConfigService,
  ) {}

  async onModuleDestroy() {
    await this.transition;
    if (this.session) await this.closeSession(this.session);
    this.session = undefined;
  }

  start(artifactId: string, onProgress?: (phase: string) => void) {
    const transition = this.transition.then(() =>
      this.startNow(artifactId, onProgress),
    );
    this.transition = transition.catch(() => {});
    return transition;
  }

  private async isReachable(previewUrl: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    try {
      const response = await fetch(
        `${this.config.sandboxBaseUrl}${previewUrl}`,
        {
          signal: controller.signal,
          headers: {
            "x-aio-proxy-port": previewUrl.split("/")[2],
            ...(this.config.sandboxToken
              ? { Authorization: `Bearer ${this.config.sandboxToken}` }
              : {}),
          },
        },
      );
      return response.status < 500;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private async ensureLocator(artifact: Artifact) {
    if (artifact.detectedStack !== "react" && artifact.detectedStack !== "vue")
      return artifact;
    try {
      await this.workspaces.forArtifact(artifact.id).prepareDependencies({
        persistLock: false,
        packages: [
          "code-inspector-plugin",
          artifact.detectedStack === "react"
            ? "@vitejs/plugin-react"
            : "@vitejs/plugin-vue",
        ],
      });
      return (await this.repository.get(artifact.id)) || artifact;
    } catch {
      // 定位插件不可用时保持 runtime hint，不能阻断产物预览。
      return artifact;
    }
  }

  private async startNow(
    artifactId: string,
    onProgress?: (phase: string) => void,
  ) {
    let artifact = await this.repository.get(artifactId);
    if (!artifact) throw new Error("找不到这个产物");
    await this.workspaces.initialize(artifactId);
    onProgress?.("dependencies");
    const workspace = await this.workspaces.ensureReady(artifactId);
    onProgress?.("locator");
    artifact = await this.ensureLocator(artifact);
    const previewPort = artifact.previewUrl.split("/")[2];
    await workspace.files.write(
      ".artifact/artifact-editor-sdk-vite.mjs",
      await fs.readFile(SDK_VITE_ADAPTER_PATH, "utf8"),
    );
    await this.filesystem.configurePreview(
      workspace.root,
      artifact.detectedStack,
      artifact.locatorMode,
    );
    onProgress?.("preview");
    if (this.session) await this.closeSession(this.session);
    this.session = undefined;
    // 固定 session 只回收本应用上次遗留的预览，不扫描或终止其他进程。
    const sessionId = `artifact-preview-${createHash("sha256").update(this.config.workspaceRoot).digest("hex").slice(0, 24)}`;
    const sessions = SandboxResponse.data<Sandbox.BashSessionInfo[]>(
      await this.client.bash.sessions(),
    );
    if (sessions.some((session) => session.session_id === sessionId))
      await this.closeSession(sessionId);
    this.session = SandboxResponse.data<Sandbox.BashSessionInfo>(
      await this.client.bash.createSession({
        session_id: sessionId,
        exec_dir: workspace.root,
      }),
    ).session_id;
    try {
      const started = SandboxResponse.data<Sandbox.BashExecResult>(
        await this.client.bash.exec({
          session_id: this.session,
          command:
            "./node_modules/.bin/vite --config .artifact/vite.config.mjs",
          exec_dir: workspace.root,
          env: { ARTIFACT_PREVIEW_PORT: previewPort },
          async_mode: true,
        }),
      );
      if (started.status !== "running" && started.status !== "pending")
        throw new Error(
          `产物预览进程退出：${started.stderr || started.stdout || started.status}`,
        );
      for (let attempt = 0; attempt < 40; attempt++) {
        const output = SandboxResponse.data<Sandbox.BashOutputResult>(
          await this.client.bash.output({ session_id: this.session }),
        );
        if (
          output.command?.status === "completed" ||
          output.command?.status === "killed" ||
          output.command?.status === "timed_out"
        )
          throw new Error(
            `产物预览进程退出：${output.stderr || output.stdout || output.command.status}`,
          );
        if (await this.isReachable(artifact.previewUrl)) return artifact;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error("产物预览启动超时");
    } catch (error) {
      await this.closeSession(this.session);
      this.session = undefined;
      throw error;
    }
  }
  private async closeSession(session: string) {
    const sessions = SandboxResponse.data<Sandbox.BashSessionInfo[]>(
      await this.client.bash.sessions(),
    );
    // 沙箱重建后内存中的旧 session 已不存在，无需再次关闭。
    if (!sessions.some((item) => item.session_id === session)) return;
    SandboxResponse.data(
      await this.client.bash.closeSession(session, { timeoutInSeconds: 10 }),
    );
  }
}
