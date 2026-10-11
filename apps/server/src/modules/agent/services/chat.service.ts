import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { DshRuntimeService } from "./dsh-runtime.service.js";
import { SessionModel } from "../models/session.model.js";
import { AgentToolsService } from "./agent-tools.service.js";
import { ArtifactsService } from "../../artifacts/services/artifacts.service.js";
import { SessionsService } from "./sessions.service.js";

@Injectable()
export class ChatService {
  constructor(
    @Inject(ArtifactsService) private readonly artifacts: ArtifactsService,
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(DshRuntimeService) private readonly runtime: DshRuntimeService,
    @Inject(AgentToolsService) private readonly tools: AgentToolsService,
  ) {}

  async send(body: Record<string, unknown> = {}, signal?: AbortSignal) {
    const prompt = typeof body.message === "string" ? body.message.trim() : "";
    if (!prompt) throw new BadRequestException("请输入消息");
    const artifactId =
      typeof body.artifactId === "string" ? body.artifactId.trim() : "";
    if (!(await this.artifacts.exists(artifactId)))
      throw new BadRequestException("请选择有效的产物");
    const requestedSessionId =
      typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    if (requestedSessionId && !SessionModel.isValidId(requestedSessionId))
      throw new BadRequestException("无效的 session ID");
    if (
      requestedSessionId &&
      !(await this.sessions.read(requestedSessionId, artifactId)).session
    ) {
      throw new ConflictException("这个会话不属于当前产物");
    }
    const sessionId = requestedSessionId || randomUUID();
    const technologyBefore = await this.artifacts.require(artifactId);
    await this.artifacts.initialize(artifactId);
    const workspace = this.artifacts.workspace(artifactId);
    const mutation = await workspace.edit(
      {
        message: prompt,
        onError: "rollback",
        expectedRevision:
          typeof body.checkpointRevision === "string"
            ? body.checkpointRevision
            : "",
      },
      (current) =>
        this.runtime.run(prompt, {
          cwd: current.root,
          sessionId,
          tools: this.tools.forWorkspace(current, {
            inspect: (toolSignal) =>
              this.artifacts.get(artifactId, { signal: toolSignal }),
          }),
          systemPrompt: this.tools.prompt(current.root),
          signal,
        }),
    );
    let artifact = await this.artifacts.get(artifactId);
    let runtimeWarning = "";
    if (
      artifact &&
      (artifact.detectedStack !== technologyBefore.detectedStack ||
        artifact.locatorMode !== technologyBefore.locatorMode)
    ) {
      try {
        artifact = await this.artifacts.start(artifactId);
      } catch (error) {
        runtimeWarning =
          error instanceof Error ? error.message : "技术栈切换后预览重启失败";
      }
    }
    return {
      reply: mutation.value,
      sessionId,
      artifactId,
      artifact,
      runtimeWarning,
      changed: mutation.changed,
      checkpoint: mutation.checkpoint,
      checkpoints: mutation.checkpoints,
      checkpointState: mutation.state,
    };
  }
}
