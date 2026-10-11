import { Controller, Get, Inject, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { ArtifactsService } from "../../artifacts/services/artifacts.service.js";
import { SessionsService } from "../services/sessions.service.js";
import { SessionModel } from "../models/session.model.js";

@Controller("api")
export class SessionsController {
  constructor(
    @Inject(ArtifactsService) private readonly artifacts: ArtifactsService,
    @Inject(SessionsService) private readonly sessionsStore: SessionsService,
  ) {}

  @Get("sessions")
  async sessions(
    @Req() request: Request<Record<string, string>>,
    @Res() response: Response,
  ) {
    const artifactId =
      typeof request.query.artifactId === "string"
        ? request.query.artifactId
        : "";
    if (!(await this.artifacts.exists(artifactId))) {
      response.status(400).json({ error: "请选择有效的产物" });
      return;
    }
    response.json(await this.sessionsStore.read("", artifactId));
  }

  @Get("sessions/:sessionId")
  async session(
    @Req() request: Request<Record<string, string>>,
    @Res() response: Response,
  ) {
    const { sessionId } = request.params;
    const artifactId =
      typeof request.query.artifactId === "string"
        ? request.query.artifactId
        : "";
    if (!SessionModel.isValidId(sessionId)) {
      response.status(400).json({ error: "无效的 session ID" });
      return;
    }
    if (!(await this.artifacts.exists(artifactId))) {
      response.status(400).json({ error: "请选择有效的产物" });
      return;
    }
    const payload = await this.sessionsStore.read(sessionId, artifactId);
    if (!payload.session) {
      response.status(404).json({ error: "找不到这个会话" });
      return;
    }
    response.json(payload);
  }
}
